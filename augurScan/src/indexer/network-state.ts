import { runtimeConfig } from '../config.ts'
import type { EvidenceProvenance, HistoryInvalidationReason, IndexerLease, ScannerDatabase } from '../database.ts'
import { createPublicClient, http, type PublicClient } from '../ethereum.ts'
import { ChainConfigurationError, createLogClient, createRpcDiagnosticContext, LeaseLostError, rpcProviderLabel } from '../indexer-runtime.ts'
import { createRpcLoggingFetch, parseLoggedRpcResponse } from '../logging.ts'
import { withRpcRequestQueue } from '../rpc-request-queue.ts'
import type { NetworkConfig } from '../types.ts'
import { type IndexerRpcProvider, rpcExchangeLog, rpcRequestQueue } from './planning.ts'

/** RPC providers, the active provider's clients, and facts remembered per provider. */
export type ProviderState = {
	readonly list: readonly IndexerRpcProvider[]
	active: IndexerRpcProvider
	client: PublicClient
	logClient: PublicClient
	readonly traceStartBlocks: WeakMap<IndexerRpcProvider, bigint>
	readonly traceUnsupported: WeakSet<IndexerRpcProvider>
	readonly verified: WeakSet<IndexerRpcProvider>
	readonly stateBoundaries: WeakMap<IndexerRpcProvider, { readonly startBlock: bigint; readonly discovered: boolean }>
	readonly historicalCodeUnavailable: WeakMap<IndexerRpcProvider, Set<string>>
	failoverSawPrunedLogFailure: boolean
	readonly diagnostics: ReturnType<typeof createRpcDiagnosticContext>
}

/** Earliest block whose historical state the active provider can serve. */
type StateBoundary = {
	startBlock: bigint
	discovered: boolean
}

/** Operator-facing progress reporting state. */
type ProgressState = {
	indexingStartReported: boolean
	sample: { block: bigint; sampledAt: number; blocksPerSecond?: number } | undefined
	lastReportedPhase: 'backfilling' | 'degraded' | 'live' | undefined
	lastDeploymentScanAt: number | undefined
}

export type NetworkIndexerState = {
	network: NetworkConfig
	readonly configuredStartBlock: bigint
	readonly database: ScannerDatabase
	readonly signal: AbortSignal
	readonly provenance: EvidenceProvenance | undefined
	readonly providers: ProviderState
	readonly stateBoundary: StateBoundary
	readonly progress: ProgressState
	lease: IndexerLease | undefined
	lastSeedReplayReason: Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'> | undefined
}

const createProvider = (rpcUrl: string, index: number): IndexerRpcProvider => {
	const endpoint = rpcProviderLabel(rpcUrl, index)
	const loggingFetch = createRpcLoggingFetch(rpcUrl, endpoint, runtimeConfig.rpcLogPath, rpcExchangeLog)
	const transport = http(rpcUrl, {
		fetchFn: loggingFetch,
		requestTimeout: 20_000,
		responseParser: parseLoggedRpcResponse,
		retryCount: 2,
	})
	const client = createPublicClient({ transport: withRpcRequestQueue(transport, rpcRequestQueue, endpoint) })
	const logClient = createLogClient(rpcUrl, endpoint, rpcRequestQueue, loggingFetch)
	return { client, endpoint, getChainId: () => client.getChainId(), logClient, number: index + 1 }
}

export const createNetworkIndexer = (
	network: NetworkConfig,
	database: ScannerDatabase,
	signal: AbortSignal,
	options: {
		readonly provenance?: EvidenceProvenance
	} = {},
): NetworkIndexerState => {
	const list = network.rpcUrls.map(createProvider)
	const firstProvider = list[0]
	if (firstProvider === undefined) throw new ChainConfigurationError('At least one RPC provider is required')
	return {
		network,
		configuredStartBlock: network.startBlock,
		database,
		signal,
		provenance: options.provenance,
		providers: {
			list,
			active: firstProvider,
			client: firstProvider.client,
			logClient: firstProvider.logClient,
			traceStartBlocks: new WeakMap(),
			traceUnsupported: new WeakSet(),
			verified: new WeakSet(),
			stateBoundaries: new WeakMap(),
			historicalCodeUnavailable: new WeakMap(),
			failoverSawPrunedLogFailure: false,
			diagnostics: createRpcDiagnosticContext(firstProvider),
		},
		stateBoundary: { startBlock: network.startBlock, discovered: false },
		progress: { indexingStartReported: false, sample: undefined, lastReportedPhase: undefined, lastDeploymentScanAt: undefined },
		lease: undefined,
		lastSeedReplayReason: undefined,
	}
}

export function requireLease(state: Pick<NetworkIndexerState, 'lease'>): IndexerLease {
	if (state.lease === undefined) throw new LeaseLostError('Indexer lease is unavailable; reacquiring')
	return state.lease
}

export async function assertLease(state: Pick<NetworkIndexerState, 'lease'>): Promise<void> {
	try {
		await requireLease(state).assertHeld()
	} catch (error) {
		throw new LeaseLostError('Indexer lease was lost; reacquiring', { cause: error })
	}
}
