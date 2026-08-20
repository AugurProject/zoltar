export type LogRange = { fromBlock: bigint; toBlock: bigint }

export const DEFAULT_LATEST_LOG_BLOCKS = 256n

export class LogScanError extends Error {
	readonly logRange: LogRange

	constructor(logRange: LogRange, options: { cause?: unknown }) {
		const causeMessage = options.cause instanceof Error ? options.cause.message : typeof options.cause === 'string' ? options.cause : undefined
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

export function historyUnavailableError(error: unknown) {
	return walkErrorCauses(error, current => {
		if (!('message' in current) || typeof current.message !== 'string') return false
		const message = current.message.toLowerCase()
		return message.includes('history unavailable') || message.includes('historical data unavailable') || message.includes('missing trie node') || message.includes('pruned') || message.includes('block is out of range') || message.includes('requested data is not available')
	})
}

export function latestLogRange(head: bigint, maximumBlocks = DEFAULT_LATEST_LOG_BLOCKS): LogRange {
	if (maximumBlocks < 1n || maximumBlocks > DEFAULT_LATEST_LOG_BLOCKS) throw new Error(`maximumBlocks must be from 1 through ${DEFAULT_LATEST_LOG_BLOCKS.toString()}`)
	return { fromBlock: head + 1n > maximumBlocks ? head + 1n - maximumBlocks : 0n, toBlock: head }
}

export function newestFirstScanRanges(fromBlock: bigint, toBlock: bigint, maximumRange = DEFAULT_LATEST_LOG_BLOCKS) {
	if (maximumRange < 1n) throw new Error('maximumRange must be positive')
	if (fromBlock > toBlock) return []
	const ranges: LogRange[] = []
	let nextToBlock = toBlock
	while (nextToBlock >= fromBlock) {
		const available = nextToBlock - fromBlock + 1n
		const attemptedBlocks = maximumRange < available ? maximumRange : available
		const range = { fromBlock: nextToBlock - attemptedBlocks + 1n, toBlock: nextToBlock }
		ranges.push(range)
		if (range.fromBlock === fromBlock) break
		nextToBlock = range.fromBlock - 1n
	}
	return ranges
}

export async function fetchLogsWithAdaptiveRanges<Log>(cursor: Pick<SyncCursor, 'nextBlock'>, head: bigint, maximumRange: bigint, fetchRange: (logRange: LogRange) => Promise<readonly Log[]>): Promise<Log[]> {
	if (maximumRange < 1n) throw new Error('maximumRange must be positive')
	const logs: Log[] = []
	let fromBlock = cursor.nextBlock
	let requestedBlocks = maximumRange
	while (fromBlock <= head) {
		const remaining = head - fromBlock + 1n
		const attemptedBlocks = requestedBlocks < remaining ? requestedBlocks : remaining
		const toBlock = fromBlock + attemptedBlocks - 1n
		const logRange = { fromBlock, toBlock }
		try {
			logs.push(...(await fetchRange(logRange)))
			fromBlock = toBlock + 1n
			requestedBlocks = maximumRange
		} catch (error) {
			if (attemptedBlocks > 1n && logRangeLimitError(error)) {
				requestedBlocks = (attemptedBlocks + 1n) / 2n
				continue
			}
			throw new LogScanError(logRange, { cause: error })
		}
	}
	return logs
}

export type SyncCursor = {
	finalityAnchorHash: string | undefined
	finalityAnchorNumber: bigint | undefined
	initial: boolean
	lastHeadHash: string | undefined
	lastHeadNumber: bigint | undefined
	nextBlock: bigint
}

export function operatorStatusAfterPause(paused: boolean, initialSyncComplete: boolean, hasError: boolean) {
	if (paused) return 'paused' as const
	if (hasError) return 'error' as const
	return initialSyncComplete ? ('running' as const) : ('syncing' as const)
}

export function initialCursor(head: bigint, lookbackBlocks: bigint): SyncCursor {
	return {
		finalityAnchorHash: undefined,
		finalityAnchorNumber: undefined,
		initial: true,
		lastHeadHash: undefined,
		lastHeadNumber: undefined,
		nextBlock: head > lookbackBlocks ? head - lookbackBlocks : 0n,
	}
}

export function cursorForHeadScan(cursor: SyncCursor, head: bigint, headHash: string, overlapBlocks: bigint) {
	if (!cursor.initial && cursor.lastHeadNumber === head && cursor.lastHeadHash === headHash) return undefined
	if (cursor.initial) return cursor
	const headNextBlock = head + 1n
	const overlapAnchor = cursor.nextBlock < headNextBlock ? cursor.nextBlock : headNextBlock
	return {
		...cursor,
		nextBlock: overlapAnchor > overlapBlocks ? overlapAnchor - overlapBlocks : 0n,
	}
}

export function scanRanges(cursor: Pick<SyncCursor, 'nextBlock'>, head: bigint, maximumRange = 10_000n) {
	if (maximumRange < 1n) throw new Error('maximumRange must be positive')
	if (cursor.nextBlock > head) return []
	const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
	let fromBlock = cursor.nextBlock
	while (fromBlock <= head) {
		const candidate = fromBlock + maximumRange - 1n
		const toBlock = candidate < head ? candidate : head
		ranges.push({ fromBlock, toBlock })
		fromBlock = toBlock + 1n
	}
	return ranges
}

export function advanceCursor(head: bigint, headHash: string): SyncCursor {
	return { finalityAnchorHash: undefined, finalityAnchorNumber: undefined, initial: false, lastHeadHash: headHash, lastHeadNumber: head, nextBlock: head + 1n }
}

export async function advanceCursorAfterSuccessfulHead(head: bigint, headHash: string, processHead: () => Promise<void>) {
	await processHead()
	return advanceCursor(head, headHash)
}

export function withFinalityAnchor(cursor: SyncCursor, blockNumber: bigint, blockHash: string): SyncCursor {
	return { ...cursor, finalityAnchorHash: blockHash, finalityAnchorNumber: blockNumber }
}

export function finalityAnchorMatches(cursor: SyncCursor, blockNumber: bigint, blockHash: string) {
	return cursor.finalityAnchorNumber === blockNumber && cursor.finalityAnchorHash?.toLowerCase() === blockHash.toLowerCase()
}

export function finalityAnchorRequiresReset(cursor: SyncCursor, currentHead: bigint, observedAnchorHash: string | undefined) {
	const anchorNumber = cursor.finalityAnchorNumber
	if (anchorNumber === undefined || cursor.finalityAnchorHash === undefined) return false
	return anchorNumber > currentHead || observedAnchorHash === undefined || !finalityAnchorMatches(cursor, anchorNumber, observedAnchorHash)
}

export function assertFinalityAnchor(cursor: SyncCursor, blockNumber: bigint, blockHash: string) {
	if (!finalityAnchorMatches(cursor, blockNumber, blockHash)) {
		throw new Error(`Canonical chain reorganized deeper than the configured overlap at block ${blockNumber.toString()}; execution remains blocked while the retained lookback is rebuilt`)
	}
}
