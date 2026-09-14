import { runtimeConfig } from '../config.ts'
import type { EvidenceProvenance, HistoryInvalidationReason, IndexerLease, ScannerDatabase } from '../database.ts'
import { createPublicClient, http, type PublicClient } from '../ethereum.ts'
import { ChainConfigurationError, createLogClient, createRpcDiagnosticContext, rpcProviderLabel } from '../indexer-runtime.ts'
import { createRpcLoggingFetch } from '../logging.ts'
import { withRpcRequestQueue } from '../rpc-request-queue.ts'
import type { NetworkConfig } from '../types.ts'
import { type IndexerRpcProvider, rpcExchangeLog, rpcRequestQueue } from './planning.ts'

import * as provider from './network-provider.ts'
import * as lifecycle from './network-lifecycle.ts'
import * as synchronization from './network-synchronization.ts'
import * as logs from './log-scanner.ts'
import * as ingestion from './ingestion-operations.ts'

export class NetworkIndexer {
	network: NetworkConfig
	readonly configuredStartBlock: bigint
	stateStartBlock: bigint
	stateBoundaryDiscovered = false
	readonly database: ScannerDatabase
	readonly providers: readonly IndexerRpcProvider[]
	readonly verifiedProviders = new WeakSet<IndexerRpcProvider>()
	readonly providerStateBoundaries = new WeakMap<IndexerRpcProvider, { readonly startBlock: bigint; readonly discovered: boolean }>()
	readonly providerHistoricalCodeUnavailable = new WeakMap<IndexerRpcProvider, Set<string>>()
	activeProvider: IndexerRpcProvider
	failoverSawPrunedLogFailure = false
	client: PublicClient
	logClient: PublicClient
	readonly rpcDiagnostics: ReturnType<typeof createRpcDiagnosticContext>
	indexingStartReported = false
	lastProgressLogAt: number | undefined
	progressSample: { block: bigint; sampledAt: number; blocksPerSecond?: number } | undefined
	lastReportedPhase: 'backfilling' | 'degraded' | 'live' | undefined
	lastDeploymentScanAt: number | undefined
	readonly signal: AbortSignal
	readonly provenance: EvidenceProvenance | undefined
	lastSeedReplayReason: Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'> | undefined
	lease: IndexerLease | undefined
	constructor(
		network: NetworkConfig,
		database: ScannerDatabase,
		signal: AbortSignal,
		options: {
			readonly provenance?: EvidenceProvenance
		} = {},
	) {
		this.network = network
		this.configuredStartBlock = network.startBlock
		this.stateStartBlock = network.startBlock
		this.database = database
		this.signal = signal
		this.provenance = options.provenance
		this.providers = network.rpcUrls.map((rpcUrl, index) => {
			const endpoint = rpcProviderLabel(rpcUrl, index)
			const loggingFetch = createRpcLoggingFetch(rpcUrl, endpoint, runtimeConfig.rpcLogPath, rpcExchangeLog)
			const transport = http(rpcUrl, {
				fetchFn: loggingFetch,
				requestTimeout: 20_000,
				retryCount: 2,
			})
			const client = createPublicClient({ transport: withRpcRequestQueue(transport, rpcRequestQueue, endpoint) })
			const logClient = createLogClient(rpcUrl, endpoint, rpcRequestQueue, loggingFetch)
			return { client, endpoint, getChainId: () => client.getChainId(), logClient, number: index + 1 }
		})
		const firstProvider = this.providers[0]
		if (firstProvider === undefined) throw new ChainConfigurationError('At least one RPC provider is required')
		this.activeProvider = firstProvider
		this.client = firstProvider.client
		this.logClient = firstProvider.logClient
		this.rpcDiagnostics = createRpcDiagnosticContext(firstProvider)
	}
	getBlockHeader = provider.getBlockHeader
	historicalCodeUnavailable = provider.historicalCodeUnavailable
	selectProvider = provider.selectProvider
	rememberHistoricalCodeUnavailable = provider.rememberHistoricalCodeUnavailable
	findManifestDeployment = provider.findManifestDeployment
	discoverStateStartBlock = provider.discoverStateStartBlock
	run = lifecycle.run
	seed = lifecycle.seed
	seedNetwork = lifecycle.seedNetwork
	validateManifestChange = lifecycle.validateManifestChange
	reportManifestReplay = lifecycle.reportManifestReplay
	withProviderFailover = lifecycle.withProviderFailover
	rpcFailureReason = lifecycle.rpcFailureReason
	recordFailure = lifecycle.recordFailure
	advancePastPrunedLogs = lifecycle.advancePastPrunedLogs
	recoverPrunedLogFailure = lifecycle.recoverPrunedLogFailure
	reportProgress = synchronization.reportProgress
	reportWaitingForStart = synchronization.reportWaitingForStart
	assertLease = synchronization.assertLease
	requireLease = synchronization.requireLease
	withManifestDeploymentBlocks = synchronization.withManifestDeploymentBlocks
	reconcileManifestBackfill = synchronization.reconcileManifestBackfill
	reconcileReorg = synchronization.reconcileReorg
	refreshContractDeployment = synchronization.refreshContractDeployment
	poll = synchronization.poll
	queryLogs = logs.queryLogs
	getLogsForInputs = logs.getLogsForInputs
	getLogs = logs.getLogs
	planDeploymentAwareLogScan = logs.planDeploymentAwareLogScan
	getNextLogSegment = logs.getNextLogSegment
	getAllLogs = logs.getAllLogs
	mergeLogs = logs.mergeLogs
	getKnownLogs = logs.getKnownLogs
	indexBlock = ingestion.indexBlock
	refreshRichListBalances = ingestion.refreshRichListBalances
	refreshEntityStateSnapshots = ingestion.refreshEntityStateSnapshots
	readTokenMetadata = ingestion.readTokenMetadata
}
