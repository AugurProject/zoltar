import type { Configuration } from '#config/configuration'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { executorDeploymentIntentPath } from '#execution/executor-deployment-store'
import { transactionLogLevel, type TrackTransaction } from '#execution/transaction-tracker'
import { createTokenMetadataCache, loadPriceHistory } from '#monitoring/market-monitor'
import { ensureExecutionHistoryWritable, loadExecutionHistory, recordOperation, type OperatorState } from '#state/operator-state'
import { loadPositionJournalState, savePositionJournalState, type ExclusiveProcessLock } from '#state/position-store'
import { emptySettlementSnapshot } from '#state/settlement-store'
import { readBotEnvironment } from '@zoltar/bot-shared/config/environment'
import { createContextualPublicClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import type { BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { createOperatorHeadWatcher, createScanWakeGate, startCentralizedMarketSampler } from './background-observers.ts'
import { createConfiguredDexPairReader } from './configured-dex-pair.ts'
import { createDeploymentRecoveryReconciliation, loadDeploymentRecovery } from './deployment-recovery.ts'
import { startOperatorControlPlane } from './operator-control-plane.ts'
import { reportOperatorStarted } from './operator-reporting.ts'
import { MAX_LOG_SCAN_RANGE, createOperatorClient, createOperatorWallet, createReadClients, createReadPool, createScanTokenCatalog, persistPosition, type ContextualRpcRead, type OperatorContext, type OperatorFixedState, type OperatorRuntime } from './operator-runtime.ts'
import { createSettlementJournal } from './settlement-stage.ts'

function validateOperatorConfiguration(config: Configuration, lockManager: ExecutionLockManager | undefined) {
	if (config.lookbackBlocks < 0n || config.lookbackBlocks > MAX_LOG_SCAN_RANGE) throw new Error('lookbackBlocks must be from 0 through 256')
	if (!Number.isSafeInteger(config.uiPort) || config.uiPort < 1 || config.uiPort > 65_535) throw new Error('ui-port must be an integer from 1 to 65535')
	if (config.ui && config.once) throw new Error('runtime.ui cannot be combined with runtime.once')
	if (config.execute && config.privateKey === undefined && !config.ui) throw new Error('Execution requires a saved privateKey unless runtime.ui is enabled to unlock the signer')
	if (config.execute && lockManager === undefined) throw new Error('Execution requires exclusive journal and signer lock management')
}

function createTransactionTracker(state: OperatorState): TrackTransaction {
	return activity => {
		state.transactionActivity = [activity, ...state.transactionActivity.filter(existing => existing.originalHash.toLowerCase() !== activity.originalHash.toLowerCase())].slice(0, 100)
		recordOperation(state, {
			category: 'transaction',
			details: activity.failedTargets.map(target => `${target.target}: ${target.error ?? 'failed'}`).join('; ') || undefined,
			level: transactionLogLevel(activity.status),
			message: `${activity.kind} ${activity.status}`,
			reason: `Transaction ${activity.hash}`,
			reportId: activity.reportId,
		})
	}
}

/**
 * Validates the configuration, restores durable journals, and starts the control plane and background observers.
 * The returned runtime holds every value a later scan may replace; the context holds the lifetime collaborators.
 */
export async function startOperator(config: Configuration, lockManager: ExecutionLockManager | undefined, initialSignerLock: ExclusiveProcessLock | undefined, shutdown: BotShutdownController | undefined, startupSignerConflict?: string) {
	validateOperatorConfiguration(config, lockManager)
	const environment = readBotEnvironment()
	if (config.execute) await ensureExecutionHistoryWritable(config.historyFile)
	let positionJournal = await loadPositionJournalState(config.positionFile, config.network.chain.id)
	const positions = positionJournal.positions
	if (config.execute) positionJournal = await savePositionJournalState(config.positionFile, positionJournal, config.network.chain.id)
	const readPool = createReadPool(config)
	const runtime: OperatorRuntime = {
		activeSignerLock: initialSignerLock,
		cachedLogs: [],
		catalogForScan: createScanTokenCatalog(() => runtime.client, config),
		client: createOperatorClient(config, readPool),
		clientRpcUrl: undefined,
		coordinatorPolicies: [],
		cursor: undefined,
		operatorStopped: false,
		positionJournal,
		positions,
		readClients: createReadClients(config, readPool),
		readPool,
		reports: new Map(),
		startupValidated: !config.networkConfigured,
		tokenMetadataCache: createTokenMetadataCache(),
		wakeCentralizedMarketSampler: undefined,
		wakeProfileSwitchWait: undefined,
		wallet: createOperatorWallet(config, readPool),
	}
	const contextualRpcRead: ContextualRpcRead = async (_method, request, explicitRpcUrl = runtime.clientRpcUrl) => await request(createOperatorClient(config, runtime.readPool, explicitRpcUrl))
	const readConfiguredDexPair = createConfiguredDexPairReader(config, contextualRpcRead)
	const executionHistory = await loadExecutionHistory(config.historyFile, config.network.chain.id)
	for (const position of runtime.positions) {
		const record = position.historyOutbox
		if (record !== undefined && !executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) executionHistory.unshift(record)
	}
	const state: OperatorState = {
		activeReportCount: 0,
		consecutivePollFailures: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		centralizedMarket: undefined,
		marketConsensus: undefined,
		marketObservations: [],
		executionHistory,
		endpointChecks: [],
		rpcEndpointHealth: runtime.readPool.snapshot(),
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		lastPollFailureAt: undefined,
		lastRetryAt: undefined,
		nextRetryAt: undefined,
		retryInProgress: false,
		opportunities: [],
		positions: runtime.positions,
		positionArchive: runtime.positionJournal.archived,
		operationLog: [],
		paused: config.paused,
		status: config.networkConfigured ? 'syncing' : 'paused',
		tokenAddresses: [],
		tokenMarkets: [],
		priceHistory: await loadPriceHistory(config.priceHistoryFile, config.network.chain.id),
		reportPaths: [],
		settlements: emptySettlementSnapshot(config.settlement),
		transactionActivity: [],
	}
	const settlementJournal = await createSettlementJournal(config, state)
	const fixedState: OperatorFixedState = {
		deployment: config.operatorSettings.deployment,
		execute: config.execute,
		executor: config.executor,
		expectedChainId: config.network.chain.id,
		explorerUrl: config.network.explorerUrl,
		network: config.network.name,
		networkConfigured: config.networkConfigured,
		openOracle: config.openOracle,
		queuedSigner: undefined,
		savedWallet: config.persistedPrivateKey === undefined ? undefined : privateKeyToAccount(config.persistedPrivateKey).address,
		wallet: runtime.wallet?.account.address,
	}
	const signerOperationGate = createSignerOperationGate()
	const executorIntentPath = executorDeploymentIntentPath(config.settingsFile, config.network.name)
	const deploymentRecovery = await loadDeploymentRecovery(executorIntentPath, config, state)
	const deploymentRecoveryReconciliation = createDeploymentRecoveryReconciliation({ config, readClients: () => runtime.readClients, state })
	const trackTransaction = createTransactionTracker(state)
	const controlPlane = startOperatorControlPlane({
		config,
		...(startupSignerConflict === undefined ? {} : { startupSignerConflict }),
		dashboardEnvironment: environment.dashboard,
		deploymentRecovery,
		fixedState,
		getCursor: () => runtime.cursor,
		...(shutdown === undefined ? {} : { isStopping: shutdown.isRequested }),
		lockManager,
		onNetworkProfileSwitch: () => {
			runtime.wakeProfileSwitchWait?.()
			runtime.wakeCentralizedMarketSampler?.()
		},
		signerOperationGate,
		state,
	})
	const { dashboard, pending } = controlPlane
	const stopping = () => runtime.operatorStopped || pending.profileSwitch || shutdown?.isRequested() === true
	const headWatcher = createOperatorHeadWatcher({ config, isStopping: stopping, readClient: () => createOperatorClient(config, runtime.readPool) })
	const scanWakeGate = createScanWakeGate(headWatcher)
	reportOperatorStarted(config, state)
	headWatcher.start()
	const centralizedMarketSampler = startCentralizedMarketSampler({ config, isStopping: stopping, state, wait: shutdown?.wait })
	runtime.wakeCentralizedMarketSampler = centralizedMarketSampler.wake
	const context: OperatorContext = {
		centralizedMarketSampler,
		config,
		contextualLogRead: async request => await request(createContextualPublicClient(config.network.chain, runtime.readPool)),
		contextualRpcRead,
		dashboard,
		deploymentRecovery,
		deploymentRecoveryReconciliation,
		executorIntentPath,
		fixedState,
		headWatcher,
		lockManager,
		pending,
		persistPosition: position => persistPosition(runtime, { config, state }, position),
		readConfiguredDexPair,
		scanBlockTimeOverride: environment.scanBlockTimeMs,
		scanWakeGate,
		settlementJournal,
		shutdown,
		signerOperationGate,
		state,
		stopping,
		trackTransaction,
	}
	return { context, runtime }
}
