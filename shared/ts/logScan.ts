export type LogRange = Readonly<{ fromBlock: bigint; toBlock: bigint }>

export type CanonicalBlockAnchor = Readonly<{ blockHash: string; blockNumber: bigint }>

export function encodedLogByteLength(log: Readonly<{ data: string; topics: readonly string[] }>) {
	const encodedByteLength = (value: string) => (value.startsWith('0x') ? value.length - 2 : value.length) / 2
	return encodedByteLength(log.data) + log.topics.reduce((total, topic) => total + encodedByteLength(topic), 0)
}

export type CanonicalLogIndex<Log> = {
	anchor: CanonicalBlockAnchor | undefined
	items: Log[]
	key: string | undefined
	pending: Promise<void> | undefined
}

export function createCanonicalLogIndex<Log>(): CanonicalLogIndex<Log> {
	return { anchor: undefined, items: [], key: undefined, pending: undefined }
}

export function requiredCanonicalBlockAnchor(block: Readonly<{ hash?: string | undefined; number?: bigint | undefined }>): CanonicalBlockAnchor {
	if (block.hash === undefined || block.number === undefined) throw new Error('Canonical log scan requires a mined block identity')
	return { blockHash: block.hash, blockNumber: block.number }
}

function resetCanonicalLogIndex<Log>(index: CanonicalLogIndex<Log>, key: string) {
	index.anchor = undefined
	index.items = []
	index.key = key
}

export class LogScanError extends Error {
	readonly logRange: LogRange

	constructor(logRange: LogRange, options: { cause?: unknown }) {
		let causeMessage: string | undefined
		if (options.cause instanceof Error) causeMessage = options.cause.message
		else if (typeof options.cause === 'string') causeMessage = options.cause
		super(`Log scan failed for blocks ${logRange.fromBlock.toString()} through ${logRange.toBlock.toString()}${causeMessage === undefined ? '' : `: ${causeMessage}`}`, options)
		this.name = 'LogScanError'
		this.logRange = logRange
	}
}

function walkErrorCauses(error: unknown, visit: (current: object) => boolean) {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (visit(current)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export function logRangeLimitError(error: unknown) {
	return walkErrorCauses(error, current => {
		if (!('message' in current) || typeof current.message !== 'string') return false
		const message = current.message.toLowerCase()
		if (message.includes('fromblock exceeds toblock')) return false
		if (message.includes('http 413') || message.includes('range is too large')) return true
		if (message.includes('response exceeds') || message.includes('response too large')) return true
		const mentionsRangeCap = message.includes('range') || message.includes('blocks') || message.includes('results') || message.includes('response size')
		const mentionsExceeding = message.includes('limit') || message.includes('too many') || message.includes('exceed') || message.includes('too large') || message.includes('maximum') || message.includes('up to') || message.includes('more than')
		return mentionsRangeCap && mentionsExceeding
	})
}

export async function fetchLogsWithAdaptiveRanges<Log>(
	fromBlock: bigint,
	toBlock: bigint,
	maximumRange: bigint,
	fetchRange: (logRange: LogRange) => Promise<readonly Log[]>,
	maximumItems = Number.MAX_SAFE_INTEGER,
	maximumBytes = Number.MAX_SAFE_INTEGER,
	measureItem: (item: Log) => number = () => 0,
	validateItem?: (item: Log) => void,
): Promise<Log[]> {
	if (maximumRange < 1n) throw new Error('maximumRange must be positive')
	if (!Number.isSafeInteger(maximumItems) || maximumItems < 0) throw new Error('maximumItems must be a non-negative safe integer')
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error('maximumBytes must be a non-negative safe integer')
	const logs: Log[] = []
	let retainedBytes = 0
	let nextBlock = fromBlock
	let requestedBlocks = maximumRange
	while (nextBlock <= toBlock) {
		const remaining = toBlock - nextBlock + 1n
		const attemptedBlocks = requestedBlocks < remaining ? requestedBlocks : remaining
		const range = { fromBlock: nextBlock, toBlock: nextBlock + attemptedBlocks - 1n }
		try {
			const page = await fetchRange(range)
			const pageBytes = page.reduce((total, item) => {
				const itemBytes = measureItem(item)
				if (!Number.isSafeInteger(itemBytes) || itemBytes < 0) throw new Error('Canonical log item size must be a non-negative safe integer')
				return total + itemBytes
			}, 0)
			if (page.length > maximumItems - logs.length || pageBytes > maximumBytes - retainedBytes) {
				if (attemptedBlocks > 1n) {
					requestedBlocks = (attemptedBlocks + 1n) / 2n
					continue
				}
				if (page.length > maximumItems - logs.length) throw new Error(`Canonical log history exceeds the configured ${maximumItems.toString()}-item limit`)
				throw new Error(`Canonical log history exceeds the configured ${maximumBytes.toString()}-byte limit`)
			}
			for (const item of page) validateItem?.(item)
			logs.push(...page)
			retainedBytes += pageBytes
			nextBlock = range.toBlock + 1n
			requestedBlocks = maximumRange
		} catch (error) {
			if (attemptedBlocks > 1n && logRangeLimitError(error)) {
				requestedBlocks = (attemptedBlocks + 1n) / 2n
				continue
			}
			throw new LogScanError(range, { cause: error })
		}
	}
	return logs
}

export async function refreshCanonicalLogIndex<Log>(
	index: CanonicalLogIndex<Log>,
	parameters: Readonly<
		{
			fetchRange: (logRange: LogRange) => Promise<readonly Log[]>
			key: string
			loadBlockAnchor: (blockNumber?: bigint) => Promise<CanonicalBlockAnchor>
			maximumRange: bigint
			maximumItems: number
			maximumBytes?: number
			measureItem?: (item: Log) => number
			validateItem?: (item: Log) => void
		} & ({ loadStartBlock: (toBlock: bigint) => Promise<bigint | undefined>; startBlock?: never } | { loadStartBlock?: never; startBlock: bigint })
	>,
): Promise<Log[]> {
	const previous = index.pending
	let snapshot: Log[] = []
	const refresh = (async () => {
		if (previous !== undefined) await previous.catch(() => undefined)
		if (index.key !== parameters.key) resetCanonicalLogIndex(index, parameters.key)
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const latest = await parameters.loadBlockAnchor()
			let startBlock: bigint | undefined
			if (parameters.loadStartBlock === undefined) startBlock = parameters.startBlock
			else if (index.anchor === undefined) startBlock = await parameters.loadStartBlock(latest.blockNumber)
			if (index.anchor === undefined && startBlock === undefined) {
				index.items = []
				snapshot = []
				return
			}
			const effectiveStartBlock = startBlock ?? index.anchor?.blockNumber ?? latest.blockNumber
			if (latest.blockNumber < effectiveStartBlock) {
				if (index.anchor !== undefined) {
					resetCanonicalLogIndex(index, parameters.key)
					continue
				}
				index.anchor = undefined
				index.items = []
				snapshot = []
				return
			}
			const currentAnchor = index.anchor
			if (currentAnchor !== undefined) {
				const currentCanonical = latest.blockNumber >= currentAnchor.blockNumber && (latest.blockNumber === currentAnchor.blockNumber ? latest.blockHash === currentAnchor.blockHash : (await parameters.loadBlockAnchor(currentAnchor.blockNumber)).blockHash === currentAnchor.blockHash)
				if (!currentCanonical) {
					resetCanonicalLogIndex(index, parameters.key)
					continue
				}
				if (latest.blockNumber === currentAnchor.blockNumber) {
					snapshot = index.items.slice()
					return
				}
			}
			const fromBlock = index.anchor === undefined ? effectiveStartBlock : index.anchor.blockNumber + 1n
			const measureItem = parameters.measureItem
			const retainedBytes = measureItem === undefined ? 0 : index.items.reduce((total, item) => total + measureItem(item), 0)
			const appended =
				fromBlock > latest.blockNumber
					? []
					: await fetchLogsWithAdaptiveRanges(fromBlock, latest.blockNumber, parameters.maximumRange, parameters.fetchRange, parameters.maximumItems - index.items.length, (parameters.maximumBytes ?? Number.MAX_SAFE_INTEGER) - retainedBytes, parameters.measureItem, parameters.validateItem)
			const latestAfterFetch = await parameters.loadBlockAnchor(latest.blockNumber)
			const currentAfterFetch = currentAnchor === undefined ? undefined : await parameters.loadBlockAnchor(currentAnchor.blockNumber)
			if (latestAfterFetch.blockHash !== latest.blockHash || (currentAnchor !== undefined && currentAfterFetch?.blockHash !== currentAnchor.blockHash)) {
				resetCanonicalLogIndex(index, parameters.key)
				continue
			}
			index.items = [...index.items, ...appended]
			index.anchor = latest
			snapshot = index.items.slice()
			return
		}
		throw new Error('Canonical log index changed repeatedly during refresh')
	})()
	index.pending = refresh
	try {
		await refresh
	} finally {
		if (index.pending === refresh) index.pending = undefined
	}
	return snapshot
}

export function createCanonicalLogLoader<Owner extends object, Key extends string, Log>(
	parameters: Readonly<
		{
			fetchRange: (owner: Owner, key: Key, logRange: LogRange) => Promise<readonly Log[]>
			loadBlockAnchor: (owner: Owner, blockNumber?: bigint) => Promise<CanonicalBlockAnchor>
			loadCacheIdentity?: (owner: Owner) => Promise<string | undefined>
			maximumRange: bigint
			maximumItems: number
			maximumBytes?: number
			measureItem?: (item: Log) => number
			validateItem?: (item: Log) => void
		} & ({ loadStartBlock: (owner: Owner, key: Key, toBlock?: bigint) => Promise<bigint | undefined>; startBlock?: never } | { loadStartBlock?: never; startBlock: bigint })
	>,
) {
	// Genesis identity is stable across recreated RPC clients for the same chain
	// while keeping unrelated chains and local test backends isolated.
	const indexes = new Map<string, CanonicalLogIndex<Log>>()
	const fallbackIndexes = new WeakMap<Owner, Map<Key, CanonicalLogIndex<Log>>>()
	return async (owner: Owner, key: Key, toBlock?: bigint) => {
		let indexKey: string = key
		let index: CanonicalLogIndex<Log> | undefined
		const cacheIdentity = await parameters.loadCacheIdentity?.(owner)
		if (cacheIdentity !== undefined) {
			indexKey = `${cacheIdentity}:${key}`
			index = indexes.get(indexKey)
			if (index === undefined) {
				index = createCanonicalLogIndex<Log>()
				indexes.set(indexKey, index)
			}
		} else {
			let ownerIndexes = fallbackIndexes.get(owner)
			if (ownerIndexes === undefined) {
				ownerIndexes = new Map()
				fallbackIndexes.set(owner, ownerIndexes)
			}
			index = ownerIndexes.get(key)
			if (index === undefined) {
				index = createCanonicalLogIndex<Log>()
				ownerIndexes.set(key, index)
			}
		}
		return await refreshCanonicalLogIndex(index, {
			fetchRange: async logRange => await parameters.fetchRange(owner, key, logRange),
			key: indexKey,
			loadBlockAnchor: async blockNumber => await parameters.loadBlockAnchor(owner, blockNumber ?? toBlock),
			maximumRange: parameters.maximumRange,
			maximumItems: parameters.maximumItems,
			...(parameters.maximumBytes === undefined ? {} : { maximumBytes: parameters.maximumBytes }),
			...(parameters.measureItem === undefined ? {} : { measureItem: parameters.measureItem }),
			...(parameters.validateItem === undefined ? {} : { validateItem: parameters.validateItem }),
			...(parameters.loadStartBlock === undefined ? { startBlock: parameters.startBlock } : { loadStartBlock: async (latestBlock: bigint) => await parameters.loadStartBlock(owner, key, toBlock ?? latestBlock) }),
		})
	}
}

export async function findContractDeploymentBlock(
	client: Readonly<{
		getBlock: (parameters?: { blockNumber?: bigint }) => Promise<Readonly<{ number?: bigint | undefined }>>
		getCode: (parameters: { address: `0x${string}`; blockNumber?: bigint }) => Promise<string | undefined>
	}>,
	address: `0x${string}`,
	toBlock?: bigint,
) {
	const latestBlock = toBlock ?? (await client.getBlock()).number
	if (latestBlock === undefined) throw new Error('Contract deployment scan requires a mined head block')
	const hasCodeAt = async (blockNumber: bigint) => {
		const code = await client.getCode({ address, blockNumber })
		return code !== undefined && code !== '0x'
	}
	if (!(await hasCodeAt(latestBlock))) return undefined
	let lower = 0n
	let upper = latestBlock
	while (lower < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await hasCodeAt(middle)) upper = middle
		else lower = middle + 1n
	}
	return lower
}
