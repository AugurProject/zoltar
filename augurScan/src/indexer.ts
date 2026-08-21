import { runtimeConfig } from './config.ts'
import { errorChainIncludes } from './error-chain.ts'
import {
	addressActivityFrom,
	ChainConfigurationError,
	ChainContinuityError,
	commitCanonicalRead,
	confirmCanonicalBlock,
	contractDeploymentCandidateFrom,
	contractDeploymentScanDue,
	createRpcDiagnosticContext,
	databaseFailureMessage,
	deploymentReadBudget,
	indexerLogSources,
	indexerOperationFailureReason,
	indexerProgressMessage,
	indexerWaitingMessage,
	indexingCompletion,
	isLocalIndexerFailure,
	isPermanentHistoricalCodeError,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	isSplittableLogRangeError,
	jsonEvidence,
	LeaseLostError,
	labelsFrom,
	leaseFailureNames,
	queryCanonicalLogRange,
	type RpcProvider,
	readHistoricalCodeWithPermanentFallback,
	recordOwnershipEvent,
	requireLogPosition,
	requireReceiptPosition,
	requiresManifestHistoryCoverage,
	rpcFailureLogMessage,
	rpcProviderLabel,
	rpcQueueSaturatedMessage,
	runIndexerOwnershipLifecycle,
	runOwnedNetworkLifecycle,
	safeIndexerFailure,
	scanDiscoveredLogCoverage,
	withVerifiedProvider,
} from './indexer-runtime.ts'
import { createRpcLoggingFetch, RotatingJsonLog } from './logging.ts'
import { createRpcRequestQueue, rpcQueueSaturationFrom, withRpcRequestQueue } from './rpc-request-queue.ts'

export {
	addressActivityFrom,
	boundedDeploymentRead,
	commitCanonicalRead,
	compactIndexerDuration,
	confirmCanonicalBlock,
	contractDeploymentScanDue,
	createRpcDiagnosticContext,
	deploymentReadBudget,
	type IndexerOwnershipEvent,
	IndexerOwnershipStageError,
	type IndexerOwnershipStatus,
	indexerOperationFailureReason,
	indexerOwnershipStatuses,
	indexerProgressMessage,
	indexerWaitingMessage,
	indexingCompletion,
	isLocalIndexerFailure,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	isSplittableLogRangeError,
	nextIndexerOwnershipStatus,
	ownershipFailureLogMessage,
	queryCanonicalLogRange,
	requiresManifestHistoryCoverage,
	retryDelayMs,
	rpcEndpointLabel,
	rpcFailureLogMessage,
	rpcIndexerFailureReason,
	rpcProviderLabel,
	runIndexerOwnershipLifecycle,
	runNetworkLifecycle,
	runOwnedNetworkLifecycle,
	safeIndexerFailure,
	safeIndexerFailureReason,
	waitForIndexerDelay,
	withVerifiedProvider,
} from './indexer-runtime.ts'
export { createRpcRequestQueue, RpcQueueSaturatedError, withRpcRequestQueue } from './rpc-request-queue.ts'

import {
	type ContractDeploymentObservation,
	DatabaseConsistencyError,
	type IndexedBlock,
	type IndexerLease,
	type LogScanCursor,
	manifestContractSetChanged,
	type RichListBalance,
	type ScannerDatabase,
	type StoredTransaction,
} from './database.ts'
import {
	type Address,
	type Block,
	createPublicClient,
	getAddress,
	type Hash,
	type Hex,
	http,
	type Log,
	type PublicClient,
	parseAbi,
	parseAbiItem,
	type Transaction,
	type TransactionReceipt,
	zeroAddress,
} from './ethereum.ts'
import { decodeAction, decodeLogRecord, discoveriesFrom, tokenAddressesFrom } from './metadata.ts'
import { sampleEntityState } from './snapshots.ts'
import { bigintToSafeNumber, unixSecondsToDate } from './time.ts'
import type { ContractMetadata, ManifestContract, NetworkConfig, StoredLog, TokenMetadata } from './types.ts'
import { uniswapV2V3TokenPairs, uniswapV4PoolConfigurations, uniswapV4PoolId } from './uniswap.ts'

type RpcBlockHeader = {
	readonly hash: Hash
	readonly parentHash: Hash
	readonly timestamp: bigint
}

const requireRpcBlockHeader = (block: Block, blockNumber: bigint): RpcBlockHeader => {
	if (block.hash === undefined || block.parentHash === undefined || block.number !== blockNumber) {
		throw new Error(`RPC returned an invalid canonical header for block ${blockNumber}`)
	}
	return { hash: block.hash, parentHash: block.parentHash, timestamp: block.timestamp }
}

const RPC_CONCURRENCY = 5
const RPC_MAX_PENDING = 100

const erc20MetadataAbi = parseAbi([
	'function decimals() view returns (uint8)',
	'function name() view returns (string)',
	'function symbol() view returns (string)',
])
const erc20BalanceAbi = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
const priceCoordinatorDependenciesAbi = parseAbi(['function liquidationApprovalRegistry() view returns (address)'])
const uniswapV4InitializeEvent = parseAbiItem(
	'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
)
const uniswapV2PairCreatedEvent = parseAbiItem('event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairIndex)')
const uniswapV3PoolCreatedEvent = parseAbiItem(
	'event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)',
)
const uniswapV4SwapEvent = parseAbiItem(
	'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
)
export const uniswapV4PoolIds = (contracts: ReadonlyMap<string, ContractMetadata>): readonly Hex[] =>
	[...contracts.values()]
		.filter(({ kind }) => kind === 'reputationToken')
		.flatMap(({ address }) => {
			const quotes = [zeroAddress, ...[...contracts.values()].filter(({ kind }) => kind === 'usdc').map(({ address: quote }) => quote)]
			return quotes.flatMap((quote) => uniswapV4PoolConfigurations.map(({ fee, tickSpacing }) => uniswapV4PoolId(address, fee, tickSpacing, quote)))
		})

export const tokenMetadataNeedsRead = (metadata: TokenMetadata | undefined, blockNumber: bigint): boolean =>
	metadata === undefined || (metadata.decimals === undefined && blockNumber >= metadata.readBlock + 25n)

export const reorgSearchFloor = (startBlock: bigint, checkpoint: bigint, confirmationDepth: bigint): bigint => {
	const candidate = checkpoint > confirmationDepth ? checkpoint - confirmationDepth : startBlock
	return candidate > startBlock ? candidate : startBlock
}

export const requiresParentLookup = (nextBlock: bigint, startBlock: bigint): boolean => nextBlock > startBlock

type TokenMetadataCalls = {
	readonly decimals: () => Promise<number>
	readonly name: () => Promise<string>
	readonly symbol: () => Promise<string>
}

const unavailableMetadataErrors = new Set(['AbiDecodingError', 'ContractFunctionRevertedError', 'ContractFunctionZeroDataError'])

const isUnavailableMetadataCall = (error: unknown): boolean => errorChainIncludes(error, unavailableMetadataErrors)

const metadataCall = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
	try {
		return await call()
	} catch (error) {
		if (isUnavailableMetadataCall(error)) return undefined
		throw error
	}
}

export const readTokenMetadata = async (address: Address, blockNumber: bigint, calls: TokenMetadataCalls): Promise<TokenMetadata> => {
	const decimals = await metadataCall(calls.decimals)
	if (decimals === undefined || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)
		return { address, readError: 'ERC-20 metadata unavailable', readBlock: blockNumber }
	const [name, symbol] = await Promise.all([metadataCall(calls.name), metadataCall(calls.symbol)])
	return { address, decimals, ...(name === undefined ? {} : { name }), ...(symbol === undefined ? {} : { symbol }), readBlock: blockNumber }
}

export const findContractDeploymentBlock = async (
	startBlock: bigint,
	observedHead: bigint,
	codeAt: (block: bigint) => Promise<Hex | undefined>,
	startBlockKnownAbsent = false,
): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> => {
	// A single block cannot establish an absent-to-present code boundary. Some
	// lagging or non-archive RPC nodes report head #0 while answering historical
	// eth_getCode calls from newer state, which previously produced a false #0
	// deployment observation. Wait for a later head so the result is evidence.
	if (observedHead <= startBlock) return undefined
	const hasCode = async (block: bigint): Promise<boolean> => {
		const code = await codeAt(block)
		return code !== undefined && code !== '0x'
	}
	if (!(await hasCode(observedHead))) return undefined
	if (!startBlockKnownAbsent && (await hasCode(startBlock))) {
		// Code at genesis for these manifest contracts is overwhelmingly evidence
		// that the RPC ignored or could not serve the historical block selector.
		// A genuine genesis deployment can still be configured explicitly.
		return startBlock === 0n ? undefined : { block: startBlock, exact: false }
	}
	let lower = startBlock
	let upper = observedHead
	while (lower + 1n < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await hasCode(middle)) upper = middle
		else lower = middle
	}
	return { block: upper, exact: true }
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
	const result: T[][] = []
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
	return result
}

const rpcRequestQueue = createRpcRequestQueue(RPC_CONCURRENCY, RPC_MAX_PENDING)
const rpcExchangeLog = new RotatingJsonLog(runtimeConfig.rpcLogPath)

export const rpcLogAddressGroups = <T>(addresses: readonly T[]): readonly T[][] => chunks(addresses, 5)

export type LogScanInput = {
	readonly address: Address
	readonly fromBlock: bigint
	readonly startBlock: bigint
}

export type LogQueryGroup = {
	readonly addresses: Address[]
	readonly fromBlock: bigint
}

export const planManifestBackfill = async (
	manifestContracts: readonly ManifestContract[],
	contracts: ReadonlyMap<string, ContractMetadata>,
	cursors: ReadonlyMap<string, LogScanCursor>,
	checkpoint: bigint,
	configuredStartBlock: bigint,
	findDeployment: (
		address: Address,
		startBlock: bigint,
		checkpoint: bigint,
		startBlockKnownAbsent: boolean,
	) => Promise<{ readonly block: bigint; readonly exact: boolean } | undefined>,
): Promise<bigint | undefined> => {
	let replayStart: bigint | undefined
	for (const [address, label, kind, configuredDeploymentBlock] of manifestContracts) {
		const storedContract = contracts.get(address.toLowerCase())
		const contract = {
			...storedContract,
			address,
			label,
			kind,
			provenance: 'manifest',
		}
		if (!requiresManifestHistoryCoverage(contract)) continue
		const cursor = cursors.get(address.toLowerCase())
		const requiresFreshDeploymentSearch =
			configuredDeploymentBlock === undefined &&
			storedContract !== undefined &&
			storedContract.deploymentBlockExact !== true &&
			(storedContract.provenance !== 'manifest' || !requiresManifestHistoryCoverage(storedContract))
		let deploymentBlock = configuredDeploymentBlock ?? (requiresFreshDeploymentSearch ? undefined : contract.deploymentBlock)
		if (
			!requiresFreshDeploymentSearch &&
			cursor !== undefined &&
			cursor.lastRetrievedBlock >= checkpoint &&
			(deploymentBlock === undefined || cursor.startBlock <= deploymentBlock)
		)
			continue
		if (deploymentBlock === undefined) {
			const searchStart = requiresFreshDeploymentSearch ? configuredStartBlock : (contract.deploymentCheckedBlock ?? configuredStartBlock)
			if (searchStart >= checkpoint && contract.deploymentCheckedBlock !== undefined && !requiresFreshDeploymentSearch) continue
			const deployment = await findDeployment(address, searchStart, checkpoint, !requiresFreshDeploymentSearch && contract.deploymentCheckedBlock !== undefined)
			if (deployment === undefined) continue
			deploymentBlock = deployment.block
		}
		if (deploymentBlock > checkpoint) continue
		const missingStart = cursor === undefined || cursor.startBlock > deploymentBlock ? deploymentBlock : cursor.lastRetrievedBlock + 1n
		if (missingStart <= checkpoint && (replayStart === undefined || missingStart < replayStart)) replayStart = missingStart
	}
	return replayStart
}

export const findManifestContractDeployment = async (
	address: Address,
	startBlock: bigint,
	checkpoint: bigint,
	startBlockKnownAbsent: boolean,
	codeAt: (address: Address, block: bigint) => Promise<Hex | undefined>,
	timeoutMs = 5_000,
	now = Date.now,
	onHistoricalCodeUnavailable: (error: unknown) => void = () => {},
): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> => {
	const readWithinBudget = deploymentReadBudget(timeoutMs, now)
	try {
		return await findContractDeploymentBlock(
			startBlock,
			checkpoint,
			(blockNumber) => readWithinBudget(() => codeAt(address, blockNumber)),
			startBlockKnownAbsent,
		)
	} catch (error) {
		if (rpcQueueSaturationFrom(error) !== undefined || !isPermanentHistoricalCodeError(error)) throw error
		onHistoricalCodeUnavailable(error)
		return { block: startBlock, exact: false }
	}
}

export const logScanCursorUpdates = (
	contracts: ReadonlyMap<string, ContractMetadata>,
	scanInputs: readonly LogScanInput[],
	endBlock: bigint,
	configuredStartBlock: bigint,
	coverageStartBlock = configuredStartBlock,
): readonly LogScanCursor[] =>
	[...contracts.values()].flatMap((contract) => {
		const scanInput = scanInputs.find(({ address }) => address.toLowerCase() === contract.address.toLowerCase())
		const tracksFilteredHistory = contract.kind === 'reputationToken' || contract.kind === 'weth' || contract.kind === 'usdc'
		if (!tracksFilteredHistory && (!isProtocolActivitySource(contract) || (scanInput === undefined && contract.discoveryBlock === undefined))) return []
		const startBlock =
			scanInput?.startBlock ?? contract.deploymentBlock ?? contract.discoveryBlock ?? (tracksFilteredHistory ? coverageStartBlock : configuredStartBlock)
		return startBlock > endBlock ? [] : [{ contractAddress: contract.address, startBlock, lastRetrievedBlock: endBlock }]
	})

export const rpcLogQueryGroups = (inputs: readonly LogScanInput[]): readonly LogQueryGroup[] => {
	const byStart = new Map<bigint, Address[]>()
	for (const input of inputs) {
		const addresses = byStart.get(input.fromBlock) ?? []
		addresses.push(input.address)
		byStart.set(input.fromBlock, addresses)
	}
	return [...byStart]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.flatMap(([fromBlock, addresses]) => rpcLogAddressGroups(addresses).map((group) => ({ addresses: group, fromBlock })))
}

const mapLimit = async <T, R>(items: readonly T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> => {
	const result = new Array<R>(items.length)
	let cursor = 0
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++
			const item = items[index]
			if (item !== undefined) result[index] = await operation(item)
		}
	})
	await Promise.all(workers)
	return result
}

type DeploymentAwareLogPlan = {
	readonly inputs: readonly LogScanInput[]
	readonly observations: readonly ContractDeploymentObservation[]
}

export const planDeploymentAwareLogScan = async (
	contracts: readonly ContractMetadata[],
	fromBlock: bigint,
	toBlock: bigint,
	configuredStartBlock: bigint,
	codeAt: (address: Address, block: bigint) => Promise<Hex | undefined>,
	blockTimestamp: (block: bigint) => Promise<Date>,
	onDetectionFailure: (contract: ContractMetadata, error: unknown) => void = () => {},
	historicalCodeUnavailable: ReadonlySet<string> = new Set(),
): Promise<DeploymentAwareLogPlan> => {
	const planned = await mapLimit(contracts, 4, async (contract): Promise<DeploymentAwareLogPlan> => {
		const knownStart = contract.deploymentBlock ?? contract.discoveryBlock
		if (knownStart !== undefined) {
			return {
				inputs: knownStart > toBlock ? [] : [{ address: contract.address, fromBlock: knownStart > fromBlock ? knownStart : fromBlock, startBlock: knownStart }],
				observations: [],
			}
		}
		if (historicalCodeUnavailable.has(contract.address.toLowerCase())) {
			const fallbackStart = contract.discoveryBlock ?? configuredStartBlock
			return { inputs: [{ address: contract.address, fromBlock, startBlock: fallbackStart }], observations: [] }
		}
		let deployment: { readonly block: bigint; readonly exact: boolean } | undefined
		try {
			const searchStart = contract.deploymentCheckedBlock ?? configuredStartBlock
			deployment = await findContractDeploymentBlock(
				searchStart,
				toBlock,
				(block) => codeAt(contract.address, block),
				contract.deploymentCheckedBlock !== undefined,
			)
		} catch (error) {
			if (rpcQueueSaturationFrom(error) !== undefined || !isPermanentHistoricalCodeError(error)) throw error
			onDetectionFailure(contract, error)
			const fallbackStart = contract.discoveryBlock ?? configuredStartBlock
			return {
				inputs: [{ address: contract.address, fromBlock, startBlock: fallbackStart }],
				observations: [],
			}
		}
		if (deployment === undefined) return { inputs: [], observations: [{ contractAddress: contract.address, checkedBlock: toBlock }] }
		const observation: ContractDeploymentObservation = {
			contractAddress: contract.address,
			checkedBlock: toBlock,
			deployment: { ...deployment, timestamp: await blockTimestamp(deployment.block) },
		}
		return {
			inputs: [
				{
					address: contract.address,
					fromBlock: deployment.block > fromBlock ? deployment.block : fromBlock,
					startBlock: deployment.block,
				},
			],
			observations: [observation],
		}
	})
	return { inputs: planned.flatMap(({ inputs }) => inputs), observations: planned.flatMap(({ observations }) => observations) }
}

export const queryAdaptiveLogRange = async <T>(
	fromBlock: bigint,
	maximumToBlock: bigint,
	maximumBlockCount: number,
	query: (fromBlock: bigint, toBlock: bigint) => Promise<readonly T[]>,
	onSplit?: (failedFromBlock: bigint, failedToBlock: bigint, retryToBlock: bigint, error: unknown) => void,
	shouldSplit: (error: unknown) => boolean = () => true,
): Promise<{ readonly fromBlock: bigint; readonly toBlock: bigint; readonly items: readonly T[] }> => {
	if (!Number.isSafeInteger(maximumBlockCount) || maximumBlockCount <= 0) throw new Error('The maximum log range must be a positive safe integer')
	if (fromBlock > maximumToBlock) throw new Error('The log range start must not exceed its end')
	const remaining = maximumToBlock - fromBlock + 1n
	let blockCount = remaining < BigInt(maximumBlockCount) ? bigintToSafeNumber(remaining, 'Remaining log range') : maximumBlockCount
	while (true) {
		const toBlock = fromBlock + BigInt(blockCount - 1)
		try {
			return { fromBlock, toBlock, items: await query(fromBlock, toBlock) }
		} catch (error) {
			if (blockCount === 1 || !shouldSplit(error)) throw error
			blockCount = Math.ceil(blockCount / 2)
			onSplit?.(fromBlock, toBlock, fromBlock + BigInt(blockCount - 1), error)
		}
	}
}

export const initialIndexStartBlock = async (
	manifestContracts: readonly ManifestContract[],
	configuredStartBlock: bigint,
	observedHead: bigint,
	findDeployment: (
		address: Address,
		startBlock: bigint,
		checkpoint: bigint,
		startBlockKnownAbsent: boolean,
	) => Promise<{ readonly block: bigint; readonly exact: boolean } | undefined>,
): Promise<bigint> => {
	if (observedHead < configuredStartBlock) return configuredStartBlock
	const deployments = await mapLimit(manifestContracts, 4, async ([address, label, kind, configuredDeploymentBlock]) => {
		if (!requiresManifestHistoryCoverage({ address, label, kind, provenance: 'manifest' })) return undefined
		if (configuredDeploymentBlock !== undefined) return configuredDeploymentBlock <= observedHead ? configuredDeploymentBlock : undefined
		return (await findDeployment(address, configuredStartBlock, observedHead, false))?.block
	})
	return (
		deployments.reduce<bigint | undefined>((earliest, deployment) => {
			if (deployment === undefined) return earliest
			return earliest === undefined || deployment < earliest ? deployment : earliest
		}, undefined) ?? observedHead + 1n
	)
}

export const manifestReplayAncestor = (replayStart: bigint, storedStartBlock: bigint): bigint => {
	if (replayStart < storedStartBlock)
		throw new DatabaseConsistencyError(
			`Newly tracked deployment block ${replayStart} predates the stored index start ${storedStartBlock}; rebuild the augurScan database to capture its complete history`,
			{ code: 'manifest-history-before-start', replayStart, storedStartBlock },
		)
	return replayStart === storedStartBlock ? -1n : replayStart - 1n
}

export const manifestChangeRequiresFullReplay = async (
	manifestContracts: readonly ManifestContract[],
	storedContracts: ReadonlyMap<string, ContractMetadata>,
	cursors: ReadonlyMap<string, LogScanCursor>,
	checkpoint: bigint,
	configuredStartBlock: bigint,
	storedStartBlock: bigint,
	findDeployment: (
		address: Address,
		startBlock: bigint,
		indexedBoundary: bigint,
		startBlockKnownAbsent: boolean,
	) => Promise<{ readonly block: bigint; readonly exact: boolean } | undefined>,
): Promise<boolean> => {
	const storedManifest = [...storedContracts.values()].filter(({ provenance }) => provenance === 'manifest')
	if (!manifestContractSetChanged(manifestContracts, storedManifest)) return false
	const replayStart = await planManifestBackfill(manifestContracts, storedContracts, cursors, checkpoint, configuredStartBlock, findDeployment)
	if (replayStart !== undefined) manifestReplayAncestor(replayStart, storedStartBlock)
	return true
}

class NetworkIndexer {
	#network: NetworkConfig
	readonly #configuredStartBlock: bigint
	readonly #database: ScannerDatabase
	readonly #providers: readonly RpcProvider[]
	readonly #verifiedProviders = new WeakSet<RpcProvider>()
	#client: PublicClient
	readonly #rpcDiagnostics: ReturnType<typeof createRpcDiagnosticContext>
	#indexingStartReported = false
	#lastProgressLogAt: number | undefined
	#progressSample: { block: bigint; sampledAt: number; blocksPerSecond?: number } | undefined
	#lastReportedPhase: 'backfilling' | 'degraded' | 'live' | undefined
	#lastDeploymentScanAt: number | undefined
	readonly #historicalCodeUnavailable = new Set<string>()
	readonly #signal: AbortSignal
	#lease: IndexerLease | undefined

	constructor(network: NetworkConfig, database: ScannerDatabase, signal: AbortSignal) {
		this.#network = network
		this.#configuredStartBlock = network.startBlock
		this.#database = database
		this.#signal = signal
		this.#providers = network.rpcUrls.map((rpcUrl, index) => {
			const endpoint = rpcProviderLabel(rpcUrl, index)
			const transport = http(rpcUrl, {
				fetchFn: createRpcLoggingFetch(rpcUrl, endpoint, runtimeConfig.rpcLogPath, rpcExchangeLog),
				requestTimeout: 20_000,
				retryCount: 2,
			})
			const client = createPublicClient({ transport: withRpcRequestQueue(transport, rpcRequestQueue, endpoint) })
			return { client, endpoint, getChainId: () => client.getChainId(), number: index + 1 }
		})
		const firstProvider = this.#providers[0]
		if (firstProvider === undefined) throw new ChainConfigurationError('At least one RPC provider is required')
		this.#client = firstProvider.client
		this.#rpcDiagnostics = createRpcDiagnosticContext(firstProvider)
	}

	async #getBlockHeader(blockNumber: bigint): Promise<RpcBlockHeader> {
		return requireRpcBlockHeader(await this.#client.getBlock({ blockNumber }), blockNumber)
	}

	#rememberHistoricalCodeUnavailable(address: Address, error: unknown): void {
		const key = address.toLowerCase()
		if (this.#historicalCodeUnavailable.has(key)) return
		this.#historicalCodeUnavailable.add(key)
		console.warn(
			`[${this.#network.id}] historical contract code unavailable for ${address}; scanning complete available coverage from block #${this.#network.startBlock} instead: ${this.#rpcFailureReason(error)}`,
		)
	}

	async #findManifestDeployment(
		address: Address,
		startBlock: bigint,
		indexedBoundary: bigint,
		startBlockKnownAbsent: boolean,
	): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> {
		if (this.#historicalCodeUnavailable.has(address.toLowerCase())) return { block: startBlock, exact: false }
		return await findManifestContractDeployment(
			address,
			startBlock,
			indexedBoundary,
			startBlockKnownAbsent,
			(candidate, blockNumber) => this.#client.getBytecode({ address: candidate, blockNumber }),
			5_000,
			Date.now,
			(error) => this.#rememberHistoricalCodeUnavailable(address, error),
		)
	}

	async run(): Promise<void> {
		console.info(`[${this.#network.id}] indexer state: starting`)
		console.info(`[${this.#network.id}] RPC providers: ${this.#providers.map(({ endpoint }) => endpoint).join(', ')}`)
		await runIndexerOwnershipLifecycle({
			networkId: this.#network.id,
			onEvent: (event) => recordOwnershipEvent(this.#network.id, event),
			acquire: () => this.#database.tryAcquireIndexerLock(this.#network.chainId),
			seed: (lease) => this.#seed(lease),
			runOwned: async (lease) => {
				this.#lease = lease
				try {
					await runOwnedNetworkLifecycle({
						reconcile: () => this.#reconcileManifestBackfill(),
						poll: () => this.#poll(),
						runWithProvider: (operation) => this.#withProviderFailover(operation),
						failure: (message, nextRetryAt, reason) => this.#recordFailure(message, nextRetryAt, this.#requireLease(), reason),
						intervalMs: runtimeConfig.pollIntervalMs,
						signal: this.#signal,
					})
				} finally {
					this.#lease = undefined
				}
			},
			failure: async (message, lease) => {
				if (lease === undefined) {
					console.error(`[${this.#network.id}] indexer state: degraded; ownership unavailable: ${message}`)
					return
				}
				await this.#recordFailure(message, new Date(Date.now() + runtimeConfig.pollIntervalMs), lease)
			},
			standby: () => console.info(`[${this.#network.id}] indexer state: standby; another replica owns the network indexer lock`),
			intervalMs: runtimeConfig.pollIntervalMs,
			signal: this.#signal,
		})
	}

	async #seed(lease: IndexerLease): Promise<void> {
		const [checkpoint, storedStartBlock, storedBlockTip] = await Promise.all([
			this.#database.checkpoint(this.#network.chainId, lease),
			this.#database.networkStartBlock(this.#network.chainId, lease),
			this.#database.storedBlockTip(this.#network.chainId, lease),
		])
		let retainedBoundary = checkpoint?.number ?? storedBlockTip
		if (storedStartBlock !== undefined) {
			if (this.#configuredStartBlock > storedStartBlock) {
				await this.#database.seedNetwork(this.#network, lease, true, true)
				throw new Error('Stored history boundary validation unexpectedly succeeded')
			}
			this.#network = { ...this.#network, startBlock: storedStartBlock }
			if (retainedBoundary === undefined) retainedBoundary = await this.#withProviderFailover(() => this.#client.getBlockNumber())
			await this.#validateManifestChange(retainedBoundary, storedStartBlock, lease)
			const manifestChanged = await this.#database.seedNetwork(this.#network, lease, true, true)
			if (checkpoint !== undefined && manifestChanged) this.#reportManifestReplay(checkpoint)
			return
		}
		await this.#withProviderFailover(async () => {
			const observedHead = await this.#client.getBlockNumber()
			const startBlock = await initialIndexStartBlock(
				this.#network.contracts,
				this.#configuredStartBlock,
				observedHead,
				(address, searchStart, indexedBoundary, startBlockKnownAbsent) =>
					this.#findManifestDeployment(address, searchStart, indexedBoundary, startBlockKnownAbsent),
			)
			this.#network = { ...this.#network, startBlock }
			console.info(
				`[${this.#network.id}] initial index boundary: block #${startBlock}; earliest tracked deployment discovered through observed head #${observedHead}`,
			)
		})
		const manifestChanged = await this.#database.seedNetwork(this.#network, lease, true, true)
		if (checkpoint !== undefined && manifestChanged) this.#reportManifestReplay(checkpoint)
	}

	async #validateManifestChange(checkpoint: bigint, storedStartBlock: bigint, lease: IndexerLease): Promise<void> {
		const [storedContracts, cursors] = await Promise.all([
			this.#database.contracts(this.#network.chainId, lease),
			this.#database.logScanCursors(this.#network.chainId, lease),
		])
		await this.#withProviderFailover(() =>
			manifestChangeRequiresFullReplay(
				this.#network.contracts,
				storedContracts,
				cursors,
				checkpoint,
				this.#configuredStartBlock,
				storedStartBlock,
				(address, searchStart, indexedBoundary, startBlockKnownAbsent) =>
					this.#findManifestDeployment(address, searchStart, indexedBoundary, startBlockKnownAbsent),
			),
		)
	}

	#reportManifestReplay(checkpoint: { readonly number: bigint; readonly hash: Hash }): void {
		console.info(
			`[${this.#network.id}] canonical manifest changed at indexed block #${checkpoint.number}; discarded prior canonical history and replaying from block #${this.#network.startBlock}`,
		)
	}

	async #withProviderFailover<T>(operation: () => Promise<T>): Promise<T> {
		return await withVerifiedProvider(
			this.#providers,
			this.#network.chainId,
			async ({ client }) => {
				this.#client = client
				return await operation()
			},
			isLocalIndexerFailure,
			(provider) => this.#rpcDiagnostics.select(provider),
			this.#verifiedProviders,
		)
	}

	#rpcFailureReason(error: unknown): string {
		return this.#rpcDiagnostics.failureReason(error)
	}

	async #recordFailure(message: string, nextRetryAt: Date, lease: IndexerLease, reason?: string): Promise<void> {
		await this.#database.recordFailure(this.#network.chainId, message, nextRetryAt, lease)
		const localFailure = message === databaseFailureMessage || message === rpcQueueSaturatedMessage
		const logMessage = localFailure
			? `${message}${reason === undefined ? '' : ` (reason: ${reason})`}`
			: rpcFailureLogMessage(message, this.#rpcDiagnostics.activeEndpoint(), reason)
		this.#lastReportedPhase = 'degraded'
		console.error(`[${this.#network.id}] indexer state: degraded; ${logMessage}`)
	}

	#reportProgress(startBlock: bigint, endBlock: bigint, observedHead: bigint): void {
		const phase = endBlock >= observedHead ? 'live' : 'backfilling'
		const now = Date.now()
		const previousSample = this.#progressSample
		let blocksPerSecond = previousSample?.blocksPerSecond
		if (previousSample !== undefined && endBlock > previousSample.block && now - previousSample.sampledAt >= 1_000) {
			const observedRate = bigintToSafeNumber(endBlock - previousSample.block, 'Indexer progress block count') / ((now - previousSample.sampledAt) / 1_000)
			blocksPerSecond = blocksPerSecond === undefined ? observedRate : blocksPerSecond * 0.7 + observedRate * 0.3
			this.#progressSample = { block: endBlock, sampledAt: now, blocksPerSecond }
		} else if (previousSample === undefined || endBlock < previousSample.block) {
			this.#progressSample = { block: endBlock, sampledAt: now }
		}
		if (phase === 'backfilling' && this.#lastReportedPhase === phase && this.#lastProgressLogAt !== undefined && now - this.#lastProgressLogAt < 30_000) return
		this.#lastReportedPhase = phase
		this.#lastProgressLogAt = now
		console.info(indexerProgressMessage(this.#network.id, startBlock, endBlock, observedHead, this.#network.startBlock, blocksPerSecond))
	}

	#reportWaitingForStart(observedHead: bigint): void {
		if (this.#lastReportedPhase === 'live') return
		this.#lastReportedPhase = 'live'
		this.#lastProgressLogAt = Date.now()
		console.info(indexerWaitingMessage(this.#network.id, this.#network.startBlock, observedHead))
	}

	async #assertLease(): Promise<void> {
		try {
			await this.#requireLease().assertHeld()
		} catch (error) {
			throw new LeaseLostError('Indexer lease was lost; reacquiring', { cause: error })
		}
	}

	#requireLease(): IndexerLease {
		if (this.#lease === undefined) throw new LeaseLostError('Indexer lease is unavailable; reacquiring')
		return this.#lease
	}

	#withManifestDeploymentBlocks(contracts: ReadonlyMap<string, ContractMetadata>): Map<string, ContractMetadata> {
		const configured = new Map(this.#network.contracts.map(([address, , , deploymentBlock]) => [address.toLowerCase(), deploymentBlock]))
		return new Map(
			[...contracts].map(([key, contract]) => {
				const deploymentBlock = configured.get(key)
				return [key, deploymentBlock === undefined ? contract : { ...contract, deploymentBlock, deploymentBlockExact: true }]
			}),
		)
	}

	async #reconcileManifestBackfill(): Promise<void> {
		await this.#assertLease()
		const checkpoint = await this.#database.checkpoint(this.#network.chainId, this.#requireLease())
		if (checkpoint === undefined) return
		const [storedContracts, cursors] = await Promise.all([
			this.#database.contracts(this.#network.chainId, this.#requireLease()),
			this.#database.logScanCursors(this.#network.chainId, this.#requireLease()),
		])
		const replayStart = await planManifestBackfill(
			this.#network.contracts,
			storedContracts,
			cursors,
			checkpoint.number,
			this.#configuredStartBlock,
			(address, startBlock, indexedBoundary, startBlockKnownAbsent) =>
				this.#findManifestDeployment(address, startBlock, indexedBoundary, startBlockKnownAbsent),
		)
		if (replayStart === undefined) return
		const ancestor = manifestReplayAncestor(replayStart, this.#network.startBlock)
		const ancestorHash = ancestor < 0n ? undefined : await this.#database.canonicalHash(this.#network.chainId, ancestor, this.#requireLease())
		if (ancestor >= 0n && ancestorHash === undefined)
			throw new DatabaseConsistencyError('Manifest backfill ancestor is unavailable', {
				code: 'manifest-backfill-ancestor-missing',
				ancestor,
			})
		await this.#assertLease()
		await this.#database.rewind(this.#network.chainId, ancestor, ancestorHash, this.#requireLease())
		this.#indexingStartReported = false
		this.#lastReportedPhase = undefined
		console.info(
			`[${this.#network.id}] manifest history gap detected; rewound to ${ancestor < 0n ? 'before the configured start block' : `block #${ancestor}`} to replay from block #${replayStart}`,
		)
	}

	async #reconcileReorg(): Promise<void> {
		const checkpoint = await this.#database.checkpoint(this.#network.chainId, this.#requireLease())
		if (checkpoint === undefined) return
		const remote = await this.#getBlockHeader(checkpoint.number)
		if (remote.hash === checkpoint.hash) return
		const floor = reorgSearchFloor(this.#network.startBlock, checkpoint.number, this.#network.confirmationDepth)
		for (let number = checkpoint.number - 1n; number >= floor; number--) {
			const [storedHash, block] = await Promise.all([
				this.#database.canonicalHash(this.#network.chainId, number, this.#requireLease()),
				this.#getBlockHeader(number),
			])
			if (storedHash !== undefined && storedHash === block.hash) {
				await this.#assertLease()
				await this.#database.rewind(this.#network.chainId, number, storedHash, this.#requireLease())
				return
			}
			if (number === 0n) break
		}
		await this.#assertLease()
		await this.#database.rewind(this.#network.chainId, -1n, undefined, this.#requireLease())
	}

	async #refreshContractDeployment(indexedBoundary: bigint): Promise<void> {
		const now = Date.now()
		if (!contractDeploymentScanDue(this.#lastDeploymentScanAt, now)) return
		try {
			let candidate: ContractMetadata | undefined
			try {
				const candidates = await this.#database.contractDeploymentCandidates(this.#network.chainId, indexedBoundary, this.#requireLease())
				candidate = contractDeploymentCandidateFrom(candidates, this.#historicalCodeUnavailable)
			} catch (error) {
				if (errorChainIncludes(error, leaseFailureNames)) throw error
				console.warn(
					`[${this.#network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, this.#rpcDiagnostics.activeNumber(), 'storage')}`,
				)
				return
			}
			if (candidate === undefined) return
			let resolved: ContractDeploymentObservation['deployment']
			try {
				const readWithinBudget = deploymentReadBudget()
				const historicalRead = await readHistoricalCodeWithPermanentFallback(
					() =>
						findContractDeploymentBlock(this.#network.startBlock, indexedBoundary, (blockNumber) =>
							readWithinBudget(() => this.#client.getBytecode({ address: candidate.address, blockNumber })),
						),
					(error) => this.#rememberHistoricalCodeUnavailable(candidate.address, error),
				)
				if (historicalRead.status === 'unavailable') return
				const deployment = historicalRead.value
				resolved =
					deployment === undefined
						? undefined
						: {
								...deployment,
								timestamp: unixSecondsToDate((await readWithinBudget(() => this.#getBlockHeader(deployment.block))).timestamp, 'Deployment block timestamp'),
							}
			} catch (error) {
				if (rpcQueueSaturationFrom(error) !== undefined) throw error
				console.warn(
					`[${this.#network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, this.#rpcDiagnostics.activeNumber(), 'rpc')}`,
				)
				return
			}
			try {
				await this.#assertLease()
				await this.#database.recordContractDeployment(this.#network.chainId, candidate.address, indexedBoundary, resolved, this.#requireLease())
			} catch (error) {
				if (errorChainIncludes(error, leaseFailureNames)) throw error
				console.warn(
					`[${this.#network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, this.#rpcDiagnostics.activeNumber(), 'storage')}`,
				)
			}
		} finally {
			this.#lastDeploymentScanAt = Date.now()
		}
	}

	async #poll(): Promise<boolean> {
		await this.#assertLease()
		await this.#reconcileReorg()
		const observedHead = await this.#client.getBlockNumber()
		const checkpoint = await this.#database.checkpoint(this.#network.chainId, this.#requireLease())
		let nextBlock = checkpoint === undefined ? this.#network.startBlock : checkpoint.number + 1n
		if (nextBlock > observedHead) {
			if (checkpoint !== undefined) {
				await this.#refreshRichListBalances(checkpoint.number, checkpoint.hash)
				await this.#refreshEntityStateSnapshots(checkpoint.number, checkpoint.hash)
			}
			await this.#assertLease()
			await this.#database.updateObservedHead(this.#network.chainId, observedHead, 'live', this.#requireLease())
			if (checkpoint === undefined) this.#reportWaitingForStart(observedHead)
			else if (this.#lastReportedPhase !== 'live') this.#reportProgress(observedHead, observedHead, observedHead)
			if (checkpoint !== undefined) await this.#refreshContractDeployment(checkpoint.number)
			return true
		}

		if (!this.#indexingStartReported) {
			const completion = indexingCompletion(this.#network.startBlock, nextBlock - 1n, observedHead)
			console.info(
				`[${this.#network.id}] indexer state: backfilling; fetching from block #${nextBlock}; observed head #${observedHead}; ${completion.percentage}% complete; ${completion.remainingBlocks} blocks behind; estimating ETA`,
			)
			this.#progressSample = { block: nextBlock - 1n, sampledAt: Date.now() }
			this.#indexingStartReported = true
		}
		const batchStart = nextBlock
		let contracts = this.#withManifestDeploymentBlocks(await this.#database.contracts(this.#network.chainId, this.#requireLease()))
		let tokenMetadata = await this.#database.tokenMetadata(this.#network.chainId, this.#requireLease())
		const storedCursors = await this.#database.logScanCursors(this.#network.chainId, this.#requireLease())
		const initialContracts = indexerLogSources([...contracts.values()])
		const initialAddresses = initialContracts.map(({ address }) => address)
		for (const address of initialAddresses) {
			const cursor = storedCursors.get(address.toLowerCase())
			if (cursor !== undefined && cursor.lastRetrievedBlock >= nextBlock)
				throw new DatabaseConsistencyError(`Log cursor ${address} is ahead of the network checkpoint`)
		}
		let segment: {
			readonly toBlock: bigint
			readonly logs: readonly Log[]
			readonly endBlockHash?: Hash
			readonly scanInputs: readonly LogScanInput[]
			readonly deploymentObservations: readonly ContractDeploymentObservation[]
		}
		let headers: readonly RpcBlockHeader[]
		try {
			segment = await this.#getNextLogSegment(nextBlock, observedHead, initialContracts)
			const blockNumbers = Array.from(
				{ length: bigintToSafeNumber(segment.toBlock - nextBlock + 1n, 'Log segment block count') },
				(_, index) => nextBlock + BigInt(index),
			)
			headers = await mapLimit(blockNumbers, 20, (blockNumber) => this.#getBlockHeader(blockNumber))
			const endHeader = headers.at(-1)
			if (endHeader === undefined) throw new Error(`RPC did not return block ${segment.toBlock}`)
			if (segment.endBlockHash !== undefined && endHeader.hash !== segment.endBlockHash)
				throw new ChainContinuityError(`Canonical chain changed after querying logs through block ${segment.toBlock}`)
		} catch (error) {
			if (error instanceof ChainContinuityError) return false
			throw error
		}
		const end = segment.toBlock
		for (const observation of segment.deploymentObservations) {
			const key = observation.contractAddress.toLowerCase()
			const contract = contracts.get(key)
			if (contract === undefined) continue
			contracts.set(key, {
				...contract,
				deploymentCheckedBlock: observation.checkedBlock,
				...(observation.deployment === undefined
					? {}
					: {
							deploymentBlock: observation.deployment.block,
							deploymentTimestamp: observation.deployment.timestamp,
							deploymentBlockExact: observation.deployment.exact,
						}),
			})
		}
		console.info(`[${this.#network.id}] fetched ${segment.logs.length} protocol log${segment.logs.length === 1 ? '' : 's'} for blocks #${nextBlock}-#${end}`)
		const logsByBlock = new Map<bigint, Log[]>()
		this.#mergeLogs(logsByBlock, segment.logs)
		let expectedParentHash = checkpoint?.hash
		if (expectedParentHash === undefined && requiresParentLookup(nextBlock, this.#network.startBlock)) {
			expectedParentHash = (await this.#getBlockHeader(nextBlock - 1n)).hash
		}
		while (nextBlock <= end && !this.#signal.aborted) {
			const header = headers[bigintToSafeNumber(nextBlock - batchStart, 'Block header offset')]
			if (header === undefined) throw new Error(`RPC did not return block ${nextBlock}`)
			let indexed: { block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }
			try {
				indexed = await this.#indexBlock(
					nextBlock,
					observedHead,
					contracts,
					tokenMetadata,
					expectedParentHash,
					header,
					logsByBlock.get(nextBlock) ?? [],
					async (discoveredAddresses, discoveredContracts) => {
						const coverage = await scanDiscoveredLogCoverage(
							nextBlock,
							end,
							discoveredAddresses,
							discoveredContracts,
							(addresses) => this.#getKnownLogs(nextBlock, addresses, discoveredContracts, header.hash),
							(fromBlock, toBlock, addresses) =>
								this.#getAllLogs(fromBlock, toBlock, addresses, discoveredContracts, (blockNumber) => {
									const expected = headers[bigintToSafeNumber(blockNumber - batchStart, 'Log block header offset')]
									if (expected === undefined) throw new Error(`RPC did not return block ${blockNumber}`)
									return expected.hash
								}),
						)
						this.#mergeLogs(logsByBlock, coverage.remainingLogs)
						return coverage.currentBlockLogs
					},
				)
			} catch (error) {
				if (error instanceof ChainContinuityError) {
					await this.#reconcileReorg()
					return false
				}
				throw error
			}
			const isSegmentEnd = nextBlock === end
			const block = isSegmentEnd
				? {
						...indexed.block,
						contractDeploymentObservations: segment.deploymentObservations,
						logScanCursors: logScanCursorUpdates(indexed.contracts, segment.scanInputs, end, this.#network.startBlock, batchStart),
					}
				: indexed.block
			await this.#assertLease()
			await this.#database.storeBlock(this.#network.chainId, block, this.#requireLease())
			contracts = indexed.contracts
			tokenMetadata = indexed.tokenMetadata
			expectedParentHash = indexed.block.hash
			nextBlock++
		}
		if (nextBlock > batchStart) {
			const indexedThrough = nextBlock - 1n
			this.#reportProgress(batchStart, indexedThrough, observedHead)
			await this.#refreshContractDeployment(indexedThrough)
		}
		return end >= observedHead
	}

	async #queryLogs(toBlock: bigint, inputs: readonly LogScanInput[], contracts: ReadonlyMap<string, ContractMetadata>): Promise<readonly Log[]> {
		const filteredKinds = new Set(['uniswapV2Factory', 'uniswapV3Factory', 'uniswapV4PoolManager'])
		const inputsOfKind = (kind: string): readonly LogScanInput[] => inputs.filter(({ address }) => contracts.get(address.toLowerCase())?.kind === kind)
		const ordinaryInputs = inputs.filter(({ address }) => !filteredKinds.has(contracts.get(address.toLowerCase())?.kind ?? ''))
		const groups = rpcLogQueryGroups(ordinaryInputs)
		const ordinaryPages = await mapLimit(groups, 3, (group) => this.#client.getLogs({ address: group.addresses, fromBlock: group.fromBlock, toBlock }))
		const tokenPairs = uniswapV2V3TokenPairs(contracts.values())
		const v2Queries = inputsOfKind('uniswapV2Factory').flatMap((input) => tokenPairs.map((tokens) => ({ input, ...tokens })))
		const v2Pages = await mapLimit(v2Queries, 3, ({ input, token0, token1 }) =>
			this.#client.getLogs({ address: input.address, event: uniswapV2PairCreatedEvent, args: { token0, token1 }, fromBlock: input.fromBlock, toBlock }),
		)
		const v3Queries = inputsOfKind('uniswapV3Factory').flatMap((input) => tokenPairs.map((tokens) => ({ input, ...tokens })))
		const v3Pages = await mapLimit(v3Queries, 3, ({ input, token0, token1 }) =>
			this.#client.getLogs({ address: input.address, event: uniswapV3PoolCreatedEvent, args: { token0, token1 }, fromBlock: input.fromBlock, toBlock }),
		)
		const poolIdGroups = chunks(uniswapV4PoolIds(contracts), 25)
		const v4Queries = inputsOfKind('uniswapV4PoolManager').flatMap((input) => poolIdGroups.map((ids) => ({ input, ids })))
		const initializePages = await mapLimit(v4Queries, 3, ({ input, ids }) =>
			this.#client.getLogs({ address: input.address, event: uniswapV4InitializeEvent, args: { id: ids }, fromBlock: input.fromBlock, toBlock }),
		)
		const swapPages = await mapLimit(v4Queries, 3, ({ input, ids }) =>
			this.#client.getLogs({ address: input.address, event: uniswapV4SwapEvent, args: { id: ids }, fromBlock: input.fromBlock, toBlock }),
		)
		const unique = new Map<string, Log>()
		for (const log of [...ordinaryPages.flat(), ...v2Pages.flat(), ...v3Pages.flat(), ...initializePages.flat(), ...swapPages.flat()]) {
			const position = requireLogPosition(log)
			const input = inputs.find(({ address }) => address.toLowerCase() === log.address.toLowerCase())
			if (input === undefined || position.blockNumber < input.fromBlock || position.blockNumber > toBlock)
				throw new ChainContinuityError(`RPC returned a log outside its requested deployment-aware range through ${toBlock}`)
			unique.set(`${position.transactionHash}:${position.logIndex}`, log)
		}
		return [...unique.values()].sort((left, right) => {
			const a = requireLogPosition(left)
			const b = requireLogPosition(right)
			return a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
		})
	}

	async #getLogsForInputs(
		toBlock: bigint,
		inputs: readonly LogScanInput[],
		contracts: ReadonlyMap<string, ContractMetadata>,
	): Promise<{ readonly logs: readonly Log[]; readonly endBlockHash: Hash }> {
		const range = await queryCanonicalLogRange(
			toBlock,
			async () => (await this.#getBlockHeader(toBlock)).hash,
			() => this.#queryLogs(toBlock, inputs, contracts),
		)
		return { logs: range.items, endBlockHash: range.endBlockHash }
	}

	async #getLogs(
		fromBlock: bigint,
		toBlock: bigint,
		addresses: readonly Address[],
		contracts: ReadonlyMap<string, ContractMetadata>,
	): Promise<{ readonly logs: readonly Log[]; readonly endBlockHash: Hash }> {
		return await this.#getLogsForInputs(
			toBlock,
			addresses.map((address) => ({ address, fromBlock, startBlock: fromBlock })),
			contracts,
		)
	}

	async #getNextLogSegment(
		fromBlock: bigint,
		maximumToBlock: bigint,
		contracts: readonly ContractMetadata[],
	): Promise<{
		readonly toBlock: bigint
		readonly logs: readonly Log[]
		readonly endBlockHash?: Hash
		readonly scanInputs: readonly LogScanInput[]
		readonly deploymentObservations: readonly ContractDeploymentObservation[]
	}> {
		if (contracts.length === 0) {
			const maximum = fromBlock + BigInt(runtimeConfig.logScanRangeSize - 1)
			return { toBlock: maximum < maximumToBlock ? maximum : maximumToBlock, logs: [], scanInputs: [], deploymentObservations: [] }
		}
		let endBlockHash: Hash | undefined
		let successfulPlan: DeploymentAwareLogPlan | undefined
		const segment = await queryAdaptiveLogRange(
			fromBlock,
			maximumToBlock,
			runtimeConfig.logScanRangeSize,
			async (rangeStart, rangeEnd) => {
				let plan: DeploymentAwareLogPlan | undefined
				const contractMap = new Map(contracts.map((contract) => [contract.address.toLowerCase(), contract]))
				const range = await queryCanonicalLogRange(
					rangeEnd,
					async () => (await this.#getBlockHeader(rangeEnd)).hash,
					async () => {
						plan = await planDeploymentAwareLogScan(
							contracts,
							rangeStart,
							rangeEnd,
							this.#network.startBlock,
							(address, blockNumber) => this.#client.getBytecode({ address, blockNumber }),
							async (blockNumber) => unixSecondsToDate((await this.#getBlockHeader(blockNumber)).timestamp, 'Deployment scan block timestamp'),
							(contract, error) => this.#rememberHistoricalCodeUnavailable(contract.address, error),
							this.#historicalCodeUnavailable,
						)
						return await this.#queryLogs(rangeEnd, plan.inputs, contractMap)
					},
				)
				endBlockHash = range.endBlockHash
				if (plan === undefined) throw new Error(`RPC did not plan log range through block ${rangeEnd}`)
				successfulPlan = plan
				return range.items
			},
			(failedFrom, failedTo, retryTo, error) =>
				console.warn(
					`[${this.#network.id}] RPC log range #${failedFrom}-#${failedTo} failed (${this.#rpcFailureReason(error)}); retrying #${failedFrom}-#${retryTo}`,
				),
			isSplittableLogRangeError,
		)
		if (endBlockHash === undefined) throw new Error(`RPC did not anchor log range through block ${segment.toBlock}`)
		if (successfulPlan === undefined) throw new Error(`RPC did not plan log range through block ${segment.toBlock}`)
		return {
			toBlock: segment.toBlock,
			logs: segment.items,
			endBlockHash,
			scanInputs: successfulPlan.inputs,
			deploymentObservations: successfulPlan.observations,
		}
	}

	async #getAllLogs(
		fromBlock: bigint,
		toBlock: bigint,
		addresses: readonly Address[],
		contracts: ReadonlyMap<string, ContractMetadata>,
		expectedBlockHash: (blockNumber: bigint) => Hash,
	): Promise<readonly Log[]> {
		const logs: Log[] = []
		let cursor = fromBlock
		while (cursor <= toBlock) {
			const segment = await queryAdaptiveLogRange(
				cursor,
				toBlock,
				runtimeConfig.logScanRangeSize,
				async (rangeStart, rangeEnd) => {
					const range = await this.#getLogs(rangeStart, rangeEnd, addresses, contracts)
					if (range.endBlockHash !== expectedBlockHash(rangeEnd))
						throw new ChainContinuityError(`Canonical chain changed after querying logs through block ${rangeEnd}`)
					return range.logs
				},
				(failedFrom, failedTo, retryTo, error) =>
					console.warn(
						`[${this.#network.id}] RPC log range #${failedFrom}-#${failedTo} failed (${this.#rpcFailureReason(error)}); retrying #${failedFrom}-#${retryTo}`,
					),
				isSplittableLogRangeError,
			)
			logs.push(...segment.items)
			cursor = segment.toBlock + 1n
		}
		return logs
	}

	#mergeLogs(target: Map<bigint, Log[]>, logs: readonly Log[]): void {
		for (const log of logs) {
			const position = requireLogPosition(log)
			const existing = target.get(position.blockNumber) ?? []
			if (
				!existing.some((candidate) => {
					const candidatePosition = requireLogPosition(candidate)
					return candidatePosition.transactionHash === position.transactionHash && candidatePosition.logIndex === position.logIndex
				})
			) {
				existing.push(log)
				existing.sort((left, right) => {
					const a = requireLogPosition(left)
					const b = requireLogPosition(right)
					return a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex
				})
				target.set(position.blockNumber, existing)
			}
		}
	}

	async #getKnownLogs(blockNumber: bigint, addresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>, blockHash: Hash): Promise<Log[]> {
		const range = await this.#getLogs(blockNumber, blockNumber, addresses, contracts)
		if (range.endBlockHash !== blockHash) throw new ChainContinuityError(`RPC log response changed while indexing block ${blockNumber}`)
		for (const log of range.logs) {
			if (requireLogPosition(log).blockHash !== blockHash) throw new ChainContinuityError(`RPC log response changed while indexing block ${blockNumber}`)
		}
		return [...range.logs]
	}

	async #indexBlock(
		number: bigint,
		observedHead: bigint,
		currentContracts: ReadonlyMap<string, ContractMetadata>,
		currentTokenMetadata: ReadonlyMap<string, TokenMetadata>,
		expectedParentHash: Hash | undefined,
		block: RpcBlockHeader,
		prefetchedLogs: readonly Log[],
		getDiscoveredLogs: (addresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>) => Promise<readonly Log[]>,
	): Promise<{ block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }> {
		if (expectedParentHash !== undefined && block.parentHash !== expectedParentHash) {
			throw new ChainContinuityError(`Block ${number} does not extend the indexed canonical chain`)
		}
		const contracts = new Map(currentContracts)
		const knownLogs = [...prefetchedLogs]
		for (const log of knownLogs) {
			const position = requireLogPosition(log)
			if (position.blockHash !== block.hash || position.blockNumber !== number)
				throw new ChainContinuityError(`RPC log response changed while indexing block ${number}`)
		}
		const relevantHashes = new Set<Hash>(knownLogs.map((log) => requireLogPosition(log).transactionHash))
		const transactionByHash = new Map<Hash, { transaction: Transaction; index: number }>()

		const receipts: TransactionReceipt[] = []
		const receiptByHash = new Map<Hash, TransactionReceipt>()
		const fetchMissingEvidence = async (): Promise<void> => {
			const missing = [...relevantHashes].filter((hash) => !receiptByHash.has(hash))
			for (const { receipt, transaction } of await mapLimit(missing, 8, async (hash) => {
				const [receipt, transaction] = await Promise.all([this.#client.getTransactionReceipt({ hash }), this.#client.getTransaction({ hash })])
				return { receipt, transaction }
			})) {
				requireReceiptPosition(receipt, block.hash, number)
				if (receipt.status !== 'success') throw new ChainContinuityError(`Log-selected transaction ${transaction.hash} did not succeed`)
				if (transaction.blockHash !== block.hash || transaction.blockNumber !== number || transaction.transactionIndex === undefined)
					throw new ChainContinuityError(`Transaction ${transaction.hash} no longer belongs to block ${number}`)
				const transactionIndex = bigintToSafeNumber(transaction.transactionIndex, `Transaction ${transaction.hash} index`)
				receipts.push(receipt)
				receiptByHash.set(receipt.transactionHash, receipt)
				transactionByHash.set(transaction.hash, { transaction, index: transactionIndex })
			}
		}
		await fetchMissingEvidence()
		const discovered: ContractMetadata[] = []
		while (true) {
			const discoveredAddresses: Address[] = []
			const labels = labelsFrom(contracts)
			for (const receipt of receipts) {
				for (const log of receipt.logs) {
					const emitter = log.address.toLowerCase()
					const contract = contracts.get(emitter)
					if (contract === undefined) continue
					const decoded = decodeLogRecord(contract.kind, log.topics, log.data, labels)
					for (const candidate of discoveriesFrom(decoded, contracts)) {
						const key = candidate.address.toLowerCase()
						if (contracts.has(key)) continue
						const metadata: ContractMetadata = {
							...candidate,
							provenance: `${contract.label}.${decoded.name ?? 'event'}`,
							discoveryBlock: number,
							discoveryTxHash: receipt.transactionHash,
						}
						contracts.set(key, metadata)
						discovered.push(metadata)
						discoveredAddresses.push(metadata.address)
					}
				}
			}
			for (const coordinator of discovered.filter((contract) => contract.kind === 'priceCoordinator')) {
				const registryResult = await this.#client.readContract({
					address: coordinator.address,
					abi: priceCoordinatorDependenciesAbi,
					functionName: 'liquidationApprovalRegistry',
					blockNumber: number,
				})
				if (typeof registryResult !== 'string') throw new Error(`${coordinator.label}.liquidationApprovalRegistry returned an invalid address`)
				const registry = getAddress(registryResult)
				if (!contracts.has(registry.toLowerCase())) {
					const metadata: ContractMetadata = {
						address: registry,
						kind: 'liquidationApprovalRegistry',
						label: 'Liquidation Approval Registry',
						provenance: `${coordinator.label}.liquidationApprovalRegistry`,
						discoveryBlock: number,
						discoveryTxHash: coordinator.discoveryTxHash,
					}
					contracts.set(registry.toLowerCase(), metadata)
					discovered.push(metadata)
					discoveredAddresses.push(registry)
				}
			}
			if (discoveredAddresses.length === 0) break
			for (const log of await getDiscoveredLogs(discoveredAddresses, contracts)) {
				relevantHashes.add(requireLogPosition(log).transactionHash)
			}
			await fetchMissingEvidence()
		}

		const labels = labelsFrom(contracts)
		const tokenMetadata = new Map(currentTokenMetadata)
		const tokenCandidates = new Set<Address>()
		for (const metadata of tokenMetadata.values()) if (metadata.decimals === undefined) tokenCandidates.add(metadata.address)
		for (const contract of contracts.values()) {
			if (contract.kind === 'reputationToken' || contract.kind === 'shareToken' || contract.kind === 'weth' || contract.kind === 'usdc')
				tokenCandidates.add(contract.address)
		}
		for (const receipt of receipts) {
			for (const item of receipt.logs) {
				const contract = contracts.get(item.address.toLowerCase())
				if (contract === undefined) continue
				const decoded = decodeLogRecord(contract.kind, item.topics, item.data, labels)
				for (const candidate of tokenAddressesFrom(contract.kind, decoded, contract.address)) tokenCandidates.add(candidate)
			}
		}
		for (const hash of relevantHashes) {
			const pair = transactionByHash.get(hash)
			if (pair?.transaction.to === null || pair?.transaction.to === undefined) continue
			const contract = contracts.get(pair.transaction.to.toLowerCase())
			if (contract === undefined) continue
			const decoded = decodeAction(contract, pair.transaction.input, labels)
			for (const candidate of tokenAddressesFrom(contract.kind, decoded, contract.address)) tokenCandidates.add(candidate)
		}
		const readTokenMetadata = await mapLimit(
			[...tokenCandidates].filter((candidate) => tokenMetadataNeedsRead(tokenMetadata.get(candidate.toLowerCase()), number)),
			4,
			(candidate) => this.#readTokenMetadata(candidate, number),
		)
		for (const metadata of readTokenMetadata) tokenMetadata.set(metadata.address.toLowerCase(), metadata)
		const displayLabels = new Map(labels)
		const contractKinds = new Map([...contracts].map(([address, contract]) => [address, contract.kind] as const))
		const displayContext = { nativeSymbol: this.#network.nativeSymbol }
		for (const metadata of tokenMetadata.values()) {
			const label = metadata.name ?? metadata.symbol
			if (label !== undefined) displayLabels.set(metadata.address.toLowerCase(), metadata.symbol === undefined ? label : `${label} (${metadata.symbol})`)
		}
		const storedLogs: StoredLog[] = []
		for (const receipt of receipts) {
			for (const log of receipt.logs) {
				const contract = contracts.get(log.address.toLowerCase())
				if (!isProtocolEvidenceEmitter(contract)) continue
				const position = requireLogPosition(log)
				storedLogs.push({
					...position,
					address: getAddress(log.address),
					topics: log.topics,
					data: log.data,
					decoded: decodeLogRecord(contract.kind, log.topics, log.data, displayLabels, tokenMetadata, contract.address, contractKinds, displayContext),
				})
			}
		}

		const storedTransactions: StoredTransaction[] = []
		for (const hash of relevantHashes) {
			const pair = transactionByHash.get(hash)
			const receipt = receiptByHash.get(hash)
			if (pair === undefined || receipt === undefined) throw new Error(`Block ${number} did not contain relevant transaction ${hash}`)
			if (receipt.status !== 'success') throw new ChainContinuityError(`Log-selected transaction ${hash} did not succeed`)
			const to = pair.transaction.to === null || pair.transaction.to === undefined ? null : getAddress(pair.transaction.to)
			storedTransactions.push({
				hash,
				transactionIndex: pair.index,
				from: getAddress(pair.transaction.from),
				to,
				value: pair.transaction.value,
				input: pair.transaction.input,
				status: receipt.status,
				gasUsed: receipt.gasUsed,
				receipt: jsonEvidence(receipt),
				decoded: decodeAction(
					to === null ? undefined : contracts.get(to.toLowerCase()),
					pair.transaction.input,
					displayLabels,
					tokenMetadata,
					contractKinds,
					displayContext,
				),
			})
		}

		const finalizedThrough = observedHead > this.#network.confirmationDepth ? observedHead - this.#network.confirmationDepth : 0n
		await confirmCanonicalBlock(number, block.hash, async (blockNumber) => (await this.#getBlockHeader(blockNumber)).hash)
		return {
			contracts,
			tokenMetadata,
			block: {
				number,
				hash: block.hash,
				parentHash: block.parentHash,
				timestamp: unixSecondsToDate(block.timestamp, 'Block timestamp'),
				observedHead,
				finalizedThrough,
				contracts: discovered,
				tokenMetadata: readTokenMetadata,
				transactions: storedTransactions,
				logs: storedLogs,
				addressActivity: addressActivityFrom(storedTransactions, storedLogs, contracts),
				contractDeploymentObservations: [],
				logScanCursors: [],
			},
		}
	}

	async #refreshRichListBalances(blockNumber: bigint, blockHash: Hash): Promise<void> {
		const targets = await this.#database.richListBalanceTargets(this.#network.chainId, 10, this.#requireLease())
		if (targets.addresses.length === 0) return
		await commitCanonicalRead(
			blockNumber,
			blockHash,
			async () => {
				const balances: RichListBalance[] = []
				const nativeBalances = await mapLimit(targets.addresses, 8, async (owner) => ({
					owner,
					assetAddress: zeroAddress,
					assetKind: 'native' as const,
					balance: await this.#client.getBalance({ address: owner, blockNumber }),
				}))
				balances.push(...nativeBalances)
				const tokenRequests = targets.addresses.flatMap((owner) => targets.assets.map((asset) => ({ owner, asset })))
				balances.push(
					...(await mapLimit(tokenRequests, 8, async ({ owner, asset }) => ({
						owner,
						assetAddress: asset.address,
						assetKind: asset.kind,
						balance: await (async () => {
							const result = await this.#client.readContract({
								address: asset.address,
								abi: erc20BalanceAbi,
								functionName: 'balanceOf',
								args: [owner],
								blockNumber,
							})
							if (typeof result !== 'bigint') throw new Error(`${asset.address} balanceOf returned an invalid value`)
							return result
						})(),
					}))),
				)
				return balances
			},
			async (number) => (await this.#getBlockHeader(number)).hash,
			async (balances) => {
				await this.#assertLease()
				await this.#database.storeRichListBalances(this.#network.chainId, blockNumber, blockHash, balances, this.#requireLease())
			},
		)
	}

	async #refreshEntityStateSnapshots(blockNumber: bigint, blockHash: Hash): Promise<void> {
		const targets = await this.#database.stateSnapshotTargets(this.#network.chainId, blockNumber, 25, this.#requireLease())
		if (targets.length === 0) return
		await commitCanonicalRead(
			blockNumber,
			blockHash,
			async () => {
				const header = await this.#getBlockHeader(blockNumber)
				if (header.hash !== blockHash) throw new ChainContinuityError(`Canonical chain changed while sampling block ${blockNumber}`)
				const snapshots = await mapLimit(targets, 4, (target) => sampleEntityState(this.#client, target, blockNumber))
				return { snapshots, timestamp: unixSecondsToDate(header.timestamp, 'State snapshot block timestamp') }
			},
			async (number) => (await this.#getBlockHeader(number)).hash,
			async ({ snapshots, timestamp }) => {
				await this.#assertLease()
				await this.#database.storeEntityStateSnapshots(this.#network.chainId, blockNumber, blockHash, timestamp, snapshots, this.#requireLease())
			},
		)
	}

	async #readTokenMetadata(address: Address, blockNumber: bigint): Promise<TokenMetadata> {
		return await readTokenMetadata(address, blockNumber, {
			decimals: async () => {
				const result = await this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'decimals', blockNumber })
				if (typeof result !== 'bigint' || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ERC-20 decimals returned an invalid value')
				return Number(result)
			},
			name: async () => {
				const result = await this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'name', blockNumber })
				if (typeof result !== 'string') throw new Error('ERC-20 name returned an invalid value')
				return result
			},
			symbol: async () => {
				const result = await this.#client.readContract({ address, abi: erc20MetadataAbi, functionName: 'symbol', blockNumber })
				if (typeof result !== 'string') throw new Error('ERC-20 symbol returned an invalid value')
				return result
			},
		})
	}
}

export const startIndexers = (networks: readonly NetworkConfig[], database: ScannerDatabase, signal: AbortSignal): readonly Promise<void>[] =>
	networks.map((network) => runIndexerTask(network.id, () => new NetworkIndexer(network, database, signal).run()))

export const runIndexerTask = async (networkId: string, run: () => Promise<void>): Promise<void> => {
	try {
		await run()
		console.info(`[${networkId}] indexer state: stopped`)
	} catch (error) {
		const message = safeIndexerFailure(error)
		console.error(`[${networkId}] indexer state: stopped; ${message}`)
	}
}
