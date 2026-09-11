export const compareBigint = (left: bigint, right: bigint): -1 | 0 | 1 => {
	if (left < right) return -1
	return left > right ? 1 : 0
}
