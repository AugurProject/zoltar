export function compareBigIntAscending(left: bigint, right: bigint) {
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

export function sortBigIntsAscending(values: bigint[]) {
	return [...values].sort(compareBigIntAscending)
}
