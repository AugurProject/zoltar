import { resolve } from 'node:path'
import { getAddress, privateKeyToAccount, type Address, type Hex } from '#ethereum'
import { assertDistinctPersistentPaths, mutableStrategy, type Configuration } from '#config/configuration'
import { assertFocusedDeploymentCompatible, prepareDeploymentTokenTransition, validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'
import { configurationRevisionConflict, loadOperatorSettingsWithRevision, parseOperatorSettings, saveOperatorSettings, serializeOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import { signerCandidate } from '#config/signer'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { deployExecutorCreate2, executorDeploymentPlan } from '#execution/create2-executor'
import { acquireExecutorDeploymentIntentLock, clearExecutorDeploymentIntent, executorDeploymentIntentPath, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { persistSignerSettingsWithProvisionalLock } from '#execution/execution-locks'
import type { SignerOperationGate } from '#execution/signer-operation-gate'
import { validateSubmissionSettings, type SubmissionSettings } from '#execution/transaction-submission'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, updateSubmissionEndpointChecks, validateIndependentReadRpcUrls, type ConnectivitySettings } from '#monitoring/connectivity'
import { operatorStatusAfterPause, type SyncCursor } from '#monitoring/block-sync'
import { operatorSnapshot, recordOperation, strategySettings, updateStrategyFromRequest, type MutableStrategy, type OperatorSnapshotFixedState, type OperatorState } from '#state/operator-state'
import type { ExclusiveProcessLock, PositionRecord } from '#state/position-store'
import { checkIndependentRpcChains, updateOperatorConnectivity } from './connectivity-update.ts'
import { configuredQuorumRpcUrlMinimum, configuredReadRpcEndpointMinimum, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { networkConfiguration } from '#config/network'
import { positionConsumesRisk, type RiskLimits } from '#core/safety-controls'
import type { CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'

export type PendingOperatorUpdates = {
	centralizedMarkets: CentralizedMarketSettings | undefined
	connectivity: ConnectivitySettings | undefined
	deployment: DeploymentSettings | undefined
	execute: boolean | undefined
	lookbackBlocks: bigint | undefined
	maxHedgeSlippageBps: bigint | undefined
	operatorSettings: PersistedOperatorSettings | undefined
	paused: boolean | undefined
	privateKey: Hex | undefined
	persistedPrivateKey: Hex | undefined
	persistedTokenAddresses: Address[] | undefined
	riskLimits: RiskLimits | undefined
	rpcQuorum: RpcQuorumRequirement | undefined
	signerLock: ExclusiveProcessLock | undefined
	signerUpdate: boolean
	strategy: MutableStrategy | undefined
	submission: SubmissionSettings | undefined
	tokenAddresses: Address[] | undefined
}

export function deploymentIdentityChanged(current: DeploymentSettings, next: DeploymentSettings) {
	return current.openOracle.toLowerCase() !== next.openOracle.toLowerCase() || current.executor?.toLowerCase() !== next.executor?.toLowerCase() || current.rep.toLowerCase() !== next.rep.toLowerCase() || current.weth.toLowerCase() !== next.weth.toLowerCase()
}

export function deploymentUpdateMustWait(current: DeploymentSettings, next: DeploymentSettings, positions: readonly Pick<PositionRecord, 'status'>[]) {
	return deploymentIdentityChanged(current, next) && positions.some(position => positionConsumesRisk(position.status))
}

export function tokenUpdateForDeployment(value: readonly string[], previousRep: Address, deployment: DeploymentSettings, execute: boolean) {
	const parsedAddresses: Address[] = [deployment.rep]
	for (const address of value) {
		const token = getAddress(address)
		if (token.toLowerCase() === previousRep.toLowerCase() && token.toLowerCase() !== deployment.rep.toLowerCase()) continue
		const authenticated = !execute || deployment.deploymentManifest?.contracts.some(entry => entry.role === 'token' && entry.address.toLowerCase() === token.toLowerCase()) === true
		if (!authenticated) throw new Error(`Execution token ${token} is not authenticated by the deployment manifest`)
		parsedAddresses.push(token)
	}
	return [...new Map(parsedAddresses.map(address => [address.toLowerCase(), address])).values()]
}

export function requireSafeDeploymentTransition(state: Pick<OperatorState, 'positions'>, current: DeploymentSettings, next: DeploymentSettings) {
	if (deploymentUpdateMustWait(current, next, state.positions)) {
		throw new Error('OpenOracle, executor, REP, and WETH deployment identities cannot change while a position still consumes risk')
	}
}

export async function deployExecutorFromConnectivity(
	parameters: {
		chain: Configuration['network']['chain']
		connectivity: ConnectivitySettings
		existingIntent?: Awaited<ReturnType<typeof loadExecutorDeploymentIntent>> | undefined
		persistIntent?: Parameters<typeof deployExecutorCreate2>[0]['persistIntent']
		privateKey: Hex
		quorumRpcUrls: readonly string[]
		rpcQuorum: Configuration['rpcQuorum']
		salt: unknown
	},
	deploy: typeof deployExecutorCreate2 = deployExecutorCreate2,
) {
	if (parameters.connectivity.publicRpcUrls.length === 0) throw new Error('Configure a public submission RPC before deploying the executor')
	const readRpcUrls = [parameters.connectivity.readRpcUrl, ...parameters.quorumRpcUrls]
	if (readRpcUrls.length < configuredReadRpcEndpointMinimum(parameters.rpcQuorum)) throw new Error('Executor deployment requires three independently configured read RPC endpoints')
	return await deploy({
		chain: parameters.chain,
		existingIntent: parameters.existingIntent,
		persistIntent: parameters.persistIntent,
		privateKey: parameters.privateKey,
		readRpcUrls,
		rpcUrls: parameters.connectivity.publicRpcUrls,
		salt: parameters.salt,
	})
}

export function requireActivePersistedNetwork(activeNetwork: Configuration['network']['name'], persistedNetwork: PersistedOperatorSettings['network']) {
	if (persistedNetwork !== activeNetwork) throw new Error('Wait for the saved network to apply at the next scan boundary before deploying the executor')
}

export function requireActivePersistedRpcQuorum(activeRpcQuorum: Configuration['rpcQuorum'], persistedRpcQuorum: PersistedOperatorSettings['rpcQuorum']) {
	if (persistedRpcQuorum !== activeRpcQuorum) throw new Error('Wait for the saved RPC agreement requirement to apply at the next scan boundary before deploying the executor')
}

export function requirePausedExecutorDeployment(execute: boolean, paused: boolean) {
	if (execute && !paused) throw new Error('Pause execution before deploying with the active signer')
}

export async function requireNoPendingExecutorDeployment(settingsFile: string) {
	if ((await loadExecutorDeploymentIntent(executorDeploymentIntentPath(settingsFile))) !== undefined) throw new Error('Recover the pending executor deployment before resuming execution')
}

export type DeploymentRecoveryState = { pending: boolean }

export async function acquireScanSignerOperation(signerOperationGate: SignerOperationGate, deploymentRecovery: DeploymentRecoveryState, intentPath: string) {
	if (deploymentRecovery.pending) return undefined
	const intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
	try {
		if ((await loadExecutorDeploymentIntent(intentPath)) !== undefined) {
			deploymentRecovery.pending = true
			await intentLock.release()
			return undefined
		}
		if (!signerOperationGate.acquire('scan')) {
			await intentLock.release()
			return undefined
		}
		return intentLock
	} catch (error) {
		await intentLock.release()
		throw error
	}
}

export async function acquireConfigurationSignerOperation(signerOperationGate: SignerOperationGate) {
	while (!signerOperationGate.acquire('configuration')) await Bun.sleep(10)
}

export async function persistExecutorDeploymentIntentForRecovery(path: string, intent: Parameters<typeof saveExecutorDeploymentIntent>[1], deploymentRecovery: DeploymentRecoveryState) {
	deploymentRecovery.pending = true
	await saveExecutorDeploymentIntent(path, intent)
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
		centralizedMarkets: undefined,
		connectivity: undefined,
		deployment: undefined,
		execute: undefined,
		lookbackBlocks: undefined,
		maxHedgeSlippageBps: undefined,
		operatorSettings: undefined,
		paused: undefined,
		privateKey: undefined,
		persistedPrivateKey: undefined,
		persistedTokenAddresses: undefined,
		riskLimits: undefined,
		rpcQuorum: undefined,
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
			return {
				configuration: serializeOperatorSettings(loaded.settings, true),
				revision: loaded.revision,
			}
		},
		getSnapshot: () => operatorSnapshot(state, pending.strategy ?? config, pending.submission ?? config.submission, pending.connectivity ?? config.connectivity, fixedState, config.riskLimits),
		hostname: config.uiHost,
		loopbackPublished: process.env['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED'] === 'true',
		password: process.env['ZOLTAR_BOT_DASHBOARD_PASSWORD'],
		updateConfiguration: value =>
			queueSettingsUpdate(async () => {
				if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('configuration' in value) || !('revision' in value) || typeof value.revision !== 'string') throw new Error('Complete configuration updates require configuration and revision')
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined || latest.revision !== value.revision) throw configurationRevisionConflict()
				const next = parseOperatorSettings(value.configuration, latest.settings.privateKey)
				assertDistinctPersistentPaths(config.settingsFile, next.runtime)
				if (latest.settings.networkConfigured && (!next.networkConfigured || next.network !== latest.settings.network)) throw new Error('Use a separate operator configuration and durable journal paths to change chains')
				if (
					resolve(next.runtime.historyFile) !== config.historyFile ||
					next.runtime.once !== config.once ||
					resolve(next.runtime.positionFile) !== config.positionFile ||
					resolve(next.runtime.priceHistoryFile) !== config.priceHistoryFile ||
					next.runtime.ui !== config.ui ||
					next.runtime.uiHost !== config.uiHost ||
					next.runtime.uiPort !== config.uiPort
				)
					throw new Error('Process mode, persistence paths, and dashboard binding cannot be changed while this operator is running')
				const expectedChainId = next.network === 'mainnet' ? 1 : 11_155_111
				if (next.networkConfigured) {
					await checkConnectivity(next.connectivity, expectedChainId)
					await checkIndependentRpcChains(next.deployment.quorumRpcUrls, expectedChainId)
					await checkSubmissionEndpoints(next.submission, expectedChainId)
				}
				if (!next.paused) await requireNoPendingExecutorDeployment(config.settingsFile)
				const signer = next.privateKey === undefined ? { address: undefined, privateKey: undefined } : signerCandidate(next.privateKey)
				if (next.runtime.execute && signer.address === undefined) throw new Error('Execution requires an active signer')
				const keepsActiveSigner = fixedState.execute && signer.address !== undefined && fixedState.wallet !== undefined && signer.address.toLowerCase() === fixedState.wallet.toLowerCase()
				const keepsPendingSigner = signer.address !== undefined && fixedState.queuedWallet !== undefined && fixedState.queuedWallet !== null && signer.address.toLowerCase() === fixedState.queuedWallet.toLowerCase() && pending.signerLock !== undefined
				const tokens = prepareDeploymentTokenTransition(next.tokenAddresses, undefined, latest.settings.deployment.rep, next.deployment.rep)
				const normalizedNext = { ...next, tokenAddresses: tokens.persisted }
				const previousPendingSignerLock = pending.signerLock
				await acquireConfigurationSignerOperation(signerOperationGate)
				let acquiredSignerLock: ExclusiveProcessLock | undefined
				let nextPendingSignerLock: ExclusiveProcessLock | undefined
				let savedRevision = ''
				try {
					requireSafeDeploymentTransition(state, pending.deployment ?? fixedState.deployment, next.deployment)
					if (next.runtime.execute && signer.address !== undefined && !keepsActiveSigner && !keepsPendingSigner) {
						if (lockManager === undefined) throw new Error('Execution signer lock management is unavailable')
						acquiredSignerLock = await lockManager.acquireSigner(signer.address)
					}
					await persistSignerSettingsWithProvisionalLock(
						async () => {
							savedRevision = await persistSettings(normalizedNext, value.revision)
						},
						acquiredSignerLock,
						lockManager,
					)
					nextPendingSignerLock = acquiredSignerLock
					if (keepsActiveSigner) nextPendingSignerLock = undefined
					else if (keepsPendingSigner) nextPendingSignerLock = previousPendingSignerLock
					pending.centralizedMarkets = next.centralizedMarkets
					pending.connectivity = next.connectivity
					pending.deployment = next.deployment
					pending.execute = next.runtime.execute
					pending.lookbackBlocks = next.runtime.lookbackBlocks
					pending.maxHedgeSlippageBps = next.runtime.maxHedgeSlippageBps
					pending.operatorSettings = normalizedNext
					pending.paused = next.paused
					pending.persistedPrivateKey = next.privateKey
					pending.persistedTokenAddresses = tokens.persisted
					pending.privateKey = signer.privateKey
					pending.riskLimits = next.runtime.riskLimits
					pending.rpcQuorum = next.rpcQuorum
					pending.signerLock = nextPendingSignerLock
					pending.signerUpdate = true
					pending.strategy = mutableStrategy(next.strategy)
					pending.submission = next.submission
					pending.tokenAddresses = tokens.active
					if (!config.networkConfigured && next.networkConfigured) {
						config.network = networkConfiguration(next.network, {
							factory: next.deployment.uniswapFactory,
							quoter: next.deployment.uniswapQuoter,
							rep: next.deployment.rep,
							weth: next.deployment.weth,
						})
						config.networkConfigured = true
						fixedState.network = config.network.name
						fixedState.expectedChainId = config.network.chain.id
						fixedState.explorerUrl = config.network.explorerUrl
						fixedState.networkConfigured = true
					}
					fixedState.queuedWallet = signer.address ?? null
					fixedState.savedWallet = next.privateKey === undefined ? undefined : privateKeyToAccount(next.privateKey).address
				} finally {
					signerOperationGate.release('configuration')
				}
				if (previousPendingSignerLock !== undefined && previousPendingSignerLock !== nextPendingSignerLock && lockManager !== undefined) await lockManager.release(previousPendingSignerLock)
				if (next.paused) {
					state.paused = true
					state.status = operatorStatusAfterPause(true, parameters.getCursor()?.initial === false, state.lastError !== undefined)
				}
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: 'Complete operator configuration saved',
					reason: 'Live settings apply automatically at scan boundaries',
					reportId: undefined,
				})
				return {
					configuration: serializeOperatorSettings(normalizedNext, true),
					revision: savedRevision,
				}
			}),
		setPaused: paused =>
			queueSettingsUpdate(async () => {
				if (!paused && !config.networkConfigured) throw new Error('Configure the chain and RPC endpoints before resuming')
				if (!paused) await requireNoPendingExecutorDeployment(config.settingsFile)
				await persistFocusedSettings(settings => ({ ...settings, paused }))
				pending.paused = paused
				if (paused) {
					state.paused = true
					state.status = operatorStatusAfterPause(true, parameters.getCursor()?.initial === false, state.lastError !== undefined)
				}
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: paused ? 'Operator paused' : 'Operator resume queued',
					reason: paused ? 'Execution stopped immediately and the preference was saved' : 'Saved and queued for the next scan boundary',
					reportId: undefined,
				})
			}),
		updateConnectivity: async value => {
			return queueSettingsUpdate(async () => {
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				if (latest.settings.networkConfigured) {
					if (typeof value !== 'object' || value === null || Array.isArray(value) || !('network' in value) || value.network !== latest.settings.network) throw new Error('Use a separate operator configuration and durable journal paths to change chains')
				}
				const next = await updateOperatorConnectivity({
					activeNetwork: config.networkConfigured ? config.network.name : undefined,
					activeRpcQuorum: config.rpcQuorum,
					deployment: latest.settings.deployment,
					endpointState: state,
					execute: config.execute || latest.settings.runtime.execute,
					persist: async update => {
						await persistSettings(update(latest.settings), latest.revision)
					},
					submission: latest.settings.submission,
					value,
				})
				if (!config.networkConfigured) {
					config.network = networkConfiguration(next.network, {
						factory: latest.settings.deployment.uniswapFactory,
						quoter: latest.settings.deployment.uniswapQuoter,
						rep: latest.settings.deployment.rep,
						weth: latest.settings.deployment.weth,
					})
					config.networkConfigured = true
					fixedState.network = config.network.name
					fixedState.expectedChainId = config.network.chain.id
					fixedState.explorerUrl = config.network.explorerUrl
					fixedState.networkConfigured = true
				}
				pending.centralizedMarkets = next.centralizedMarkets
				pending.rpcQuorum = next.rpcQuorum
				pending.connectivity = next.connectivity
				recordOperation(state, {
					category: 'configuration',
					details: next.connectivity.publicRpcUrls.map(endpointLabel).join(', '),
					level: 'info',
					message: 'Network and RPC configuration verified and saved',
					reason: `Read RPC ${endpointLabel(next.connectivity.readRpcUrl)}; applies at the next scan boundary`,
					reportId: undefined,
				})
				return {
					connectivity: next.connectivity,
					network: next.network,
					rpcQuorum: next.rpcQuorum,
				}
			})
		},
		updateDeployment: value => {
			const next = validateDeploymentSettings(value)
			return queueSettingsUpdate(async () => {
				const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
				if (latest === undefined) throw configurationRevisionConflict()
				if ((config.execute || latest.settings.runtime.execute) && next.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(latest.settings.rpcQuorum)) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
				assertFocusedDeploymentCompatible(next.rep, latest.settings.centralizedMarkets)
				validateIndependentReadRpcUrls(latest.settings.connectivity.readRpcUrl, next.quorumRpcUrls)
				const expectedChainId = latest.settings.network === 'mainnet' ? 1 : 11_155_111
				await checkIndependentRpcChains(next.quorumRpcUrls, expectedChainId)
				const persistedTokens = prepareDeploymentTokenTransition(latest.settings.tokenAddresses, undefined, latest.settings.deployment.rep, next.rep)
				await acquireConfigurationSignerOperation(signerOperationGate)
				try {
					requireSafeDeploymentTransition(state, pending.deployment ?? fixedState.deployment, next)
					await persistSettings(
						{
							...latest.settings,
							deployment: next,
							tokenAddresses: persistedTokens.persisted,
						},
						latest.revision,
					)
				} finally {
					signerOperationGate.release('configuration')
				}
				const activeDeployment = pending.deployment ?? fixedState.deployment
				const activeTokens = prepareDeploymentTokenTransition(pending.tokenAddresses ?? config.tokenAddresses, pending.persistedTokenAddresses, activeDeployment.rep, next.rep)
				pending.deployment = next
				pending.tokenAddresses = activeTokens.active
				pending.persistedTokenAddresses = persistedTokens.persisted
				recordOperation(state, {
					category: 'configuration',
					details: `OpenOracle ${next.openOracle}; executor ${next.executor ?? 'not configured'}`,
					level: 'info',
					message: 'Deployment configuration saved',
					reason: 'Applies at the next scan boundary',
					reportId: undefined,
				})
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
				const intentPath = executorDeploymentIntentPath(config.settingsFile)
				const intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
				let deploymentSignerLock: ExclusiveProcessLock | undefined
				let signerOperationAcquired = false
				try {
					const latest = await loadOperatorSettingsWithRevision(config.settingsFile)
					if (latest === undefined) throw configurationRevisionConflict()
					requireActivePersistedNetwork(config.network.name, latest.settings.network)
					requireActivePersistedRpcQuorum(config.rpcQuorum, latest.settings.rpcQuorum)
					requirePausedExecutorDeployment(config.execute, state.paused)
					if (lockManager === undefined) throw new Error('Executor deployment signer lock management is unavailable')
					if (!config.execute) deploymentSignerLock = await lockManager.acquireSigner(privateKeyToAccount(privateKey).address)
					if (!signerOperationGate.acquire('deployment')) throw new Error('Wait for the active signer operation to finish before deploying the executor')
					signerOperationAcquired = true
					const plannedDeployment = {
						...latest.settings.deployment,
						deploymentManifest: undefined,
						executor: plan.address,
					}
					requireSafeDeploymentTransition(state, pending.deployment ?? fixedState.deployment, plannedDeployment)
					const existingIntent = await loadExecutorDeploymentIntent(intentPath)
					const deployed = await deployExecutorFromConnectivity({
						chain: config.network.chain,
						connectivity: latest.settings.connectivity,
						existingIntent,
						persistIntent: intent => persistExecutorDeploymentIntentForRecovery(intentPath, intent, parameters.deploymentRecovery),
						privateKey,
						quorumRpcUrls: latest.settings.deployment.quorumRpcUrls,
						rpcQuorum: latest.settings.rpcQuorum,
						salt: plan.salt,
					})
					const next = { ...plannedDeployment, executor: deployed.address }
					await persistSettings({ ...latest.settings, deployment: next }, latest.revision)
					await clearExecutorDeploymentIntent(intentPath)
					parameters.deploymentRecovery.pending = false
					pending.deployment = next
					recordOperation(state, {
						category: 'transaction',
						details: deployed.transactionHash,
						level: 'info',
						message: deployed.alreadyDeployed ? 'CREATE2 executor already deployed and verified' : 'CREATE2 executor deployed and verified',
						reason: `Saved and queued predictable executor ${deployed.address}`,
						reportId: undefined,
					})
					return deployed
				} finally {
					if (signerOperationAcquired) signerOperationGate.release('deployment')
					try {
						if (deploymentSignerLock !== undefined && lockManager !== undefined) await lockManager.release(deploymentSignerLock)
					} finally {
						await intentLock.release()
					}
				}
			})
		},
		updateSigner: async value => {
			const signerRecord = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
			if (signerRecord !== undefined && Object.keys(signerRecord).length === 1 && signerRecord['forgetSavedSigner'] === true) {
				return queueSettingsUpdate(async () => {
					await acquireConfigurationSignerOperation(signerOperationGate)
					try {
						await persistFocusedSettings(settings => ({
							...settings,
							privateKey: undefined,
						}))
						config.persistedPrivateKey = undefined
						pending.persistedPrivateKey = undefined
						fixedState.savedWallet = undefined
					} finally {
						signerOperationGate.release('configuration')
					}
					recordOperation(state, {
						category: 'configuration',
						details: undefined,
						level: 'info',
						message: 'Saved signer forgotten',
						reason: 'Active in-memory signer unchanged',
						reportId: undefined,
					})
					return { wallet: fixedState.wallet }
				})
			}
			if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('privateKey' in value) || !('rememberSigner' in value) || typeof value['rememberSigner'] !== 'boolean') throw new Error('Signer request requires privateKey and rememberSigner, or forgetSavedSigner')
			const candidate = signerCandidate(value['privateKey'])
			const rememberSigner = candidate.privateKey !== undefined && value['rememberSigner']
			return queueSettingsUpdate(async () => {
				const effectiveExecute = pending.execute ?? config.execute
				if (effectiveExecute && candidate.address === undefined) throw new Error('Execution requires an active signer')
				const keepsActiveSigner = fixedState.execute && candidate.address !== undefined && fixedState.wallet !== undefined && candidate.address.toLowerCase() === fixedState.wallet.toLowerCase()
				const keepsPendingSigner = candidate.address !== undefined && fixedState.queuedWallet !== undefined && fixedState.queuedWallet !== null && candidate.address.toLowerCase() === fixedState.queuedWallet.toLowerCase() && pending.signerLock !== undefined
				const previousPendingSignerLock = pending.signerLock
				await acquireConfigurationSignerOperation(signerOperationGate)
				let acquiredSignerLock: ExclusiveProcessLock | undefined
				let nextPendingSignerLock: ExclusiveProcessLock | undefined
				let persistedPrivateKey = pending.signerUpdate ? pending.persistedPrivateKey : config.persistedPrivateKey
				if (candidate.privateKey === undefined) persistedPrivateKey = undefined
				else if (rememberSigner) persistedPrivateKey = candidate.privateKey
				try {
					if (effectiveExecute && candidate.address !== undefined && !keepsActiveSigner && !keepsPendingSigner) {
						if (lockManager === undefined) throw new Error('Execution signer lock management is unavailable')
						acquiredSignerLock = await lockManager.acquireSigner(candidate.address)
					}
					await persistSignerSettingsWithProvisionalLock(
						() =>
							persistFocusedSettings(settings => ({
								...settings,
								privateKey: persistedPrivateKey,
							})).then(() => undefined),
						acquiredSignerLock,
						lockManager,
					)
					nextPendingSignerLock = acquiredSignerLock
					if (keepsActiveSigner) nextPendingSignerLock = undefined
					else if (keepsPendingSigner) nextPendingSignerLock = previousPendingSignerLock
					pending.persistedPrivateKey = persistedPrivateKey
					pending.privateKey = candidate.privateKey
					pending.signerLock = nextPendingSignerLock
					pending.signerUpdate = true
					fixedState.queuedWallet = candidate.address ?? null
					fixedState.savedWallet = persistedPrivateKey === undefined ? undefined : privateKeyToAccount(persistedPrivateKey).address
				} finally {
					signerOperationGate.release('configuration')
				}
				if (previousPendingSignerLock !== undefined && previousPendingSignerLock !== nextPendingSignerLock && lockManager !== undefined) await lockManager.release(previousPendingSignerLock)
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: candidate.address === undefined ? 'Signer clear queued and saved' : `Signer ${candidate.address} queued${rememberSigner ? ' and remembered' : ''}`,
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
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
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
				return next
			})
		},
		updateTokens: value => {
			if (!Array.isArray(value) || value.some(address => typeof address !== 'string')) throw new Error('Token configuration must be an array of addresses')
			return queueSettingsUpdate(async () => {
				const effectiveDeployment = pending.deployment ?? fixedState.deployment
				const executionEnabled = pending.execute ?? config.execute
				const next = tokenUpdateForDeployment(value, fixedState.deployment.rep, effectiveDeployment, executionEnabled)
				await persistFocusedSettings(settings => ({
					...settings,
					tokenAddresses: next,
				}))
				pending.tokenAddresses = next
				pending.persistedTokenAddresses = next
				recordOperation(state, {
					category: 'configuration',
					details: next.join(', '),
					level: 'info',
					message: 'Execution token allowlist saved and queued',
					reason: 'Explicitly configured tokens become executable at the next block scan',
					reportId: undefined,
				})
				return next
			})
		},
		updateStrategy: async value => {
			const next = mutableStrategy(pending.strategy ?? config)
			updateStrategyFromRequest(next, value)
			return queueSettingsUpdate(async () => {
				await persistFocusedSettings(settings => ({
					...settings,
					strategy: next,
				}))
				pending.strategy = next
				recordOperation(state, {
					category: 'configuration',
					details: undefined,
					level: 'info',
					message: 'Strategy update saved and queued',
					reason: 'Applied at the next scan boundary',
					reportId: undefined,
				})
				return strategySettings(next)
			})
		},
	})
	return { dashboard, pending }
}
