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

export function assertFinalityAnchor(cursor: SyncCursor, blockNumber: bigint, blockHash: string) {
	if (cursor.finalityAnchorNumber !== blockNumber || cursor.finalityAnchorHash !== blockHash) {
		throw new Error(`Canonical chain reorganized deeper than the configured overlap at block ${blockNumber.toString()}; restart to rebuild the complete lookback before execution`)
	}
}
