function compareBigIntAscending(left: bigint, right: bigint) {
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

export function sortBigIntsAscending(values: bigint[]) {
	return [...values].sort(compareBigIntAscending)
}

/** `JSON.stringify` replacer that writes every bigint as its decimal string and leaves other values unchanged. */
function bigIntJsonReplacer(_key: string, value: unknown) {
	return typeof value === 'bigint' ? value.toString() : value
}

/** Serializes a JSON document whose bigints become decimal strings; the reader decides which fields to parse back. */
export function stringifyWithBigInts(value: unknown, space?: number | string) {
	return JSON.stringify(value, bigIntJsonReplacer, space)
}
