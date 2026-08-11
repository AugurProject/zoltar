import { getAddress, privateKeyToAccount, type Address, type Hex } from '#ethereum'
import { assertDistinctPersistentPaths, mutableStrategy, type Configuration } from '#config/configuration'
import { assertFocusedDeploymentCompatible, prepareDeploymentTokenTransition, replacePrimaryRepToken, validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'
import { configurationRevisionConflict, loadOperatorSettingsWithRevision, parseOperatorSettings, saveOperatorSettings, serializeOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { signerCandidate } from '#config/signer'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { deployExecutorCreate2, executorDeploymentPlan } from '#execution/create2-executor'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { persistSignerSettingsWithProvisionalLock } from '#execution/execution-locks'
import type { SignerOperationGate } from '#execution/signer-operation-gate'
import { validateSubmissionSettings, type SubmissionSettings } from '#execution/transaction-submission'
import { authenticatedExecutionToken } from '#config/runtime-deployment'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, updateConnectivityEndpointChecks, updateSubmissionEndpointChecks, validateConnectivitySettingsForQuorum, validateIndependentReadRpcUrls, type ConnectivitySettings } from '#monitoring/connectivity'
import { operatorStatusAfterPause, type SyncCursor } from '#monitoring/block-sync'
import { operatorSnapshot, recordOperation, strategySettings, updateStrategyFromRequest, type MutableStrategy, type OperatorSnapshotFixedState, type OperatorState } from '#state/operator-state'
import type { ExclusiveProcessLock } from '#state/position-store'

export type PendingOperatorUpdates = {
	connectivity: ConnectivitySettings | undefined
	deployment: DeploymentSettings | undefined
	privateKey: Hex | undefined
	restartTokenAddresses: Address[] | undefined
	signerLock: ExclusiveProcessLock | undefined
	signerUpdate: boolean
	strategy: MutableStrategy | undefined
	submission: SubmissionSettings | undefined
	tokenAddresses: Address[] | undefined
}

export async function deployExecutorFromConnectivity(parameters: { chain: Configuration['network']['chain']; connectivity: ConnectivitySettings; privateKey: Hex; salt: unknown }, deploy: typeof deployExecutorCreate2 = deployExecutorCreate2) {
	if (parameters.connectivity.publicRpcUrls.length === 0) throw new Error('Configure a public submission RPC before deploying the executor')
	return await deploy({ chain: parameters.chain, privateKey: parameters.privateKey, rpcUrls: parameters.connectivity.publicRpcUrls, salt: parameters.salt })
}

export function startOperatorControlPlane(parameters: { config: Configuration; fixedState: OperatorSnapshotFixedState & { deployment: DeploymentSettings }; getCursor: () => SyncCursor | undefined; lockManager: ExecutionLockManager | undefined; signerOperationGate: SignerOperationGate; state: OperatorState }) {
	const { config, fixedState, lockManager, signerOperationGate, state } = parameters
	const pending: PendingOperatorUpdates = {
		connectivity: undefined,
		deployment: undefined,
		privateKey: undefined,
		restartTokenAddresses: undefined,
		signerLock: undefined,
		signerUpdate: false,
		strategy: undefined,
		submission: undefined,
		tokenAddresses: undefined,
	}
	const persistSettings = (settings: PersistedOperatorSettings, expectedRevision?: string) => saveOperatorSettings(config.settingsFile, settings, undefined, expectedRevision)
	const persistFocusedSettings = async (update: (settings: PersistedOperatorSettings) => PersistedOperatorSettings) => {
		const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
		if (latest === undefined) throw configurationRevisionConflict()
		const next = update(latest.settings)
		await persistSettings(next, latest.revision)
		return next
	}
	let settingsUpdateQueue = Promise.resolve()
	const queueSettingsUpdate = <T>(update: () => Promise<T>) => {
		const result = settingsUpdateQueue.then(update)
		settingsUpdateQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	if (!config.ui) return { dashboard: undefined, pending }
	const dashboard = startDashboardServer(config.uiPort, {
		getConfiguration: async () => {
			const loaded = await loadOperatorSettingsWithRevision(config.settingsFile)
			if (loaded === undefined) throw new Error('Operator configuration file is missing')
			return { configuration: serializeOperatorSettings(loaded.settings, true), revision: loaded.revision }
		},
		getSnapshot: () => operatorSnapshot(state, pending.strategy ?? config, pending.submission ?? config.submission, pending.connectivity ?? config.connectivity, fixedState, config.riskLimits),
		hostname: config.uiHost,
		password: process.env['ZOLTAR_BOT_DASHBOARD_PASSWORD'],
		updateConfiguration: value =>
			queueSettingsUpdate(async () => {
				if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('configuration' in value) || !('revision' in value) || typeof value.revision !== 'string') throw new Error('Complete configuration updates require configuration and revision')
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined || latest.revision !== value.revision) throw configurationRevisionConflict()
				const next = parseOperatorSettings(value.configuration, latest.settings.privateKey)
				assertDistinctPersistentPaths(config.settingsFile, next.runtime)
				const savedRevision = await persistSettings(next, value.revision)
				pending.connectivity = undefined
				pending.deployment = undefined
				pending.strategy = undefined
				pending.submission = undefined
				pending.tokenAddresses = undefined
				pending.restartTokenAddresses = undefined
				config.persistedPrivateKey = next.privateKey
				fixedState.savedWallet = next.privateKey === undefined ? undefined : privateKeyToAccount(next.privateKey).address
				recordOperation(state, { category: 'configuration', details: config.settingsFile, level: 'info', message: 'Complete operator configuration saved', reason: 'All fields apply after restart', reportId: undefined })
				return { configuration: serializeOperatorSettings(next, true), revision: savedRevision }
			}),
		setPaused: paused =>
			queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({ ...settings, paused }))
				state.paused = paused
				state.status = operatorStatusAfterPause(paused, parameters.getCursor()?.initial === false, state.lastError !== undefined)
				recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: paused ? 'Operator paused' : 'Operator resumed', reason: 'Dashboard command saved for restart', reportId: undefined })
			}),
		updateConnectivity: async value => {
			const next = validateConnectivitySettingsForQuorum(value, (pending.deployment ?? fixedState.deployment).quorumRpcUrls)
			await updateConnectivityEndpointChecks(state, () => checkConnectivity(next, config.network.chain.id))
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => {
					validateIndependentReadRpcUrls(next.readRpcUrl, settings.deployment.quorumRpcUrls)
					return { ...settings, connectivity: next }
				})
				pending.connectivity = next
				recordOperation(state, { category: 'configuration', details: next.publicRpcUrls.map(endpointLabel).join(', '), level: 'info', message: 'RPC configuration verified and saved', reason: `Read RPC ${endpointLabel(next.readRpcUrl)}`, reportId: undefined })
				return next
			})
		},
		updateDeployment: value => {
			const next = validateDeploymentSettings(value)
			validateIndependentReadRpcUrls((pending.connectivity ?? config.connectivity).readRpcUrl, next.quorumRpcUrls)
			return queueSettingsUpdate(async () => {
				const previous = pending.deployment ?? fixedState.deployment
				const tokens = prepareDeploymentTokenTransition(pending.tokenAddresses ?? config.tokenAddresses, pending.restartTokenAddresses, previous.rep, next.rep)
				await persistFocusedSettings(settings => {
					assertFocusedDeploymentCompatible(next.rep, settings.centralizedMarkets)
					validateIndependentReadRpcUrls(settings.connectivity.readRpcUrl, next.quorumRpcUrls)
					return { ...settings, deployment: next, tokenAddresses: tokens.restart }
				})
				pending.deployment = next
				pending.tokenAddresses = tokens.active
				pending.restartTokenAddresses = tokens.restart
				fixedState.deployment = next
				recordOperation(state, { category: 'configuration', details: `OpenOracle ${next.openOracle}; executor ${next.executor ?? 'not configured'}`, level: 'info', message: 'Deployment configuration saved', reason: 'Protocol identities and independent RPCs apply after restart', reportId: undefined })
				return next
			})
		},
		predictExecutor: value => {
			if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('salt' in value)) throw new Error('Executor prediction requires only a CREATE2 salt')
			const plan = executorDeploymentPlan(value['salt'])
			return { address: plan.address, salt: plan.salt }
		},
		deployExecutor: async value => {
			if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 || !('salt' in value)) throw new Error('Executor deployment requires only a CREATE2 salt')
			if (config.execute && !state.paused) throw new Error('Pause execution before deploying with the active signer')
			if (config.privateKey === undefined) throw new Error('Set an execution signer before deploying the executor')
			const deploymentConnectivity = pending.connectivity ?? config.connectivity
			const plan = executorDeploymentPlan(value['salt'])
			if (!signerOperationGate.acquire('deployment')) throw new Error('Wait for the active signer operation to finish before deploying the executor')
			let deployed: Awaited<ReturnType<typeof deployExecutorCreate2>>
			try {
				deployed = await deployExecutorFromConnectivity({ chain: config.network.chain, connectivity: deploymentConnectivity, privateKey: config.privateKey, salt: plan.salt })
			} finally {
				signerOperationGate.release('deployment')
			}
			const next = { ...(pending.deployment ?? fixedState.deployment), deploymentManifest: undefined, executor: deployed.address }
			await queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({ ...settings, deployment: next }))
				pending.deployment = next
				fixedState.deployment = next
				recordOperation(state, {
					category: 'transaction',
					details: deployed.transactionHash,
					level: 'info',
					message: deployed.alreadyDeployed ? 'CREATE2 executor already deployed and verified' : 'CREATE2 executor deployed and verified',
					reason: `Saved predictable executor ${deployed.address} for restart`,
					reportId: undefined,
				})
			})
			return deployed
		},
		updateSigner: async value => {
			const signerRecord = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
			if (signerRecord !== undefined && Object.keys(signerRecord).length === 1 && signerRecord['forgetSavedSigner'] === true) {
				return queueSettingsUpdate(async () => {
					await persistFocusedSettings(settings => ({ ...settings, privateKey: undefined }))
					config.persistedPrivateKey = undefined
					fixedState.savedWallet = undefined
					recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: 'Saved signer forgotten', reason: 'Active in-memory signer unchanged', reportId: undefined })
					return { wallet: fixedState.wallet }
				})
			}
			if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('privateKey' in value) || !('rememberSigner' in value) || typeof value['rememberSigner'] !== 'boolean') throw new Error('Signer request requires privateKey and rememberSigner, or forgetSavedSigner')
			const candidate = signerCandidate(value['privateKey'])
			const rememberSigner = candidate.privateKey !== undefined && value['rememberSigner']
			return queueSettingsUpdate(async () => {
				const keepsActiveSigner = candidate.address !== undefined && fixedState.wallet !== undefined && candidate.address.toLowerCase() === fixedState.wallet.toLowerCase()
				const keepsPendingSigner = candidate.address !== undefined && fixedState.queuedWallet !== undefined && fixedState.queuedWallet !== null && candidate.address.toLowerCase() === fixedState.queuedWallet.toLowerCase() && pending.signerLock !== undefined
				let acquiredSignerLock: ExclusiveProcessLock | undefined
				if (config.execute && candidate.address !== undefined && !keepsActiveSigner && !keepsPendingSigner) {
					if (lockManager === undefined) throw new Error('Execution signer lock management is unavailable')
					acquiredSignerLock = await lockManager.acquireSigner(candidate.address)
				}
				let persistedPrivateKey = config.persistedPrivateKey
				if (candidate.privateKey === undefined) persistedPrivateKey = undefined
				else if (rememberSigner) persistedPrivateKey = candidate.privateKey
				await persistSignerSettingsWithProvisionalLock(() => persistFocusedSettings(settings => ({ ...settings, privateKey: persistedPrivateKey })).then(() => undefined), acquiredSignerLock, lockManager)
				let nextPendingSignerLock = acquiredSignerLock
				if (keepsActiveSigner) nextPendingSignerLock = undefined
				else if (keepsPendingSigner) nextPendingSignerLock = pending.signerLock
				if (pending.signerLock !== undefined && pending.signerLock !== nextPendingSignerLock && lockManager !== undefined) await lockManager.release(pending.signerLock)
				pending.signerLock = nextPendingSignerLock
				config.persistedPrivateKey = persistedPrivateKey
				pending.privateKey = candidate.privateKey
				pending.signerUpdate = true
				fixedState.queuedWallet = candidate.address ?? null
				fixedState.savedWallet = persistedPrivateKey === undefined ? undefined : privateKeyToAccount(persistedPrivateKey).address
				recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: candidate.address === undefined ? 'Signer clear queued and saved' : `Signer ${candidate.address} queued${rememberSigner ? ' and remembered' : ''}`, reason: 'Applied at the next scan boundary', reportId: undefined })
				return { wallet: candidate.address }
			})
		},
		updateSubmission: async value => {
			const next = validateSubmissionSettings(value)
			await updateSubmissionEndpointChecks(state, () => checkSubmissionEndpoints(next, config.network.chain.id))
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({ ...settings, submission: next }))
				pending.submission = next
				recordOperation(state, { category: 'configuration', details: next.relayUrls.map(endpointLabel).join(', ') || undefined, level: 'info', message: `Submission mode ${next.mode} verified and saved`, reason: 'Applied at the next scan boundary', reportId: undefined })
				return next
			})
		},
		updateTokens: value => {
			if (!Array.isArray(value) || value.some(address => typeof address !== 'string')) throw new Error('Token configuration must be an array of addresses')
			const parsedAddresses: Address[] = [config.network.rep]
			for (const address of value) {
				if (typeof address !== 'string') throw new Error('Token configuration must be an array of addresses')
				const token = getAddress(address)
				if (!authenticatedExecutionToken(config, token)) throw new Error(`Execution token ${token} is not authenticated by the deployment manifest`)
				parsedAddresses.push(token)
			}
			const next = [...new Map(parsedAddresses.map(address => [address.toLowerCase(), address])).values()]
			return queueSettingsUpdate(async () => {
				const restartTokens = pending.deployment === undefined ? next : replacePrimaryRepToken(next, config.network.rep, pending.deployment.rep)
				await persistFocusedSettings(settings => ({ ...settings, tokenAddresses: restartTokens }))
				pending.tokenAddresses = next
				pending.restartTokenAddresses = restartTokens
				recordOperation(state, { category: 'configuration', details: next.join(', '), level: 'info', message: 'Execution token allowlist saved and queued', reason: 'Explicitly configured tokens become executable at the next block scan', reportId: undefined })
				return next
			})
		},
		updateStrategy: async value => {
			const next = mutableStrategy(pending.strategy ?? config)
			updateStrategyFromRequest(next, value)
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({ ...settings, strategy: next }))
				pending.strategy = next
				recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: 'Strategy update saved and queued', reason: 'Applied at the next scan boundary', reportId: undefined })
				return strategySettings(next)
			})
		},
	})
	return { dashboard, pending }
}
