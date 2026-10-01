import type { JsonRecord } from './api-validation.ts'

export type Page<T, Cursor = string> = { items: T[]; nextCursor?: Cursor | undefined }

export const mergeUniqueRecords = <T>(primary: readonly T[], retained: readonly T[], keyFor: (record: T) => string): T[] => {
	const seen = new Set<string>()
	return [...primary, ...retained].filter(record => {
		const key = keyFor(record)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export const riskPaginationForCollectedCursors = (pagination: JsonRecord, poolNextCursor: string | undefined, vaultNextCursor: string | undefined): JsonRecord => {
	const paginationWithoutCursors = Object.fromEntries(Object.entries(pagination).filter(([key]) => key !== 'poolNextCursor' && key !== 'vaultNextCursor'))
	return {
		...paginationWithoutCursors,
		poolHasMore: poolNextCursor !== undefined,
		...(poolNextCursor === undefined ? {} : { poolNextCursor }),
		vaultHasMore: vaultNextCursor !== undefined,
		...(vaultNextCursor === undefined ? {} : { vaultNextCursor }),
	}
}

const canonicalEventPosition = (record: Readonly<Record<string, unknown>>, key: 'block_number' | 'transaction_index' | 'log_index'): bigint => {
	const value = record[key]
	return (typeof value === 'string' && /^\d+$/.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value)) ? BigInt(value) : 0n
}

export const compareCanonicalEventPosition = (left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): number => {
	const leftBlock = canonicalEventPosition(left, 'block_number')
	const rightBlock = canonicalEventPosition(right, 'block_number')
	if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1
	const leftTransaction = canonicalEventPosition(left, 'transaction_index')
	const rightTransaction = canonicalEventPosition(right, 'transaction_index')
	if (leftTransaction !== rightTransaction) return leftTransaction < rightTransaction ? -1 : 1
	const leftLog = canonicalEventPosition(left, 'log_index')
	const rightLog = canonicalEventPosition(right, 'log_index')
	if (leftLog === rightLog) return 0
	return leftLog < rightLog ? -1 : 1
}

export const canonicalPageLimit = (targetCount: number, loadedCount: number, pageSize: number): number => (targetCount > loadedCount ? Math.min(pageSize, targetCount - loadedCount) : pageSize)

export const collectCanonicalPages = async <T, Cursor = string>(fetchPage: (cursor?: Cursor, limit?: number) => Promise<Page<T, Cursor>>, targetCount: number, keyFor: (record: T) => string): Promise<Page<T, Cursor>> => {
	let cursor: Cursor | undefined
	let items: T[] = []
	do {
		const remaining = targetCount > 0 ? canonicalPageLimit(targetCount, items.length, 100) : undefined
		const page = await fetchPage(cursor, remaining)
		items = mergeUniqueRecords(items, page.items, keyFor)
		cursor = page.nextCursor
	} while (cursor !== undefined && items.length < targetCount)
	return { items: targetCount > 0 ? items.slice(0, targetCount) : items, nextCursor: cursor }
}

export const collectCursorCollections = async <T>(
	fetchPage: (cursor?: string) => Promise<{
		readonly collections: Readonly<Record<string, readonly T[]>>
		readonly offset: number
		readonly nextCursor?: string
	}>,
	collectionKeys: readonly string[],
	throughOffset: number,
): Promise<{ readonly collections: Readonly<Record<string, readonly T[]>>; readonly loadedOffset: number; readonly nextCursor?: string }> => {
	const collections: Record<string, T[]> = {}
	for (const key of collectionKeys) collections[key] = []
	let cursor: string | undefined
	let priorOffset: number | undefined
	while (true) {
		const page = await fetchPage(cursor)
		if (!Number.isSafeInteger(page.offset) || page.offset < 0 || (priorOffset === undefined ? page.offset !== 0 : page.offset <= priorOffset)) throw new Error('History continuation page offset did not advance')
		for (const key of collectionKeys) {
			const retained = collections[key]
			if (retained === undefined) throw new Error(`History collection ${key} was not initialized`)
			retained.push(...(page.collections[key] ?? []))
		}
		if (page.nextCursor === undefined || page.offset >= throughOffset) return { collections, loadedOffset: page.offset, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
		priorOffset = page.offset
		cursor = page.nextCursor
	}
}

export const collectDualCursorCollections = async <T, Cursor = string>(
	fetchPage: (options: { readonly leftCursor?: Cursor; readonly rightCursor?: Cursor; readonly limit: number }) => Promise<{
		readonly left: readonly T[]
		readonly right: readonly T[]
		readonly leftNextCursor?: Cursor
		readonly rightNextCursor?: Cursor
	}>,
	leftTargetCount: number,
	rightTargetCount: number,
	leftKeyFor: (record: T) => string,
	rightKeyFor: (record: T) => string,
): Promise<{ readonly left: readonly T[]; readonly right: readonly T[]; readonly leftNextCursor?: Cursor; readonly rightNextCursor?: Cursor }> => {
	let left: T[] = []
	let right: T[] = []
	let leftNextCursor: Cursor | undefined
	let rightNextCursor: Cursor | undefined
	let firstPage = true
	do {
		const requestLeft = firstPage || (left.length < leftTargetCount && leftNextCursor !== undefined)
		const requestRight = firstPage || (right.length < rightTargetCount && rightNextCursor !== undefined)
		if (!requestLeft && !requestRight) break
		const remaining = Math.max(requestLeft ? Math.max(leftTargetCount - left.length, 1) : 0, requestRight ? Math.max(rightTargetCount - right.length, 1) : 0)
		const page = await fetchPage({
			...(requestLeft && leftNextCursor !== undefined ? { leftCursor: leftNextCursor } : {}),
			...(requestRight && rightNextCursor !== undefined ? { rightCursor: rightNextCursor } : {}),
			limit: firstPage ? 100 : Math.min(100, remaining),
		})
		left = mergeUniqueRecords(left, page.left, leftKeyFor)
		right = mergeUniqueRecords(right, page.right, rightKeyFor)
		if (requestLeft) leftNextCursor = page.leftNextCursor
		if (requestRight) rightNextCursor = page.rightNextCursor
		firstPage = false
	} while (left.length < leftTargetCount || right.length < rightTargetCount)
	return {
		left,
		right,
		...(leftNextCursor === undefined ? {} : { leftNextCursor }),
		...(rightNextCursor === undefined ? {} : { rightNextCursor }),
	}
}

const historyBlockNumber = (value: unknown): bigint | undefined => {
	if (typeof value === 'bigint' && value >= 0n) return value
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
	return undefined
}

export const summarizeHistoryCollections = (collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>, collectionKeys: readonly string[]): { readonly counts: Readonly<Record<string, number>>; readonly oldestBlock?: bigint; readonly newestBlock?: bigint } => {
	const counts: Record<string, number> = {}
	let oldestBlock: bigint | undefined
	let newestBlock: bigint | undefined
	for (const key of collectionKeys) {
		const records = collections[key] ?? []
		counts[key] = records.length
		for (const record of records) {
			const blockNumber = historyBlockNumber(record['block_number'])
			if (blockNumber === undefined) continue
			if (oldestBlock === undefined || blockNumber < oldestBlock) oldestBlock = blockNumber
			if (newestBlock === undefined || blockNumber > newestBlock) newestBlock = blockNumber
		}
	}
	return { counts, ...(oldestBlock === undefined ? {} : { oldestBlock }), ...(newestBlock === undefined ? {} : { newestBlock }) }
}

export const reconcilePaginatedTotal = (currentTotal: number, responseTotal: number, append: boolean): number => (append ? Math.max(currentTotal, responseTotal) : responseTotal)

export const paginatedSnapshotWasReplaced = (loadedCount: number, responseTotal: number): boolean => responseTotal < loadedCount
