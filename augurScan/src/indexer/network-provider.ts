import { runtimeConfig } from '../config.ts'
import type { EvidenceProvenance, HistoryInvalidationReason, IndexerLease, ScannerDatabase } from '../database.ts'
import { type Address, createPublicClient, http, type PublicClient, zeroAddress } from '../ethereum.ts'
import {
	ChainConfigurationError,
	createLogClient,
	createRpcDiagnosticContext,
	findEarliestAvailableStateBlock,
	isPrunedHistoricalStateError,
	rpcProviderLabel,
} from '../indexer-runtime.ts'
import { createRpcLoggingFetch } from '../logging.ts'
import { withRpcRequestQueue } from '../rpc-request-queue.ts'
import type { NetworkConfig } from '../types.ts'
import {
	findManifestContractDeployment,
	type IndexerRpcProvider,
	type RpcBlockHeader,
	requireRpcBlockHeader,
	rpcExchangeLog,
	rpcRequestQueue,
} from './planning.ts'
export abstract class NetworkIndexerProvider {
	protected abstract rpcFailureReason(error: unknown): string
	protected network: NetworkConfig
	protected readonly configuredStartBlock: bigint
	protected stateStartBlock: bigint
	protected stateBoundaryDiscovered = false
	protected readonly database: ScannerDatabase
	protected readonly providers: readonly IndexerRpcProvider[]
	protected readonly verifiedProviders = new WeakSet<IndexerRpcProvider>()
	protected readonly providerStateBoundaries = new WeakMap<IndexerRpcProvider, { readonly startBlock: bigint; readonly discovered: boolean }>()
	protected readonly providerHistoricalCodeUnavailable = new WeakMap<IndexerRpcProvider, Set<string>>()
	protected activeProvider: IndexerRpcProvider
	protected failoverSawPrunedLogFailure = false
	protected client: PublicClient
	protected logClient: PublicClient
	protected readonly rpcDiagnostics: ReturnType<typeof createRpcDiagnosticContext>
	protected indexingStartReported = false
	protected lastProgressLogAt: number | undefined
	protected progressSample: { block: bigint; sampledAt: number; blocksPerSecond?: number } | undefined
	protected lastReportedPhase: 'backfilling' | 'degraded' | 'live' | undefined
	protected lastDeploymentScanAt: number | undefined
	protected readonly signal: AbortSignal
	protected readonly provenance: EvidenceProvenance | undefined
	protected lastSeedReplayReason: Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'> | undefined
	protected lease: IndexerLease | undefined

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

	protected async getBlockHeader(blockNumber: bigint): Promise<RpcBlockHeader> {
		return requireRpcBlockHeader(await this.client.getBlock({ blockNumber }), blockNumber)
	}

	protected historicalCodeUnavailable(): Set<string> {
		const stored = this.providerHistoricalCodeUnavailable.get(this.activeProvider)
		if (stored !== undefined) return stored
		const created = new Set<string>()
		this.providerHistoricalCodeUnavailable.set(this.activeProvider, created)
		return created
	}

	protected selectProvider(provider: IndexerRpcProvider): void {
		this.activeProvider = provider
		this.client = provider.client
		this.logClient = provider.logClient
		this.rpcDiagnostics.select(provider)
		const boundary = this.providerStateBoundaries.get(provider)
		this.stateStartBlock = boundary?.startBlock ?? this.network.startBlock
		this.stateBoundaryDiscovered = boundary?.discovered ?? false
	}

	protected rememberHistoricalCodeUnavailable(address: Address, error: unknown): void {
		const key = address.toLowerCase()
		const unavailable = this.historicalCodeUnavailable()
		if (unavailable.has(key)) return
		unavailable.add(key)
		console.warn(
			`[${this.network.id}] historical contract code unavailable for ${address}; scanning complete available coverage from block #${this.network.startBlock} instead: ${this.rpcFailureReason(error)}`,
		)
	}

	protected async findManifestDeployment(
		address: Address,
		startBlock: bigint,
		indexedBoundary: bigint,
		startBlockKnownAbsent: boolean,
	): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> {
		if (this.historicalCodeUnavailable().has(address.toLowerCase())) return { block: startBlock, exact: false }
		for (let attempt = 0; attempt < 2; attempt++) {
			const searchStart = this.stateStartBlock > startBlock ? this.stateStartBlock : startBlock
			try {
				return await findManifestContractDeployment(
					address,
					searchStart,
					indexedBoundary,
					startBlockKnownAbsent && searchStart === startBlock,
					(candidate, blockNumber) => this.client.getBytecode({ address: candidate, blockNumber }),
					5_000,
					Date.now,
					(error) => this.rememberHistoricalCodeUnavailable(address, error),
				)
			} catch (error) {
				if (!isPrunedHistoricalStateError(error) || attempt > 0) throw error
				await this.discoverStateStartBlock(await this.client.getBlockNumber(), this.stateStartBlock, true)
			}
		}
		throw new Error('Manifest deployment state boundary retry was exhausted')
	}

	protected async discoverStateStartBlock(observedHead: bigint, searchStart = this.network.startBlock, searchStartKnownUnavailable = false): Promise<void> {
		if (searchStart > observedHead) {
			this.stateStartBlock = searchStart
			return
		}
		const stateStartBlock = await findEarliestAvailableStateBlock(
			searchStart,
			observedHead,
			async (blockNumber) => {
				await this.client.getBalance({ address: zeroAddress, blockNumber })
			},
			searchStartKnownUnavailable,
		)
		this.stateStartBlock = stateStartBlock
		this.stateBoundaryDiscovered = true
		this.providerStateBoundaries.set(this.activeProvider, { startBlock: stateStartBlock, discovered: true })
		if (stateStartBlock > this.network.startBlock)
			console.warn(
				`[${this.network.id}] RPC historical state before block #${stateStartBlock} is pruned; state-dependent reads will begin at the earliest retrievable state block while log indexing independently begins at its earliest retrievable log block`,
			)
	}
}
