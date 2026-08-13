import { getAddress, privateKeyToAccount, type Address, type Hex } from '#ethereum'
import { assertDistinctPersistentPaths, mutableStrategy, type Configuration } from '#config/configuration'
import { assertFocusedDeploymentCompatible, prepareDeploymentTokenTransition, replacePrimaryRepToken, validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'
import { configurationRevisionConflict, loadOperatorSettingsWithRevision, parseOperatorSettings, saveOperatorSettings, serializeOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { signerCandidate } from '#config/signer'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { deployExecutorCreate2, executorDeploymentPlan } from '#execution/create2-executor'
import { clearExecutorDeploymentIntent, executorDeploymentIntentPath, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { persistSignerSettingsWithProvisionalLock } from '#execution/execution-locks'
import type { SignerOperationGate } from '#execution/signer-operation-gate'
import { validateSubmissionSettings, type SubmissionSettings } from '#execution/transaction-submission'
import { authenticatedExecutionToken } from '#config/runtime-deployment'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, updateSubmissionEndpointChecks, validateIndependentReadRpcUrls, type ConnectivitySettings } from '#monitoring/connectivity'
import { operatorStatusAfterPause, type SyncCursor } from '#monitoring/block-sync'
import { operatorSnapshot, recordOperation, strategySettings, updateStrategyFromRequest, type MutableStrategy, type OperatorSnapshotFixedState, type OperatorState } from '#state/operator-state'
import type { ExclusiveProcessLock } from '#state/position-store'
import { checkIndependentRpcChains, updateOperatorConnectivity } from './connectivity-update.ts'

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

export async function deployExecutorFromConnectivity(
	parameters: {
		chain: Configuration['network']['chain']
		connectivity: ConnectivitySettings
		existingIntent?: Awaited<ReturnType<typeof loadExecutorDeploymentIntent>> | undefined
		persistIntent?: Parameters<typeof deployExecutorCreate2>[0]['persistIntent']
		privateKey: Hex
		quorumRpcUrls: readonly string[]
		salt: unknown
	},
	deploy: typeof deployExecutorCreate2 = deployExecutorCreate2,
) {
	if (parameters.connectivity.publicRpcUrls.length === 0) throw new Error('Configure a public submission RPC before deploying the executor')
	const readRpcUrls = [parameters.connectivity.readRpcUrl, ...parameters.quorumRpcUrls]
	if (readRpcUrls.length < 3) throw new Error('Executor deployment requires three independently configured read RPC endpoints')
	return await deploy({ chain: parameters.chain, existingIntent: parameters.existingIntent, persistIntent: parameters.persistIntent, privateKey: parameters.privateKey, readRpcUrls, rpcUrls: parameters.connectivity.publicRpcUrls, salt: parameters.salt })
}

export function requireActivePersistedNetwork(activeNetwork: Configuration['network']['name'], persistedNetwork: PersistedOperatorSettings['network']) {
	if (persistedNetwork !== activeNetwork) throw new Error('Restart to apply the saved network before deploying the executor')
}

export function requirePausedExecutorDeployment(execute: boolean, paused: boolean) {
	if (execute && !paused) throw new Error('Pause execution before deploying with the active signer')
}

export async function requireNoPendingExecutorDeployment(settingsFile: string) {
	if ((await loadExecutorDeploymentIntent(executorDeploymentIntentPath(settingsFile))) !== undefined) throw new Error('Recover the pending executor deployment before resuming execution')
}

export type DeploymentRecoveryState = { pending: boolean }

export function acquireScanSignerOperation(signerOperationGate: SignerOperationGate, deploymentRecovery: DeploymentRecoveryState) {
	if (deploymentRecovery.pending) return false
	return signerOperationGate.acquire('scan')
}

export function startOperatorControlPlane(parameters: {
	config: Configuration
	deploymentRecovery: DeploymentRecoveryState
	fixedState: OperatorSnapshotFixedState & { deployment: DeploymentSettings }
	getCursor: () => SyncCursor | undefined
	lockManager: ExecutionLockManager | undefined
	signerOperationGate: SignerOperationGate
	state: OperatorState
}) {
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
				if (latest.settings.networkConfigured && (!next.networkConfigured || next.network !== latest.settings.network)) throw new Error('Use a separate operator configuration and durable journal paths to change chains')
				const expectedChainId = next.network === 'mainnet' ? 1 : 11_155_111
				if (next.networkConfigured) {
					await checkConnectivity(next.connectivity, expectedChainId)
					await checkIndependentRpcChains(next.deployment.quorumRpcUrls, expectedChainId)
					await checkSubmissionEndpoints(next.submission, expectedChainId)
				}
				const savedRevision = await persistSettings(next, value.revision)
				pending.connectivity = undefined
				pending.deployment = undefined
				pending.strategy = undefined
				pending.submission = undefined
				pending.tokenAddresses = undefined
				pending.restartTokenAddresses = undefined
				config.persistedPrivateKey = next.privateKey
				fixedState.savedWallet = next.privateKey === undefined ? undefined : privateKeyToAccount(next.privateKey).address
				recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: 'Complete operator configuration saved', reason: 'All fields apply after restart', reportId: undefined })
				return { configuration: serializeOperatorSettings(next, true), revision: savedRevision }
			}),
		setPaused: paused =>
			queueSettingsUpdate(async () => {
				if (!paused && !config.networkConfigured) throw new Error('Configure the chain and RPC endpoints, then restart before resuming')
				if (!paused) await requireNoPendingExecutorDeployment(config.settingsFile)
				await persistFocusedSettings(settings => ({ ...settings, paused }))
				state.paused = paused
				state.status = operatorStatusAfterPause(paused, parameters.getCursor()?.initial === false, state.lastError !== undefined)
				recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: paused ? 'Operator paused' : 'Operator resumed', reason: 'Dashboard command saved for restart', reportId: undefined })
			}),
		updateConnectivity: async value => {
			return queueSettingsUpdate(async () => {
				if (pending.deployment !== undefined) throw new Error('Restart to apply the saved deployment and quorum RPC changes before updating active connectivity')
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				if (latest.settings.networkConfigured) {
					if (typeof value !== 'object' || value === null || Array.isArray(value) || !('network' in value) || value.network !== latest.settings.network) throw new Error('Use a separate operator configuration and durable journal paths to change chains')
				}
				const next = await updateOperatorConnectivity({
					activeNetwork: config.networkConfigured ? config.network.name : undefined,
					deployment: latest.settings.deployment,
					endpointState: state,
					execute: config.execute || latest.settings.runtime.execute,
					persist: async update => {
						await persistSettings(update(latest.settings), latest.revision)
					},
					submission: latest.settings.submission,
					value,
				})
				if (!next.restartRequired) {
					pending.connectivity = next.connectivity
				}
				recordOperation(state, {
					category: 'configuration',
					details: next.connectivity.publicRpcUrls.map(endpointLabel).join(', '),
					level: 'info',
					message: 'Network and RPC configuration verified and saved',
					reason: next.restartRequired ? `Restart to apply ${next.network}` : `Read RPC ${endpointLabel(next.connectivity.readRpcUrl)}`,
					reportId: undefined,
				})
				return next
			})
		},
		updateDeployment: value => {
			const next = validateDeploymentSettings(value)
			return queueSettingsUpdate(async () => {
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				if ((config.execute || latest.settings.runtime.execute) && next.quorumRpcUrls.length < 2) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
				assertFocusedDeploymentCompatible(next.rep, latest.settings.centralizedMarkets)
				validateIndependentReadRpcUrls(latest.settings.connectivity.readRpcUrl, next.quorumRpcUrls)
				const expectedChainId = latest.settings.network === 'mainnet' ? 1 : 11_155_111
				await checkIndependentRpcChains(next.quorumRpcUrls, expectedChainId)
				const persistedTokens = prepareDeploymentTokenTransition(latest.settings.tokenAddresses, undefined, latest.settings.deployment.rep, next.rep)
				await persistSettings({ ...latest.settings, deployment: next, tokenAddresses: persistedTokens.restart }, latest.revision)
				const activeDeployment = pending.deployment ?? fixedState.deployment
				const activeTokens = prepareDeploymentTokenTransition(pending.tokenAddresses ?? config.tokenAddresses, pending.restartTokenAddresses, activeDeployment.rep, next.rep)
				pending.deployment = next
				pending.tokenAddresses = activeTokens.active
				pending.restartTokenAddresses = persistedTokens.restart
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
			requirePausedExecutorDeployment(config.execute, state.paused)
			if (config.privateKey === undefined) throw new Error('Set an execution signer before deploying the executor')
			const privateKey = config.privateKey
			const plan = executorDeploymentPlan(value['salt'])
			return await queueSettingsUpdate(async () => {
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				requireActivePersistedNetwork(config.network.name, latest.settings.network)
				requirePausedExecutorDeployment(config.execute, state.paused)
				if (!signerOperationGate.acquire('deployment')) throw new Error('Wait for the active signer operation to finish before deploying the executor')
				const intentPath = executorDeploymentIntentPath(config.settingsFile)
				let deployed: Awaited<ReturnType<typeof deployExecutorCreate2>>
				try {
					const existingIntent = await loadExecutorDeploymentIntent(intentPath)
					deployed = await deployExecutorFromConnectivity({
						chain: config.network.chain,
						connectivity: latest.settings.connectivity,
						existingIntent,
						persistIntent: intent => saveExecutorDeploymentIntent(intentPath, intent),
						privateKey,
						quorumRpcUrls: latest.settings.deployment.quorumRpcUrls,
						salt: plan.salt,
					})
				} finally {
					signerOperationGate.release('deployment')
				}
				const next = { ...latest.settings.deployment, deploymentManifest: undefined, executor: deployed.address }
				await persistSettings({ ...latest.settings, deployment: next }, latest.revision)
				await clearExecutorDeploymentIntent(intentPath)
				parameters.deploymentRecovery.pending = false
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
				return deployed
			})
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
			return queueSettingsUpdate(async () => {
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				const expectedChainId = latest.settings.network === 'mainnet' ? 1 : 11_155_111
				if (latest.settings.network === config.network.name) await updateSubmissionEndpointChecks(state, () => checkSubmissionEndpoints(next, expectedChainId))
				else await checkSubmissionEndpoints(next, expectedChainId)
				await persistSettings({ ...latest.settings, submission: next }, latest.revision)
				if (latest.settings.network === config.network.name) pending.submission = next
				recordOperation(state, {
					category: 'configuration',
					details: next.relayUrls.map(endpointLabel).join(', ') || undefined,
					level: 'info',
					message: `Submission mode ${next.mode} verified and saved`,
					reason: latest.settings.network === config.network.name ? 'Applied at the next scan boundary' : 'Applies after restart with the saved network',
					reportId: undefined,
				})
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
