const MAX_UINT256 = (1n << 256n) - 1n

export function normalizeQuestionId(value: string) {
	const trimmedValue = value.trim()
	if (!/^0x[0-9a-f]+$/i.test(trimmedValue)) return undefined
	const questionId = BigInt(trimmedValue)
	if (questionId > MAX_UINT256) return undefined
	return `0x${questionId.toString(16)}`
}
