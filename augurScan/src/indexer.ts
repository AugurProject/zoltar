import { runtimeConfig } from './config.ts'
import {
	type AddressActivity,
	type ContractDeploymentObservation,
	DatabaseConsistencyError,
	databaseConsistencyDiagnosticMessage,
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
	type Transport,
	zeroAddress,
} from './ethereum.ts'
import { decodeAction, decodeLogRecord, discoveriesFrom, tokenAddressesFrom } from './metadata.ts'
import { unixSecondsToDate } from './time.ts'
import type { ContractMetadata, ManifestContract, NetworkConfig, StoredLog, TokenMetadata } from './types.ts'
import { uniswapV4PoolConfigurations, uniswapV4PoolId } from './uniswap.ts'

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
		.flatMap(({ address }) => uniswapV4PoolConfigurations.map(({ fee, tickSpacing }) => uniswapV4PoolId(address, fee, tickSpacing)))

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

const errorChainIncludes = (error: unknown, names: ReadonlySet<string>): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('name' in current && typeof current.name === 'string' && names.has(current.name)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

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

export const waitForIndexerDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		const finish = (): void => {
			clearTimeout(timeout)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		const timeout = setTimeout(finish, milliseconds)
		if (signal.aborted) finish()
		else signal.addEventListener('abort', finish, { once: true })
	})

export const findContractDeploymentBlock = async (
	startBlock: bigint,
	observedHead: bigint,
	codeAt: (block: bigint) => Promise<Hex | undefined>,
	startBlockKnownAbsent = false,
): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> => {
	const hasCode = async (block: bigint): Promise<boolean> => {
		const code = await codeAt(block)
		return code !== undefined && code !== '0x'
	}
	if (!(await hasCode(observedHead))) return undefined
	if (!startBlockKnownAbsent && (await hasCode(startBlock))) return { block: startBlock, exact: false }
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

type RpcRequestQueue = {
	readonly run: <T>(operation: () => Promise<T>) => Promise<T>
}

class RpcRequestMethodError extends Error {
	override name = 'RpcRequestMethodError'

	constructor(
		readonly method: string,
		cause: unknown,
	) {
		super('RPC method failed', { cause })
	}
}

type RpcQueueSaturation = {
	readonly active: number
	readonly pending: number
	readonly maximumPending: number
	readonly highWaterMark: number
	readonly saturationCount: number
}

export class RpcQueueSaturatedError extends Error {
	readonly active: number
	readonly pending: number
	readonly maximumPending: number
	readonly highWaterMark: number
	readonly saturationCount: number

	constructor(status: RpcQueueSaturation) {
		super('RPC queue reached its pending capacity')
		this.name = 'RpcQueueSaturatedError'
		this.active = status.active
		this.pending = status.pending
		this.maximumPending = status.maximumPending
		this.highWaterMark = status.highWaterMark
		this.saturationCount = status.saturationCount
	}
}

const rpcQueueSaturationFrom = (error: unknown): RpcQueueSaturatedError | undefined => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof RpcQueueSaturatedError) return current
		current = 'cause' in current ? current.cause : undefined
	}
	return undefined
}

export const createRpcRequestQueue = (concurrency: number, maximumPending = RPC_MAX_PENDING): RpcRequestQueue => {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('RPC concurrency must be a positive safe integer')
	if (!Number.isSafeInteger(maximumPending) || maximumPending < 0) throw new Error('RPC maximum pending count must be a non-negative safe integer')
	let active = 0
	let highWaterMark = 0
	let saturationCount = 0
	const pending: Array<() => void> = []
	const drain = (): void => {
		while (active < concurrency) {
			const start = pending.shift()
			if (start === undefined) return
			active++
			start()
		}
	}
	return {
		run: <T>(operation: () => Promise<T>) => {
			if (active >= concurrency && pending.length >= maximumPending) {
				saturationCount++
				return Promise.reject(new RpcQueueSaturatedError({ active, pending: pending.length, maximumPending, highWaterMark, saturationCount }))
			}
			return new Promise<T>((resolve, reject) => {
				pending.push(() => {
					void Promise.resolve()
						.then(operation)
						.then(resolve, reject)
						.finally(() => {
							active--
							drain()
						})
				})
				drain()
				highWaterMark = Math.max(highWaterMark, pending.length)
			})
		},
	}
}

export const withRpcRequestQueue = (transport: Transport, queue: RpcRequestQueue): Transport => ({
	...transport,
	requestScheduler: async <TValue>(method: string, operation: () => Promise<TValue>): Promise<TValue> => {
		try {
			return await queue.run(() => (transport.requestScheduler === undefined ? operation() : transport.requestScheduler(method, operation)))
		} catch (error) {
			throw new RpcRequestMethodError(method, error)
		}
	},
})

const rpcRequestQueue = createRpcRequestQueue(RPC_CONCURRENCY, RPC_MAX_PENDING)

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
): Promise<{ readonly block: bigint; readonly exact: boolean } | undefined> => {
	const readWithinBudget = deploymentReadBudget(timeoutMs, now)
	return await findContractDeploymentBlock(startBlock, checkpoint, (blockNumber) => readWithinBudget(() => codeAt(address, blockNumber)), startBlockKnownAbsent)
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
		const tracksFilteredHistory = contract.kind === 'reputationToken' || contract.kind === 'weth'
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
): Promise<DeploymentAwareLogPlan> => {
	const planned = await mapLimit(contracts, 4, async (contract): Promise<DeploymentAwareLogPlan> => {
		const knownStart = contract.deploymentBlock ?? contract.discoveryBlock
		if (knownStart !== undefined) {
			return {
				inputs: knownStart > toBlock ? [] : [{ address: contract.address, fromBlock: knownStart > fromBlock ? knownStart : fromBlock, startBlock: knownStart }],
				observations: [],
			}
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
	let blockCount = remaining < BigInt(maximumBlockCount) ? Number(remaining) : maximumBlockCount
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

const normalizedRpcDescription = (value: string): string =>
	[...value]
		.map((character) => {
			const codePoint = character.codePointAt(0)
			return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) ? ' ' : character
		})
		.join('')
		.replace(/\p{Cf}/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLowerCase()

const withoutAnsiControlSequences = (value: string): string => {
	const characters: string[] = []
	for (let index = 0; index < value.length; index++) {
		if (value.codePointAt(index) === 0x1b && value[index + 1] === '[') {
			index += 2
			while (index < value.length) {
				const codePoint = value.codePointAt(index)
				if (codePoint !== undefined && codePoint >= 0x40 && codePoint <= 0x7e) break
				index++
			}
			characters.push(' ')
		} else characters.push(value[index] ?? '')
	}
	return characters.join('')
}

const singleLineErrorDescription = (value: string): string =>
	[...withoutAnsiControlSequences(value)]
		.map((character) => {
			const codePoint = character.codePointAt(0)
			return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) ? ' ' : character
		})
		.join('')
		.replace(/\p{Cf}/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()

const classifiedRpcDescription = (value: string): string =>
	normalizedRpcDescription(value)
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()

type RpcDescriptionCategory = 'block-range' | 'rate-limit' | 'response-size' | 'result-limit' | 'timeout' | 'too-many-logs' | 'too-many-results'

const rpcDescriptionCategory = (value: string): RpcDescriptionCategory | undefined => {
	const description = classifiedRpcDescription(value)
	if (
		description.includes('rate limit') ||
		description.includes('too many requests') ||
		description.includes('request limit') ||
		description.includes('request rate') ||
		description.includes('request quota') ||
		description.includes('quota exceeded') ||
		/\bmore than\b.*\brequests?\b/u.test(description) ||
		/\brequests? per (?:second|minute|hour)\b/u.test(description)
	)
		return 'rate-limit'
	if (description.includes('too many logs') || /\bmore than\b.*\blogs\b/u.test(description)) return 'too-many-logs'
	if (description.includes('too many results') || /\bmore than\b.*\bresults\b/u.test(description)) return 'too-many-results'
	if (description.includes('response size') || description.includes('response too large') || description.includes('response body too large'))
		return 'response-size'
	if (
		description.includes('query timeout') ||
		description.includes('query timed out') ||
		description.includes('request timeout') ||
		description.includes('request timed out')
	)
		return 'timeout'
	if (description.includes('block range') || description.includes('too wide') || description.includes('please reduce')) return 'block-range'
	if (description.includes('limit exceeded') || /\bexceeds? (?:the )?maximum\b/u.test(description) || description.includes('more than')) return 'result-limit'
	return undefined
}

const preferredRpcDescriptions = (value: object): readonly string[] => {
	if ('details' in value && typeof value.details === 'string') return [value.details]
	if ('name' in value && (value.name === 'ResponseBodyTooLargeError' || value.name === 'TimeoutError')) return []
	if ('shortMessage' in value && typeof value.shortMessage === 'string') return [value.shortMessage]
	return 'message' in value && typeof value.message === 'string' ? [value.message] : []
}

const rpcErrorCategory = (error: unknown): RpcDescriptionCategory | undefined => {
	const seen = new Set<unknown>()
	let firstCategory: RpcDescriptionCategory | undefined
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('status' in current && current.status === 429) return 'rate-limit'
		for (const description of preferredRpcDescriptions(current)) {
			const category = rpcDescriptionCategory(description)
			if (category === 'rate-limit') return category
			firstCategory ??= category
		}
		if ('name' in current && current.name === 'ResponseBodyTooLargeError') firstCategory ??= 'response-size'
		if ('name' in current && current.name === 'TimeoutError') firstCategory ??= 'timeout'
		if ('code' in current && current.code === -32005) firstCategory ??= 'result-limit'
		current = 'cause' in current ? current.cause : undefined
	}
	return firstCategory
}

const isPermanentHistoricalCodeError = (error: unknown): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('code' in current && current.code === -32601) return true
		for (const description of preferredRpcDescriptions(current)) {
			const normalized = classifiedRpcDescription(description)
			if (
				normalized.includes('missing trie node') ||
				normalized.includes('archive unavailable') ||
				normalized.includes('archive data unavailable') ||
				normalized.includes('archival data unavailable') ||
				normalized.includes('archive node required') ||
				normalized.includes('requires an archive node') ||
				normalized.includes('requires archive node') ||
				normalized.includes('historical state unavailable') ||
				normalized.includes('historical state is unavailable') ||
				normalized.includes('historical state not available') ||
				normalized.includes('historical state is not available') ||
				normalized.includes('historical data unavailable') ||
				normalized.includes('historical data is unavailable') ||
				normalized.includes('historical data not available') ||
				normalized.includes('historical data is not available') ||
				normalized.includes('pruned historical state') ||
				normalized.includes('historical state pruned') ||
				normalized.includes('method not found') ||
				normalized.includes('method not supported') ||
				normalized.includes('unsupported method')
			)
				return true
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export const isSplittableLogRangeError = (error: unknown): boolean => {
	const category = rpcErrorCategory(error)
	return category !== undefined && category !== 'rate-limit'
}

const labelsFrom = (contracts: ReadonlyMap<string, ContractMetadata>): Map<string, string> =>
	new Map([['0x0000000000000000000000000000000000000000', 'Zero address'], ...[...contracts].map(([address, contract]) => [address, contract.label] as const)])

const jsonEvidence = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map(jsonEvidence)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonEvidence(item)]))
	return value
}

export const addressActivityFrom = (
	transactions: readonly StoredTransaction[],
	logs: readonly StoredLog[],
	contracts: ReadonlyMap<string, ContractMetadata>,
): readonly AddressActivity[] => {
	const result = new Map<string, AddressActivity>()
	for (const transaction of transactions) {
		const transactionLogs = logs.filter((log) => log.transactionHash === transaction.hash)
		const referencedAddresses = [...(transaction.decoded.referencedAddresses ?? []), ...transactionLogs.flatMap((log) => log.decoded.referencedAddresses ?? [])]
		const pools = new Set<Address>()
		if (transaction.to !== null && contracts.get(transaction.to.toLowerCase())?.kind === 'securityPool') pools.add(transaction.to)
		for (const log of transactionLogs) if (contracts.get(log.address.toLowerCase())?.kind === 'securityPool') pools.add(log.address)
		for (const candidate of referencedAddresses) {
			if (contracts.get(candidate.toLowerCase())?.kind === 'securityPool') pools.add(candidate)
		}
		const participants = new Map<string, { address: Address; role: 'sender' | 'referenced' }>()
		participants.set(transaction.from.toLowerCase(), { address: transaction.from, role: 'sender' })
		for (const candidate of referencedAddresses) {
			if (!participants.has(candidate.toLowerCase())) participants.set(candidate.toLowerCase(), { address: candidate, role: 'referenced' })
		}
		const associatedPools: readonly (Address | undefined)[] = pools.size === 0 ? [undefined] : [...pools]
		for (const participant of participants.values()) {
			for (const poolAddress of associatedPools) {
				const key = `${transaction.hash}:${participant.address.toLowerCase()}:${poolAddress?.toLowerCase() ?? zeroAddress}`
				result.set(key, {
					transactionHash: transaction.hash,
					address: participant.address,
					role: participant.role,
					...(poolAddress === undefined ? {} : { poolAddress }),
				})
			}
		}
	}
	return [...result.values()]
}

const requireLogPosition = (log: Log): { transactionHash: Hash; transactionIndex: number; logIndex: number; blockHash: Hash; blockNumber: bigint } => {
	if (
		log.transactionHash === undefined ||
		log.transactionIndex === undefined ||
		log.logIndex === undefined ||
		log.blockHash === undefined ||
		log.blockNumber === undefined
	) {
		throw new Error('RPC returned a pending log while indexing a confirmed block')
	}
	const transactionIndex = Number(log.transactionIndex)
	const logIndex = Number(log.logIndex)
	if (!Number.isSafeInteger(transactionIndex) || !Number.isSafeInteger(logIndex)) throw new Error('RPC returned a log position outside the safe integer range')
	return {
		transactionHash: log.transactionHash,
		transactionIndex,
		logIndex,
		blockHash: log.blockHash,
		blockNumber: log.blockNumber,
	}
}

class ChainContinuityError extends Error {}
class ChainConfigurationError extends Error {}
class LeaseLostError extends Error {}

export const queryCanonicalLogRange = async <T>(
	throughBlock: bigint,
	readEndBlockHash: () => Promise<Hash>,
	query: () => Promise<readonly T[]>,
): Promise<{ readonly items: readonly T[]; readonly endBlockHash: Hash }> => {
	const before = await readEndBlockHash()
	const items = await query()
	const after = await readEndBlockHash()
	if (before !== after) throw new ChainContinuityError(`Canonical chain changed while querying logs through block ${throughBlock}`)
	return { items, endBlockHash: after }
}

type ChainProvider = { readonly getChainId: () => Promise<number> }
type RpcProvider = ChainProvider & { readonly client: PublicClient; readonly endpoint: string; readonly number: number }

export const rpcEndpointLabel = (rpcUrl: string): string => {
	const url = new URL(rpcUrl)
	const hostnameParts = url.hostname.split('.')
	const isLocalOrIp = url.hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')
	const hostname = !isLocalOrIp && hostnameParts.length > 2 ? `*.${hostnameParts.slice(-2).join('.')}` : url.hostname
	return `${url.protocol}//${hostname}${url.port === '' ? '' : `:${url.port}`}`
}

export const rpcProviderLabel = (rpcUrl: string, index: number): string => `#${index + 1} ${rpcEndpointLabel(rpcUrl)}`

export const rpcFailureLogMessage = (message: string, endpoint: string, reason?: string): string =>
	`${message} (RPC: ${endpoint}${reason === undefined ? '' : `; reason: ${reason}`})`

export const withVerifiedProvider = async <TProvider extends ChainProvider, TResult>(
	providers: readonly TProvider[],
	chainId: number,
	operation: (provider: TProvider) => Promise<TResult>,
	stopFailover = (_error: unknown): boolean => false,
	onAttempt = (_provider: TProvider): void => {},
	verifiedProviders?: WeakSet<TProvider>,
): Promise<TResult> => {
	let lastFailure: unknown
	for (const provider of providers) {
		onAttempt(provider)
		try {
			if (verifiedProviders?.has(provider) !== true) {
				const remoteChainId = await provider.getChainId()
				if (remoteChainId !== chainId) throw new ChainConfigurationError(`RPC chain mismatch: configured ${chainId}, received ${remoteChainId}`)
				verifiedProviders?.add(provider)
			}
			return await operation(provider)
		} catch (error) {
			if (stopFailover(error)) throw error
			lastFailure = error
		}
	}
	throw lastFailure ?? new ChainConfigurationError('No RPC provider is available for the configured network')
}

export const confirmCanonicalBlock = async (number: bigint, expectedHash: Hash, lookup: (blockNumber: bigint) => Promise<Hash>): Promise<void> => {
	const observedHash = await lookup(number)
	if (observedHash !== expectedHash) throw new ChainContinuityError(`Block ${number} changed while it was being indexed`)
}

export const commitCanonicalRead = async <T>(
	number: bigint,
	expectedHash: Hash,
	read: () => Promise<T>,
	lookup: (blockNumber: bigint) => Promise<Hash>,
	commit: (value: T) => Promise<void>,
): Promise<void> => {
	const value = await read()
	await confirmCanonicalBlock(number, expectedHash, lookup)
	await commit(value)
}

const databaseFailureMessage = 'Database request failed; retrying'
const rpcQueueSaturatedMessage = 'RPC queue saturated; retrying'
const databaseFailureNames = new Set(['DatabaseConsistencyError', 'PostgresError'])
const leaseFailureNames = new Set([...databaseFailureNames, 'LeaseLostError'])

export const isLocalIndexerFailure = (error: unknown): boolean =>
	error instanceof LeaseLostError || rpcQueueSaturationFrom(error) !== undefined || errorChainIncludes(error, databaseFailureNames)

export const indexingCompletion = (configuredStartBlock: bigint, indexedBlock: bigint, observedHead: bigint) => {
	if (observedHead < configuredStartBlock) return { completedBlocks: 0n, percentage: '100.00', remainingBlocks: 0n, totalBlocks: 0n }
	const boundedHead = observedHead
	const totalBlocks = boundedHead - configuredStartBlock + 1n
	const boundedIndexed = indexedBlock < configuredStartBlock ? configuredStartBlock - 1n : indexedBlock > boundedHead ? boundedHead : indexedBlock
	const completedBlocks = boundedIndexed - configuredStartBlock + 1n
	const remainingBlocks = totalBlocks - completedBlocks
	const roundedHundredths = (completedBlocks * 10_000n + totalBlocks / 2n) / totalBlocks
	const hundredths = remainingBlocks > 0n && roundedHundredths >= 10_000n ? 9_999n : roundedHundredths
	return {
		completedBlocks,
		percentage: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`,
		remainingBlocks,
		totalBlocks,
	}
}

export const compactIndexerDuration = (seconds: number): string => {
	const rounded = Math.max(1, Math.ceil(seconds))
	if (rounded < 60) return `${rounded}s`
	if (rounded < 3_600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`
	const totalHours = Math.ceil(rounded / 3_600)
	if (totalHours < 24) {
		const totalMinutes = Math.ceil(rounded / 60)
		const minutes = totalMinutes % 60
		return `${Math.floor(totalMinutes / 60)}h${minutes === 0 ? '' : ` ${minutes}m`}`
	}
	const hours = totalHours % 24
	return `${Math.floor(totalHours / 24)}d${hours === 0 ? '' : ` ${hours}h`}`
}

export const indexerWaitingMessage = (networkId: string, configuredStartBlock: bigint, observedHead: bigint): string =>
	`[${networkId}] indexer state: live; observed head #${observedHead}; 100.00% complete; caught up; waiting for configured start block #${configuredStartBlock}`

export const indexerProgressMessage = (
	networkId: string,
	startBlock: bigint,
	endBlock: bigint,
	observedHead: bigint,
	configuredStartBlock: bigint,
	blocksPerSecond?: number,
): string => {
	const state = endBlock >= observedHead ? 'live' : 'backfilling'
	const indexed = startBlock === endBlock ? `indexed block #${endBlock}` : `indexed blocks #${startBlock}–#${endBlock}`
	const completion = indexingCompletion(configuredStartBlock, endBlock, observedHead)
	const progress =
		state === 'live'
			? 'caught up'
			: `${completion.remainingBlocks} blocks behind; ${blocksPerSecond === undefined ? 'estimating ETA' : `ETA ${compactIndexerDuration(Number(completion.remainingBlocks) / blocksPerSecond)}`}`
	return `[${networkId}] indexer state: ${state}; ${indexed}; observed head #${observedHead}; ${completion.percentage}% complete; ${progress}`
}

export const safeIndexerFailure = (error: unknown): string => {
	if (error instanceof ChainConfigurationError) return error.message
	if (error instanceof ChainContinuityError) return 'The remote canonical chain changed while indexing; retrying'
	if (rpcQueueSaturationFrom(error) !== undefined) return rpcQueueSaturatedMessage
	if (errorChainIncludes(error, databaseFailureNames)) return databaseFailureMessage
	return 'RPC request failed; retrying'
}

const safeErrorNames = new Set([
	'AbortError',
	'ChainConfigurationError',
	'ChainContinuityError',
	'ConnectTimeoutError',
	'ContractFunctionExecutionError',
	'ContractFunctionRevertedError',
	'DatabaseConsistencyError',
	'Error',
	'HeadersTimeoutError',
	'HttpRequestError',
	'IndexerOwnershipStageError',
	'LeaseLostError',
	'LimitExceededRpcError',
	'PostgresError',
	'ResponseBodyTooLargeError',
	'ResourceUnavailableRpcError',
	'RpcQueueSaturatedError',
	'RpcRequestError',
	'SocketError',
	'TimeoutError',
	'TypeError',
	'UnknownNodeError',
	'UnknownRpcError',
])

const safeErrorIdentifier = (value: unknown): string | undefined => (typeof value === 'string' && safeErrorNames.has(value) ? value : undefined)

const safeNamedErrorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'ERR_POSTGRES_CONNECTION_CLOSED'])

const safeErrorCode = (value: unknown): string | undefined => {
	if (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		(value === -32700 || (value >= -32603 && value <= -32600) || (value >= -32099 && value <= -32000))
	)
		return value.toString()
	return typeof value === 'string' && (/^HTTP_[1-5][0-9]{2}$/.test(value) || safeNamedErrorCodes.has(value)) ? value : undefined
}

const safeStandardRpcMessages = new Map([
	['parse error', 'Parse error'],
	['invalid request', 'Invalid Request'],
	['method not found', 'Method not found'],
	['invalid params', 'Invalid params'],
	['internal error', 'Internal error'],
])

const safeRpcCategoryMessages: Readonly<Record<RpcDescriptionCategory, string>> = {
	'block-range': 'provider rejected the requested block range',
	'rate-limit': 'provider rate limit exceeded',
	'response-size': 'provider response size limit exceeded',
	'result-limit': 'provider result limit exceeded',
	timeout: 'provider request timed out',
	'too-many-logs': 'provider returned too many logs',
	'too-many-results': 'provider returned too many results',
}

const safeStandardRpcProviderMessage = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined
	const normalized = normalizedRpcDescription(value)
	return safeStandardRpcMessages.get(normalized.replace(/[.!]$/u, ''))
}

const safeRpcRequestMethod = (value: unknown): string | undefined =>
	typeof value === 'string' && /^(?:eth|net|web3)_[A-Za-z0-9_]+$/u.test(value) ? value : undefined

const rpcRequestMethodFrom = (error: unknown): string | undefined => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		const method = current instanceof RpcRequestMethodError ? safeRpcRequestMethod(current.method) : undefined
		if (method !== undefined) return method
		current = 'cause' in current ? current.cause : undefined
	}
	return undefined
}

const indexerFailureReason = (error: unknown, includeErrorDescriptions: boolean): string => {
	const saturation = rpcQueueSaturationFrom(error)
	if (saturation !== undefined)
		return `RpcQueueSaturatedError; active ${saturation.active}; queued ${saturation.pending}; maximum queued ${saturation.maximumPending}; high-water mark ${saturation.highWaterMark}; saturation count ${saturation.saturationCount}`
	const names: string[] = []
	const descriptions: string[] = []
	let status: number | undefined
	let code: string | undefined
	let standardMessage: string | undefined
	let previousDescriptionName: string | undefined
	let previousDescriptionMessage: string | undefined
	const seen = new Set<unknown>()
	let current: unknown = error
	while (current !== undefined && !seen.has(current)) {
		seen.add(current)
		if (typeof current !== 'object' || current === null) {
			descriptions.push(`UnknownError: ${singleLineErrorDescription(String(current))}`)
			break
		}
		const actualName = 'name' in current && typeof current.name === 'string' ? singleLineErrorDescription(current.name) || undefined : undefined
		const name = safeErrorIdentifier(actualName)
		if (name !== undefined && names.at(-1) !== name) names.push(name)
		const actualMessage =
			singleLineErrorDescription(
				preferredRpcDescriptions(current)
					.find((value) => value.trim() !== '')
					?.trim() ?? '',
			) || undefined
		if (actualName !== undefined || actualMessage !== undefined) {
			if (actualMessage !== undefined && actualMessage === previousDescriptionMessage) {
				if (actualName !== undefined && actualName !== previousDescriptionName) descriptions.push(actualName)
			} else {
				const descriptionName = actualName ?? 'UnknownError'
				descriptions.push(actualMessage === undefined ? descriptionName : `${descriptionName}: ${actualMessage}`)
			}
			previousDescriptionName = actualName
			previousDescriptionMessage = actualMessage
		}
		if (
			status === undefined &&
			'status' in current &&
			typeof current.status === 'number' &&
			Number.isInteger(current.status) &&
			current.status >= 100 &&
			current.status <= 599
		)
			status = current.status
		if (code === undefined && 'code' in current) code = safeErrorCode(current.code)
		if (standardMessage === undefined && name === 'RpcRequestError' && 'details' in current) standardMessage = safeStandardRpcProviderMessage(current.details)
		current = 'cause' in current ? current.cause : undefined
	}
	const category = rpcErrorCategory(error)
	const message = category === undefined ? standardMessage : safeRpcCategoryMessages[category]
	const fallbackDescription = descriptions.length === 0 ? 'UnknownError' : descriptions.slice(0, 4).join(' caused by ')
	const details = [
		includeErrorDescriptions && message === undefined ? fallbackDescription : names.length === 0 ? 'UnknownError' : names.slice(0, 4).join(' caused by '),
	]
	const method = rpcRequestMethodFrom(error)
	if (method !== undefined) details.push(`method ${method}`)
	if (status !== undefined) details.push(`HTTP ${status}`)
	if (code !== undefined) details.push(`code ${code}`)
	if (message !== undefined) details.push(`message: ${message}`)
	return details.join('; ')
}

export const safeIndexerFailureReason = (error: unknown): string => indexerFailureReason(error, false)

export const rpcIndexerFailureReason = (error: unknown): string => indexerFailureReason(error, true)

const rpcFailureReason = (error: unknown, rpcNumber: number): string => `RPC #${rpcNumber}: ${rpcIndexerFailureReason(error)}`

type RpcDiagnosticProvider = Pick<RpcProvider, 'endpoint' | 'number'>

export const createRpcDiagnosticContext = (initialProvider: RpcDiagnosticProvider) => {
	let activeProvider = initialProvider
	return {
		activeEndpoint: (): string => activeProvider.endpoint,
		activeNumber: (): number => activeProvider.number,
		failureReason: (error: unknown): string => rpcFailureReason(error, activeProvider.number),
		select: (provider: RpcDiagnosticProvider): void => {
			activeProvider = provider
		},
	}
}

export const indexerOperationFailureReason = (error: unknown, rpcNumber: number, source: 'rpc' | 'storage'): string =>
	source === 'rpc' ? rpcFailureReason(error, rpcNumber) : safeIndexerFailureReason(error)

const deploymentReadTimeoutError = (): Error => {
	const error = new Error('Contract deployment history read timed out')
	error.name = 'TimeoutError'
	return error
}

export const boundedDeploymentRead = async <T>(read: () => Promise<T>, timeoutMs: number): Promise<T> =>
	await new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(deploymentReadTimeoutError())
		}, timeoutMs)
		void read()
			.then(resolve, reject)
			.finally(() => clearTimeout(timeout))
	})

export const deploymentReadBudget = (timeoutMs = 5_000, now = Date.now): (<T>(read: () => Promise<T>) => Promise<T>) => {
	const deadline = now() + timeoutMs
	return async <T>(read: () => Promise<T>): Promise<T> => {
		const remaining = deadline - now()
		if (remaining <= 0) throw deploymentReadTimeoutError()
		const value = await boundedDeploymentRead(read, remaining)
		if (now() > deadline) throw deploymentReadTimeoutError()
		return value
	}
}

export const contractDeploymentScanDue = (lastCompletedAt: number | undefined, now: number, cooldownMs = 60_000): boolean =>
	lastCompletedAt === undefined || now - lastCompletedAt >= cooldownMs

type NetworkLifecycle = {
	readonly verify: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly failure: (message: string, nextRetryAt: Date, reason: string) => Promise<void>
	readonly intervalMs: number
	readonly signal: AbortSignal
	readonly random?: () => number
	readonly shouldRethrow?: (error: unknown) => boolean
}

export class IndexerOwnershipStageError extends Error {
	override name = 'IndexerOwnershipStageError'

	constructor(
		readonly stage: OwnershipStage,
		cause: unknown,
	) {
		super(`Indexer ownership stage failed: ${stage}`, { cause })
	}
}

export const retryDelayMs = (consecutiveFailures: number, intervalMs: number, random = Math.random): number => {
	const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 8)
	const base = Math.min(intervalMs * 2 ** exponent, 300_000)
	return Math.min(Math.round(base * (0.8 + random() * 0.4)), 300_000)
}

export const runNetworkLifecycle = async ({ verify, poll, failure, intervalMs, signal, random, shouldRethrow }: NetworkLifecycle): Promise<void> => {
	let verified = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		const startedAt = Date.now()
		let caughtUp = true
		let delayAfterFailure: number | undefined
		try {
			if (!verified) {
				await verify()
				verified = true
			}
			caughtUp = await poll()
			consecutiveFailures = 0
		} catch (error) {
			if (error instanceof LeaseLostError || shouldRethrow?.(error) === true) throw error
			consecutiveFailures++
			delayAfterFailure = retryDelayMs(consecutiveFailures, intervalMs, random)
			try {
				const failureMessage = safeIndexerFailure(error)
				const failureReason = failureMessage === 'RPC request failed; retrying' ? rpcIndexerFailureReason(error) : safeIndexerFailureReason(error)
				await failure(failureMessage, new Date(Date.now() + delayAfterFailure), failureReason)
			} catch (failureError) {
				throw new IndexerOwnershipStageError('record-failure', failureError)
			}
		}
		await waitForIndexerDelay(delayAfterFailure ?? (caughtUp ? Math.max(0, intervalMs - (Date.now() - startedAt)) : 0), signal)
	}
}

type OwnedNetworkLifecycle = Omit<NetworkLifecycle, 'verify' | 'poll'> & {
	readonly reconcile: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly runWithProvider: <T>(operation: () => Promise<T>) => Promise<T>
}

export const runOwnedNetworkLifecycle = async ({ reconcile, poll, runWithProvider, ...lifecycle }: OwnedNetworkLifecycle): Promise<void> =>
	await runNetworkLifecycle({
		...lifecycle,
		verify: () => runWithProvider(reconcile),
		poll: () => runWithProvider(poll),
		shouldRethrow: (error) => error instanceof DatabaseConsistencyError || lifecycle.shouldRethrow?.(error) === true,
	})

type LeaseControl = Pick<IndexerLease, 'assertHeld' | 'release'> & { readonly backendPid?: number }

type OwnershipStage = 'acquire' | 'verify' | 'seed' | 'owned-run' | 'record-failure' | 'release'

export type IndexerOwnershipEvent =
	| {
			readonly type: 'failure'
			readonly stage: OwnershipStage
			readonly consecutiveFailures: number
			readonly retryDelayMs: number
			readonly backendPid?: number
	  }
	| { readonly type: 'acquired'; readonly backendPid?: number; readonly recoveredAfterFailures: number; readonly acquiredAfterStandby: boolean }
	| { readonly type: 'released'; readonly backendPid?: number }
	| { readonly type: 'standby' }

export type IndexerOwnershipStatus = {
	readonly networkId: string
	readonly active: boolean
	readonly backendPid?: number
	readonly failuresTotal: number
	readonly reacquisitionsTotal: number
	readonly consecutiveFailures: number
	readonly lastFailureAt?: string
	readonly lastFailureStage?: OwnershipStage
}

const ownershipStatuses = new Map<string, IndexerOwnershipStatus>()

export const nextIndexerOwnershipStatus = (
	networkId: string,
	current: IndexerOwnershipStatus | undefined,
	event: IndexerOwnershipEvent,
	now = new Date(),
): IndexerOwnershipStatus => {
	const previous = current ?? {
		networkId,
		active: false,
		failuresTotal: 0,
		reacquisitionsTotal: 0,
		consecutiveFailures: 0,
	}
	if (event.type === 'failure') {
		return {
			...previous,
			active: false,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			failuresTotal: previous.failuresTotal + 1,
			consecutiveFailures: event.consecutiveFailures,
			lastFailureAt: now.toISOString(),
			lastFailureStage: event.stage,
		}
	}
	if (event.type === 'acquired') {
		return {
			...previous,
			active: true,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			reacquisitionsTotal: previous.reacquisitionsTotal + (event.recoveredAfterFailures > 0 || event.acquiredAfterStandby ? 1 : 0),
			consecutiveFailures: 0,
		}
	}
	return {
		...previous,
		active: false,
		backendPid: undefined,
		consecutiveFailures: event.type === 'standby' ? 0 : previous.consecutiveFailures,
	}
}

const recordOwnershipEvent = (networkId: string, event: IndexerOwnershipEvent): void => {
	ownershipStatuses.set(networkId, nextIndexerOwnershipStatus(networkId, ownershipStatuses.get(networkId), event))
}

export const indexerOwnershipStatuses = (): readonly IndexerOwnershipStatus[] =>
	[...ownershipStatuses.values()].sort((left, right) => left.networkId.localeCompare(right.networkId))

const ownershipFailureReason = (error: unknown): string => {
	const reason = safeIndexerFailureReason(error)
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof DatabaseConsistencyError) {
			const detail = databaseConsistencyDiagnosticMessage(current)
			if (detail !== undefined) return `${reason}: ${detail}`
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return reason
}

export const ownershipFailureLogMessage = (
	networkId: string,
	stage: OwnershipStage,
	error: unknown,
	consecutiveFailures: number,
	retryDelay: number,
	backendPid?: number,
): string =>
	`[${networkId}] indexer ownership failed; stage: ${stage}; consecutive failures: ${consecutiveFailures}; retry delay: ${retryDelay}ms; backend PID: ${backendPid ?? 'unavailable'}; reason: ${ownershipFailureReason(error)}`

type OwnershipLifecycle<TLease extends LeaseControl> = {
	readonly networkId: string
	readonly acquire: () => Promise<TLease | undefined>
	readonly seed: (lease: TLease) => Promise<void>
	readonly runOwned: (lease: TLease) => Promise<void>
	readonly failure: (message: string, lease: TLease | undefined) => Promise<void>
	readonly standby: () => void
	readonly intervalMs: number
	readonly now?: () => number
	readonly onEvent?: (event: IndexerOwnershipEvent) => void
	readonly random?: () => number
	readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
	readonly signal: AbortSignal
}

export const runIndexerOwnershipLifecycle = async <TLease extends LeaseControl>({
	networkId,
	acquire,
	seed,
	runOwned,
	failure,
	standby,
	intervalMs,
	now = Date.now,
	onEvent = () => {},
	random,
	wait = waitForIndexerDelay,
	signal,
}: OwnershipLifecycle<TLease>): Promise<void> => {
	let standbyReported = false
	let wasStandby = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		let lease: TLease | undefined
		let ownedRunStartedAt: number | undefined
		let stage: OwnershipStage = 'acquire'
		let retryDelay: number | undefined
		try {
			lease = await acquire()
			if (lease === undefined) {
				consecutiveFailures = 0
				wasStandby = true
				if (!standbyReported) {
					standby()
					onEvent({ type: 'standby' })
					standbyReported = true
				}
			} else {
				standbyReported = false
				stage = 'verify'
				await lease.assertHeld()
				stage = 'seed'
				await seed(lease)
				const recoveredAfterFailures = consecutiveFailures
				const acquiredAfterStandby = wasStandby
				onEvent({
					type: 'acquired',
					...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					recoveredAfterFailures,
					acquiredAfterStandby,
				})
				if (recoveredAfterFailures > 0 || acquiredAfterStandby) {
					const source = acquiredAfterStandby ? (recoveredAfterFailures > 0 ? 'standby and failures' : 'standby') : 'failures'
					console.info(
						`[${networkId}] indexer ownership reacquired; backend PID: ${lease.backendPid ?? 'unavailable'}; source: ${source}; previous consecutive failures: ${recoveredAfterFailures}`,
					)
				}
				wasStandby = false
				stage = 'owned-run'
				ownedRunStartedAt = now()
				await runOwned(lease)
				consecutiveFailures = 0
			}
		} catch (error) {
			const failureStage = error instanceof IndexerOwnershipStageError ? error.stage : stage
			if (failureStage === 'owned-run' && ownedRunStartedAt !== undefined && now() - ownedRunStartedAt >= Math.max(intervalMs * 4, 60_000))
				consecutiveFailures = 0
			consecutiveFailures++
			retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
			onEvent({
				type: 'failure',
				stage: failureStage,
				consecutiveFailures,
				retryDelayMs: retryDelay,
				...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
			})
			console.error(ownershipFailureLogMessage(networkId, failureStage, error, consecutiveFailures, retryDelay, lease?.backendPid))
			try {
				await failure(databaseFailureMessage, lease)
			} catch (error) {
				console.error(ownershipFailureLogMessage(networkId, 'record-failure', error, consecutiveFailures, retryDelay, lease?.backendPid))
				// A database outage can prevent status recording too; retry ownership regardless.
			}
		} finally {
			try {
				await lease?.release()
			} catch (error) {
				if (retryDelay === undefined) {
					consecutiveFailures++
					retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
					onEvent({
						type: 'failure',
						stage: 'release',
						consecutiveFailures,
						retryDelayMs: retryDelay,
						...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					})
				}
				console.error(ownershipFailureLogMessage(networkId, 'release', error, consecutiveFailures, retryDelay, lease?.backendPid))
				// PostgreSQL already releases advisory locks when their session is lost.
			}
			if (lease !== undefined) onEvent({ type: 'released', ...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }) })
		}
		if (!signal.aborted) await wait(retryDelay ?? intervalMs, signal)
	}
}

export const isProtocolActivitySource = (contract: ContractMetadata | undefined): boolean =>
	contract !== undefined &&
	contract.kind !== 'weth' &&
	contract.kind !== 'reputationToken' &&
	contract.kind !== 'multicall3' &&
	contract.kind !== 'proxyDeployer' &&
	contract.kind !== 'scalarOutcomes'

export const requiresManifestHistoryCoverage = (contract: ContractMetadata | undefined): boolean =>
	isProtocolActivitySource(contract) || contract?.kind === 'reputationToken' || contract?.kind === 'weth'

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

export const isProtocolEvidenceEmitter = (contract: ContractMetadata | undefined): contract is ContractMetadata => contract !== undefined

const requireReceiptPosition = (receipt: TransactionReceipt, blockHash: Hash, blockNumber: bigint): void => {
	if (receipt.blockHash !== blockHash || receipt.blockNumber !== blockNumber) {
		throw new ChainContinuityError(`Receipt ${receipt.transactionHash} no longer belongs to block ${blockNumber}`)
	}
	for (const log of receipt.logs) {
		const position = requireLogPosition(log)
		if (position.blockHash !== blockHash || position.blockNumber !== blockNumber) {
			throw new ChainContinuityError(`Log ${position.transactionHash}:${position.logIndex} no longer belongs to block ${blockNumber}`)
		}
	}
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
	readonly #signal: AbortSignal
	#lease: IndexerLease | undefined

	constructor(network: NetworkConfig, database: ScannerDatabase, signal: AbortSignal) {
		this.#network = network
		this.#configuredStartBlock = network.startBlock
		this.#database = database
		this.#signal = signal
		this.#providers = network.rpcUrls.map((rpcUrl, index) => {
			const transport = http(rpcUrl, { requestTimeout: 20_000, retryCount: 2 })
			const client = createPublicClient({ transport: withRpcRequestQueue(transport, rpcRequestQueue) })
			return { client, endpoint: rpcProviderLabel(rpcUrl, index), getChainId: () => client.getChainId(), number: index + 1 }
		})
		const firstProvider = this.#providers[0]
		if (firstProvider === undefined) throw new ChainConfigurationError('At least one RPC provider is required')
		this.#client = firstProvider.client
		this.#rpcDiagnostics = createRpcDiagnosticContext(firstProvider)
	}

	async #getBlockHeader(blockNumber: bigint): Promise<RpcBlockHeader> {
		return requireRpcBlockHeader(await this.#client.getBlock({ blockNumber }), blockNumber)
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
					findManifestContractDeployment(address, searchStart, indexedBoundary, startBlockKnownAbsent, (candidate, blockNumber) =>
						this.#client.getBytecode({ address: candidate, blockNumber }),
					),
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
					findManifestContractDeployment(address, searchStart, indexedBoundary, startBlockKnownAbsent, (candidate, blockNumber) =>
						this.#client.getBytecode({ address: candidate, blockNumber }),
					),
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
			const observedRate = Number(endBlock - previousSample.block) / ((now - previousSample.sampledAt) / 1_000)
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
				findManifestContractDeployment(address, startBlock, indexedBoundary, startBlockKnownAbsent, (candidate, blockNumber) =>
					this.#client.getBytecode({ address: candidate, blockNumber }),
				),
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
				candidate = await this.#database.contractDeploymentCandidate(this.#network.chainId, indexedBoundary, this.#requireLease())
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
				const deployment = await findContractDeploymentBlock(this.#network.startBlock, indexedBoundary, (blockNumber) =>
					readWithinBudget(() => this.#client.getBytecode({ address: candidate.address, blockNumber })),
				)
				resolved =
					deployment === undefined
						? undefined
						: {
								...deployment,
								timestamp: new Date(Number((await readWithinBudget(() => this.#getBlockHeader(deployment.block))).timestamp) * 1_000),
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
			if (checkpoint !== undefined) await this.#refreshRichListBalances(checkpoint.number, checkpoint.hash)
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
		const initialContracts = [...contracts.values()].filter(isProtocolActivitySource)
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
			const blockNumbers = Array.from({ length: Number(segment.toBlock - nextBlock + 1n) }, (_, index) => nextBlock + BigInt(index))
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
			const header = headers[Number(nextBlock - batchStart)]
			if (header === undefined) throw new Error(`RPC did not return block ${nextBlock}`)
			const contractsBeforeBlock = new Set(contracts.keys())
			let indexed: { block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }
			try {
				indexed = await this.#indexBlock(nextBlock, observedHead, contracts, tokenMetadata, expectedParentHash, header, logsByBlock.get(nextBlock) ?? [])
			} catch (error) {
				if (error instanceof ChainContinuityError) {
					await this.#reconcileReorg()
					return false
				}
				throw error
			}
			const newlyDiscoveredActivityAddresses = [...indexed.contracts]
				.filter(([address, contract]) => !contractsBeforeBlock.has(address) && isProtocolActivitySource(contract))
				.map(([, contract]) => contract.address)
			const discoveredRep = [...indexed.contracts].some(([address, contract]) => !contractsBeforeBlock.has(address) && contract.kind === 'reputationToken')
			const additionalAddresses = [
				...newlyDiscoveredActivityAddresses,
				...(discoveredRep
					? [...indexed.contracts.values()]
							.filter(({ kind }) => kind === 'uniswapV2Factory' || kind === 'uniswapV3Factory' || kind === 'uniswapV4PoolManager')
							.map(({ address }) => address)
					: []),
			]
			if (additionalAddresses.length > 0 && nextBlock < end) {
				try {
					this.#mergeLogs(
						logsByBlock,
						await this.#getAllLogs(nextBlock + 1n, end, additionalAddresses, indexed.contracts, (blockNumber) => {
							const expected = headers[Number(blockNumber - batchStart)]
							if (expected === undefined) throw new Error(`RPC did not return block ${blockNumber}`)
							return expected.hash
						}),
					)
				} catch (error) {
					if (error instanceof ChainContinuityError) return false
					throw error
				}
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
		const repTokens = [...contracts.values()].filter(({ kind }) => kind === 'reputationToken').map(({ address }) => address)
		const wethTokens = [...contracts.values()].filter(({ kind }) => kind === 'weth').map(({ address }) => address)
		const tokenPairs = repTokens.flatMap((rep) =>
			wethTokens.flatMap((weth) => [
				{ token0: rep, token1: weth },
				{ token0: weth, token1: rep },
			]),
		)
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
							async (blockNumber) => new Date(Number((await this.#getBlockHeader(blockNumber)).timestamp) * 1_000),
							(contract, error) =>
								console.warn(
									`[${this.#network.id}] deployment-aware log scan fell back for ${contract.label} (${contract.address}): ${this.#rpcFailureReason(error)}`,
								),
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
				const transactionIndex = Number(transaction.transactionIndex)
				if (!Number.isSafeInteger(transactionIndex)) throw new Error(`Transaction ${transaction.hash} index exceeds the safe integer range`)
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
			const activityAddresses = discoveredAddresses.filter((address) => isProtocolActivitySource(contracts.get(address.toLowerCase())))
			const discoveredRep = discoveredAddresses.some((address) => contracts.get(address.toLowerCase())?.kind === 'reputationToken')
			const queryAddresses = [
				...activityAddresses,
				...(discoveredRep
					? [...contracts.values()]
							.filter(({ kind }) => kind === 'uniswapV2Factory' || kind === 'uniswapV3Factory' || kind === 'uniswapV4PoolManager')
							.map(({ address }) => address)
					: []),
			]
			for (const log of queryAddresses.length === 0 ? [] : await this.#getKnownLogs(number, queryAddresses, contracts, block.hash)) {
				relevantHashes.add(requireLogPosition(log).transactionHash)
			}
			await fetchMissingEvidence()
		}

		const labels = labelsFrom(contracts)
		const tokenMetadata = new Map(currentTokenMetadata)
		const tokenCandidates = new Set<Address>()
		for (const metadata of tokenMetadata.values()) if (metadata.decimals === undefined) tokenCandidates.add(metadata.address)
		for (const contract of contracts.values()) {
			if (contract.kind === 'reputationToken' || contract.kind === 'shareToken' || contract.kind === 'weth') tokenCandidates.add(contract.address)
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
