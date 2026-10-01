import type { DeploymentSettings } from '#config/deployment-settings'
import { ensureExecutionHistoryWritable, recordOperation } from '#state/operator-state'
import { savePositionJournalState } from '#state/position-store'
import type { TransactionLog } from '@zoltar/bot-shared/ethereum'
import { deploymentUpdateMustWait } from './deployment-transition.ts'
import { applyQueuedExecutionSettings, applyQueuedSigner, resetReportScanState } from './operator-execution-state.ts'
import { clearReportCaches, createOperatorWallet, resetReadClients, type OperatorContext, type OperatorRuntime } from './operator-runtime.ts'

function applyQueuedSettingsWithScanReset(runtime: OperatorRuntime, context: OperatorContext) {
	const appliedSettings = applyQueuedExecutionSettings(context.config, context.state, context.pending)
	if (!appliedSettings.reportScanReset) return
	const reset = resetReportScanState<TransactionLog>(context.state, runtime.reports)
	runtime.cursor = reset.cursor
	runtime.cachedLogs = reset.cachedLogs
}

function recordDeploymentUpdateDeferred(context: OperatorContext) {
	const { state } = context
	state.paused = true
	state.status = 'paused'
	if (!state.operationLog.some(entry => entry.message === 'Deployment update waiting for open positions'))
		recordOperation(state, {
			category: 'configuration',
			details: undefined,
			level: 'warning',
			message: 'Deployment update waiting for open positions',
			reason: 'OpenOracle, executor, REP, and WETH identities remain unchanged until every risk-consuming position is closed',
			reportId: undefined,
		})
}

/** Returns whether execution was just requested and still awaits startup validation before it becomes active. */
async function applyQueuedExecutionMode(runtime: OperatorRuntime, context: OperatorContext) {
	const { config, fixedState, pending, state } = context
	if (pending.execute === undefined) return false
	const executionActivationPending = pending.execute && !fixedState.execute
	if (executionActivationPending) {
		if (context.lockManager === undefined) throw new Error('Execution requires exclusive journal and signer lock management')
		await ensureExecutionHistoryWritable(config.historyFile)
		runtime.positionJournal = await savePositionJournalState(config.positionFile, { archived: runtime.positionJournal.archived, positions: runtime.positions }, config.network.chain.id)
		runtime.positions = runtime.positionJournal.positions
		state.positions = runtime.positions
		state.positionArchive = runtime.positionJournal.archived
		config.execute = true
		state.paused = true
		runtime.startupValidated = false
	} else {
		config.execute = pending.execute
		fixedState.execute = pending.execute
		pending.execute = undefined
	}
	return executionActivationPending
}

function applyDeploymentUpdate(runtime: OperatorRuntime, context: OperatorContext, deployment: DeploymentSettings) {
	const { config, fixedState } = context
	context.pending.deployment = undefined
	config.coordinatorAddresses = [...deployment.coordinatorAddresses]
	config.executor = deployment.executor
	config.openOracle = deployment.openOracle
	config.quorumRpcUrls = [...deployment.quorumRpcUrls]
	config.router = deployment.uniswapRouter
	config.v2Router = deployment.uniswapV2Router
	config.v4PoolManager = deployment.uniswapV4PoolManager
	config.v4Quoter = deployment.uniswapV4Quoter
	fixedState.deployment = deployment
	fixedState.executor = deployment.executor
	fixedState.openOracle = deployment.openOracle
	config.network.rep = deployment.rep
	config.network.weth = deployment.weth
	resetReadClients(runtime, context)
	runtime.cursor = undefined
	clearReportCaches(runtime, context)
}

async function applyNetworkInitialization(runtime: OperatorRuntime, context: OperatorContext) {
	const { config, fixedState, pending } = context
	applyQueuedSettingsWithScanReset(runtime, context)
	const network = pending.network
	if (network === undefined) throw new Error('Queued network initialization is missing its network identity')
	config.network = network
	config.networkConfigured = true
	fixedState.network = network.name
	fixedState.expectedChainId = network.chain.id
	fixedState.explorerUrl = network.explorerUrl
	fixedState.networkConfigured = true
	pending.network = undefined
	await context.settlementJournal.reload()
	context.centralizedMarketSampler.wake()
}

/**
 * Applies settings, deployment, network, connectivity, and signer updates queued by the control plane at the scan
 * boundary, so no scan observes half of an update. Returns whether execution activation awaits startup validation.
 */
export async function applyScanBoundaryUpdates(runtime: OperatorRuntime, context: OperatorContext) {
	const { config, pending } = context
	let executionActivationPending = false
	const deploymentSettingsDeferred = pending.deployment !== undefined && deploymentUpdateMustWait(context.fixedState.deployment, pending.deployment, runtime.positions)
	const networkInitializationPending = pending.network !== undefined
	if (deploymentSettingsDeferred) {
		recordDeploymentUpdateDeferred(context)
		return executionActivationPending
	}
	if (!networkInitializationPending) applyQueuedSettingsWithScanReset(runtime, context)
	executionActivationPending = await applyQueuedExecutionMode(runtime, context)
	if (pending.deployment !== undefined) applyDeploymentUpdate(runtime, context, pending.deployment)
	if (networkInitializationPending) await applyNetworkInitialization(runtime, context)
	if (pending.connectivity !== undefined) {
		config.connectivity = pending.connectivity
		pending.connectivity = undefined
		resetReadClients(runtime, context)
	}
	if (pending.signerUpdate) {
		const appliedSigner = await applyQueuedSigner({
			activeSignerLock: runtime.activeSignerLock,
			config,
			createWallet: () => createOperatorWallet(config, runtime.readPool),
			fixedState: context.fixedState,
			lockManager: context.lockManager,
			pending,
			state: context.state,
			walletAddress: current => current?.account.address,
		})
		runtime.activeSignerLock = appliedSigner.activeSignerLock
		runtime.wallet = appliedSigner.wallet
	}
	if (executionActivationPending) resetReadClients(runtime, context)
	return executionActivationPending
}
