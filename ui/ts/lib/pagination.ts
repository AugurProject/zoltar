export const QUESTION_PAGE_SIZE = 10
export const SECURITY_POOL_PAGE_SIZE = 6

function getPageSizeBigInt(pageSize: number) {
	if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new RangeError('Page size must be a positive safe integer')
	return BigInt(pageSize)
}

export function getPaginationPageCount(itemCount: bigint | undefined, pageSize: number) {
	if (itemCount === undefined) return undefined
	if (itemCount < 0n) throw new RangeError('Pagination count must be non-negative')
	if (itemCount === 0n) return 0n

	const pageSizeBigInt = getPageSizeBigInt(pageSize)
	return (itemCount + pageSizeBigInt - 1n) / pageSizeBigInt
}

export function getHasNextPaginationPage(pageIndex: number, pageCount: bigint | undefined) {
	if (pageCount === undefined) return false
	return BigInt(pageIndex) + 1n < pageCount
}

export function resolvePaginationPageIndex(pageIndex: number, pageCount: bigint | undefined) {
	if (pageCount === undefined) return pageIndex
	if (pageCount === 0n) return 0

	const lastPageIndex = pageCount - 1n
	if (BigInt(pageIndex) <= lastPageIndex) return pageIndex
	if (lastPageIndex > BigInt(Number.MAX_SAFE_INTEGER)) return pageIndex
	return Number(lastPageIndex)
}

export function formatPaginationSummary(pageIndex: number, pageCount: bigint | undefined) {
	if (pageCount === undefined) return undefined

	const currentPage = BigInt(pageIndex) + 1n
	const displayedPageCount = pageCount === 0n ? 1n : pageCount
	return `Page ${currentPage.toString()} of ${displayedPageCount.toString()}`
}
