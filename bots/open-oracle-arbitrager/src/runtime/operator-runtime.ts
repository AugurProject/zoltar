import type { Configuration } from '#config/configuration'
import type { DeploymentSettings } from '#config/deployment-settings'
import type { NetworkConfiguration } from '#config/network'
import type { loadCoordinatorPolicies } from '#config/runtime-deployment'
import type { ExecutionLockManager } from '#execution/execution-locks'
import type { TrackTransaction } from '#execution/transaction-tracker'
import { createTokenCatalogTracker, createTokenMetadataCache, discoverAugurRepTokens } from '#monitoring/market-monitor'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import { appendExecutionHistoryIfMissing, type OperatorState, type QueuedSigner } from '#state/operator-state'
import { savePositionJournalState, type ExclusiveProcessLock, type PositionJournalState, type PositionRecord } from '#state/position-store'
import { createContextualPublicClient, createRpcEndpointPool, createWalletClient, privateKeyToAccount, type Address, type Chain, type Hex, type PublicClient, type TransactionLog, type Transport } from '@zoltar/bot-shared/ethereum'
import type { BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import type { SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import type { SyncCursor } from '@zoltar/bot-shared/monitoring/block-sync'
import type { createOperatorHeadWatcher, createScanWakeGate, startCentralizedMarketSampler } from './background-observers.ts'
import type { createConfiguredDexPairReader } from './configured-dex-pair.ts'
import type { PendingOperatorUpdates, startOperatorControlPlane } from './operator-control-plane.ts'
import type { createSettlementJournal } from './settlement-stage.ts'
import type { DeploymentRecoveryReconciliation, DeploymentRecoveryState } from './signer-operations.ts'

/** The widest log window one scan may request. */
export const MAX_LOG_SCAN_RANGE = 256n

export type OperatorFixedState = {
	deployment: DeploymentSettings
	execute: boolean
	executor: Address | undefined
	expectedChainId: number
	explorerUrl: string
	network: NetworkConfiguration['name']
	networkConfigured: boolean
	openOracle: Address
	queuedSigner: QueuedSigner | undefined
	savedWallet: Address | undefined
	wallet: Address | undefined
}

type OperatorClient = ReturnType<typeof createOperatorClient>
type OperatorWallet = ReturnType<typeof createOperatorWallet>
type RpcEndpointPool = ReturnType<typeof createRpcEndpointPool>

export type ContextualRpcRead = <Value>(method: string, request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>, explicitRpcUrl?: string | undefined) => Promise<Value>

/**
 * Everything the operator loop replaces while it runs. Scan phases read these fields at the moment they need them, so
 * a client, pool, or wallet rebuilt by a queued update is observed by every later read in the same process.
 */
export type OperatorRuntime = {
	activeSignerLock: ExclusiveProcessLock | undefined
	cachedLogs: TransactionLog[]
	catalogForScan: ReturnType<typeof createTokenCatalogTracker>
	client: OperatorClient
	clientRpcUrl: string | undefined
	coordinatorPolicies: Awaited<ReturnType<typeof loadCoordinatorPolicies>>
	cursor: SyncCursor | undefined
	operatorStopped: boolean
	positionJournal: PositionJournalState
	positions: PositionRecord[]
	readClients: OperatorClient[]
	readPool: RpcEndpointPool
	readonly reports: Map<bigint, ActiveReport>
	startupValidated: boolean
	tokenMetadataCache: ReturnType<typeof createTokenMetadataCache>
	wakeCentralizedMarketSampler: (() => void) | undefined
	wakeProfileSwitchWait: (() => void) | undefined
	wallet: OperatorWallet
}

/** Collaborators fixed for the operator's lifetime; the objects themselves may still be mutated in place. */
export type OperatorContext = {
	readonly centralizedMarketSampler: ReturnType<typeof startCentralizedMarketSampler>
	readonly config: Configuration
	readonly contextualLogRead: <Value>(request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>) => Promise<Value>
	readonly contextualRpcRead: ContextualRpcRead
	readonly dashboard: ReturnType<typeof startOperatorControlPlane>['dashboard']
	readonly deploymentRecovery: DeploymentRecoveryState
	readonly deploymentRecoveryReconciliation: DeploymentRecoveryReconciliation
	readonly executorIntentPath: string
	readonly fixedState: OperatorFixedState
	readonly headWatcher: ReturnType<typeof createOperatorHeadWatcher>
	readonly lockManager: ExecutionLockManager | undefined
	readonly pending: PendingOperatorUpdates
	readonly persistPosition: (position: PositionRecord) => Promise<void>
	readonly readConfiguredDexPair: ReturnType<typeof createConfiguredDexPairReader>
	readonly scanBlockTimeOverride: number | undefined
	readonly scanWakeGate: ReturnType<typeof createScanWakeGate>
	readonly settlementJournal: Awaited<ReturnType<typeof createSettlementJournal>>
	readonly shutdown: BotShutdownController | undefined
	readonly signerOperationGate: SignerOperationGate
	readonly state: OperatorState
	readonly stopping: () => boolean
	readonly trackTransaction: TrackTransaction
}

/** One scan's error carried across its phases; the last recorded failure becomes the poll's reported error. */
export type ScanPass = { nextError: string | undefined }

export type ScanBlock = { baseFeePerGas?: bigint | null | undefined; hash: Hex; number: bigint; timestamp: bigint }

export function createReadPool(config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>) {
	return createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
}

export function readEndpoints(config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>) {
	return [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
}

export function createOperatorClient(config: Pick<Configuration, 'execute' | 'network'>, readPool: RpcEndpointPool, rpcUrl?: string) {
	return createContextualPublicClient(config.network.chain, readPool, config.execute ? rpcUrl : undefined)
}

export function createReadClients(config: Configuration, readPool: RpcEndpointPool) {
	return [createOperatorClient(config, readPool, config.connectivity.readRpcUrl), ...config.quorumRpcUrls.map(url => createOperatorClient(config, readPool, url))]
}

export function createOperatorWallet(config: Pick<Configuration, 'network' | 'privateKey'>, readPool: RpcEndpointPool) {
	return config.privateKey === undefined
		? undefined
		: createWalletClient({
				account: privateKeyToAccount(config.privateKey),
				chain: config.network.chain,
				transport: readPool.transport,
			})
}

/** The tracker discovers Augur REP tokens through whichever client the runtime holds when it refreshes. */
export function createScanTokenCatalog(currentClient: () => OperatorClient, config: Configuration) {
	return createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(currentClient(), config.network.multicall3, config.network.chain.id, configured, observed))
}

/** Endpoints or deployment identities changed: rebuild every read client and forget what the previous ones inspected. */
export function resetReadClients(runtime: OperatorRuntime, context: Pick<OperatorContext, 'config' | 'state'>) {
	const { config, state } = context
	runtime.readPool = createReadPool(config)
	state.rpcEndpointHealth = runtime.readPool.snapshot()
	runtime.client = createOperatorClient(config, runtime.readPool)
	runtime.clientRpcUrl = undefined
	runtime.readClients = createReadClients(config, runtime.readPool)
	runtime.wallet = createOperatorWallet(config, runtime.readPool)
	state.canonicalDeployments = undefined
	runtime.startupValidated = false
}

/** Drops every report, log, and market cache so the next scan rebuilds them from the current deployment and head. */
export function clearReportCaches(runtime: OperatorRuntime, context: Pick<OperatorContext, 'config' | 'state'>) {
	const { state } = context
	runtime.reports.clear()
	runtime.cachedLogs = []
	state.activeReportCount = 0
	state.opportunities = []
	state.reportPaths = []
	state.tokenMarkets = []
	state.marketObservations = []
	state.marketConsensus = undefined
	runtime.tokenMetadataCache = createTokenMetadataCache()
	runtime.catalogForScan = createScanTokenCatalog(() => runtime.client, context.config)
}

export async function persistPosition(runtime: OperatorRuntime, context: Pick<OperatorContext, 'config' | 'state'>, position: PositionRecord) {
	const { config, state } = context
	const nextPositions = [position, ...runtime.positions.filter(existing => existing.reportId !== position.reportId)]
	runtime.positionJournal = await savePositionJournalState(config.positionFile, { archived: runtime.positionJournal.archived, positions: nextPositions }, config.network.chain.id)
	runtime.positions = runtime.positionJournal.positions
	state.positions = runtime.positions
	state.positionArchive = runtime.positionJournal.archived
}

export async function flushHistoryOutboxes(runtime: OperatorRuntime, context: Pick<OperatorContext, 'config' | 'persistPosition' | 'state'>) {
	const { config, state } = context
	for (const position of runtime.positions.filter(candidate => candidate.historyOutbox !== undefined)) {
		const record = position.historyOutbox
		if (record === undefined) continue
		if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
		await appendExecutionHistoryIfMissing(config.historyFile, record, config.network.chain.id)
		await context.persistPosition({ ...position, historyOutbox: undefined })
	}
}
