import { runtimeConfig } from '../config.ts'
import { type ContractDeploymentObservation, DatabaseConsistencyError, type LogScanCursor, manifestContractSetChanged } from '../database.ts'
import { errorChainIncludes } from '../error-chain.ts'
import { type Address, type Block, type Hash, type Hex, type PublicClient, parseAbi, parseAbiItem, zeroAddress } from '../ethereum.ts'
import {
	deploymentReadBudget,
	isPermanentHistoricalCodeError,
	isProtocolActivitySource,
	isPrunedHistoricalStateError,
	type RpcProvider,
	requiresManifestHistoryCoverage,
	safeIndexerFailureReason,
} from '../indexer-runtime.ts'
import { RotatingJsonLog } from '../logging.ts'
import { createRpcRequestQueue, rpcQueueSaturationFrom } from '../rpc-request-queue.ts'
import { bigintToSafeNumber } from '../time.ts'
import type { ContractMetadata, ManifestContract, TokenMetadata } from '../types.ts'
import { uniswapV4PoolConfigurations, uniswapV4PoolId } from '../uniswap.ts'

export type RpcBlockHeader = {
	readonly hash: Hash
	readonly parentHash: Hash
	readonly timestamp: bigint
}

export type IndexerRpcProvider = RpcProvider & { readonly logClient: PublicClient }

export const requireRpcBlockHeader = (block: Block, blockNumber: bigint): RpcBlockHeader => {
	if (block.hash === undefined || block.parentHash === undefined || block.number !== blockNumber) {
		throw new Error(`RPC returned an invalid canonical header for block ${blockNumber}`)
	}
	return { hash: block.hash, parentHash: block.parentHash, timestamp: block.timestamp }
}

export const RPC_CONCURRENCY = 5
export const RPC_MAX_PENDING = 100

export const erc20MetadataAbi = parseAbi([
	'function decimals() view returns (uint8)',
	'function name() view returns (string)',
	'function symbol() view returns (string)',
])
export const erc20BalanceAbi = parseAbi(['function balanceOf(address owner) view returns (uint256)'])
export const priceCoordinatorDependenciesAbi = parseAbi(['function liquidationApprovalRegistry() view returns (address)'])
export const uniswapV4InitializeEvent = parseAbiItem(
	'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
)
export const uniswapV2PairCreatedEvent = parseAbiItem('event PairCreated(address indexed token0,address indexed token1,address pair,uint256 pairIndex)')
export const uniswapV3PoolCreatedEvent = parseAbiItem(
	'event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)',
)
export const uniswapV4SwapEvent = parseAbiItem(
	'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
)
export const uniswapV4PoolIds = (contracts: ReadonlyMap<string, ContractMetadata>): readonly Hex[] =>
	[...contracts.values()]
		.filter(({ kind }) => kind === 'reputationToken')
		.flatMap(({ address }) => {
			const quotes = [zeroAddress, ...[...contracts.values()].filter(({ kind }) => kind === 'usdc').map(({ address: quote }) => quote)]
			return quotes.flatMap((quote) => uniswapV4PoolConfigurations.map(({ fee, tickSpacing }) => uniswapV4PoolId(address, fee, tickSpacing, quote)))
		})

export const tokenMetadataNeedsRead = (metadata: TokenMetadata | undefined, blockNumber: bigint, stateStartBlock = 0n): boolean =>
	blockNumber >= stateStartBlock &&
	(metadata === undefined || (metadata.decimals === undefined && (metadata.readError === prunedTokenMetadataError || blockNumber >= metadata.readBlock + 25n)))

export const reorgSearchFloor = (startBlock: bigint, checkpoint: bigint, confirmationDepth: bigint): bigint => {
	const candidate = checkpoint > confirmationDepth ? checkpoint - confirmationDepth : startBlock
	return candidate > startBlock ? candidate : startBlock
}

export const requiresParentLookup = (nextBlock: bigint, startBlock: bigint): boolean => nextBlock > startBlock

export type TokenMetadataCalls = {
	readonly decimals: () => Promise<number>
	readonly name: () => Promise<string>
	readonly symbol: () => Promise<string>
}

export const unavailableMetadataErrors = new Set(['AbiDecodingError', 'ContractFunctionRevertedError', 'ContractFunctionZeroDataError'])
export const prunedTokenMetadataError = 'Historical state pruned'

export const isUnavailableMetadataCall = (error: unknown): boolean => errorChainIncludes(error, unavailableMetadataErrors)

export type MetadataCallResult<T> = { readonly status: 'available'; readonly value: T } | { readonly status: 'pruned' } | { readonly status: 'unavailable' }

export const metadataCall = async <T>(call: () => Promise<T>): Promise<MetadataCallResult<T>> => {
	try {
		return { status: 'available', value: await call() }
	} catch (error) {
		if (isPrunedHistoricalStateError(error)) return { status: 'pruned' }
		if (isUnavailableMetadataCall(error)) return { status: 'unavailable' }
		throw error
	}
}

export const readTokenMetadata = async (address: Address, blockNumber: bigint, calls: TokenMetadataCalls): Promise<TokenMetadata> => {
	try {
		const decimals = await metadataCall(calls.decimals)
		if (decimals.status === 'pruned') return { address, readError: prunedTokenMetadataError, readBlock: blockNumber }
		if (decimals.status !== 'available' || !Number.isSafeInteger(decimals.value) || decimals.value < 0 || decimals.value > 255)
			return { address, readError: 'ERC-20 metadata unavailable', readBlock: blockNumber }
		const [nameOutcome, symbolOutcome] = await Promise.allSettled([metadataCall(calls.name), metadataCall(calls.symbol)])
		const name = nameOutcome.status === 'fulfilled' ? nameOutcome.value : undefined
		const symbol = symbolOutcome.status === 'fulfilled' ? symbolOutcome.value : undefined
		if (name?.status === 'pruned' || symbol?.status === 'pruned') return { address, readError: prunedTokenMetadataError, readBlock: blockNumber }
		if (nameOutcome.status === 'rejected') throw nameOutcome.reason
		if (symbolOutcome.status === 'rejected') throw symbolOutcome.reason
		return {
			address,
			decimals: decimals.value,
			...(name?.status === 'available' ? { name: name.value } : {}),
			...(symbol?.status === 'available' ? { symbol: symbol.value } : {}),
			readBlock: blockNumber,
		}
	} catch (error) {
		if (isPrunedHistoricalStateError(error)) return { address, readError: prunedTokenMetadataError, readBlock: blockNumber }
		return { address, readError: safeIndexerFailureReason(error), readBlock: blockNumber }
	}
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

export const chunks = <T>(items: readonly T[], size: number): T[][] => {
	const result: T[][] = []
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
	return result
}

export const rpcRequestQueue = createRpcRequestQueue(RPC_CONCURRENCY, RPC_MAX_PENDING)
export const rpcExchangeLog = new RotatingJsonLog(runtimeConfig.rpcLogPath)

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
	coverageStartBlock = configuredStartBlock,
): Promise<bigint | undefined> => {
	const activeStartBlock = coverageStartBlock > configuredStartBlock ? coverageStartBlock : configuredStartBlock
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
		const knownDeploymentBlock =
			configuredDeploymentBlock ?? (requiresFreshDeploymentSearch || contract.deploymentBlockExact !== true ? undefined : contract.deploymentBlock)
		let deploymentBlock = knownDeploymentBlock === undefined || knownDeploymentBlock > activeStartBlock ? knownDeploymentBlock : activeStartBlock
		if (
			!requiresFreshDeploymentSearch &&
			cursor !== undefined &&
			cursor.lastRetrievedBlock >= checkpoint &&
			cursor.startBlock <= (deploymentBlock ?? activeStartBlock)
		)
			continue
		if (deploymentBlock === undefined) {
			const hasInexactDeployment = contract.deploymentBlock !== undefined && contract.deploymentBlockExact !== true
			const previousSearchStart =
				requiresFreshDeploymentSearch || hasInexactDeployment ? configuredStartBlock : (contract.deploymentCheckedBlock ?? configuredStartBlock)
			const searchStart = previousSearchStart > activeStartBlock ? previousSearchStart : activeStartBlock
			if (searchStart >= checkpoint && contract.deploymentCheckedBlock !== undefined && !requiresFreshDeploymentSearch && !hasInexactDeployment) continue
			const deployment = await findDeployment(
				address,
				searchStart,
				checkpoint,
				!requiresFreshDeploymentSearch && !hasInexactDeployment && contract.deploymentCheckedBlock !== undefined,
			)
			if (deployment === undefined) continue
			deploymentBlock = deployment.exact && deployment.block > activeStartBlock ? deployment.block : activeStartBlock
		}
		if (deploymentBlock > checkpoint) continue
		const cursorMissingStart = cursor === undefined || cursor.startBlock > deploymentBlock ? deploymentBlock : cursor.lastRetrievedBlock + 1n
		const missingStart = cursorMissingStart > activeStartBlock ? cursorMissingStart : activeStartBlock
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
		if (isPrunedHistoricalStateError(error)) throw error
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
		const coveredStartBlock = startBlock > configuredStartBlock ? startBlock : configuredStartBlock
		return coveredStartBlock > endBlock ? [] : [{ contractAddress: contract.address, startBlock: coveredStartBlock, lastRetrievedBlock: endBlock }]
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

export const mapLimit = async <T, R>(items: readonly T[], limit: number, operation: (item: T) => Promise<R>): Promise<R[]> => {
	const result = new Array<R>(items.length)
	let cursor = 0
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++
			const item = items[index]
			if (item !== undefined) result[index] = await operation(item)
		}
	})
	const outcomes = await Promise.allSettled(workers)
	const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []))
	if (failures.length > 0) throw failures.find((error) => isPrunedHistoricalStateError(error)) ?? failures[0]
	return result
}

export type DeploymentAwareLogPlan = {
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
	stateStartBlock = configuredStartBlock,
): Promise<DeploymentAwareLogPlan> => {
	const planned = await mapLimit(contracts, 4, async (contract): Promise<DeploymentAwareLogPlan> => {
		const knownStart = (contract.deploymentBlockExact === true ? contract.deploymentBlock : undefined) ?? contract.discoveryBlock
		if (knownStart !== undefined) {
			const coverageStart = knownStart > configuredStartBlock ? knownStart : configuredStartBlock
			return {
				inputs:
					coverageStart > toBlock
						? []
						: [{ address: contract.address, fromBlock: coverageStart > fromBlock ? coverageStart : fromBlock, startBlock: coverageStart }],
				observations: [],
			}
		}
		if (historicalCodeUnavailable.has(contract.address.toLowerCase())) {
			const candidateStart = contract.discoveryBlock ?? configuredStartBlock
			const fallbackStart = candidateStart > configuredStartBlock ? candidateStart : configuredStartBlock
			return { inputs: [{ address: contract.address, fromBlock, startBlock: fallbackStart }], observations: [] }
		}
		let deployment: { readonly block: bigint; readonly exact: boolean } | undefined
		try {
			const hasInexactDeployment = contract.deploymentBlock !== undefined && contract.deploymentBlockExact !== true
			const recordedSearchStart = hasInexactDeployment ? configuredStartBlock : (contract.deploymentCheckedBlock ?? configuredStartBlock)
			const searchStart = stateStartBlock > recordedSearchStart ? stateStartBlock : recordedSearchStart
			if (toBlock <= searchStart) return { inputs: [{ address: contract.address, fromBlock, startBlock: configuredStartBlock }], observations: [] }
			deployment = await findContractDeploymentBlock(
				searchStart,
				toBlock,
				(block) => codeAt(contract.address, block),
				!hasInexactDeployment && contract.deploymentCheckedBlock !== undefined && searchStart === recordedSearchStart,
			)
		} catch (error) {
			if (isPrunedHistoricalStateError(error)) throw error
			if (rpcQueueSaturationFrom(error) !== undefined || !isPermanentHistoricalCodeError(error)) throw error
			onDetectionFailure(contract, error)
			const candidateStart = contract.discoveryBlock ?? configuredStartBlock
			const fallbackStart = candidateStart > configuredStartBlock ? candidateStart : configuredStartBlock
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
		const coverageStart = deployment.exact && deployment.block > configuredStartBlock ? deployment.block : configuredStartBlock
		return {
			inputs: [
				{
					address: contract.address,
					fromBlock: coverageStart > fromBlock ? coverageStart : fromBlock,
					startBlock: coverageStart,
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
		const deployment = await findDeployment(address, configuredStartBlock, observedHead, false)
		return deployment === undefined ? undefined : deployment.exact ? deployment.block : configuredStartBlock
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
	const replayStart = await planManifestBackfill(
		manifestContracts,
		storedContracts,
		cursors,
		checkpoint,
		configuredStartBlock,
		findDeployment,
		storedStartBlock,
	)
	if (replayStart !== undefined) manifestReplayAncestor(replayStart, storedStartBlock)
	return true
}
