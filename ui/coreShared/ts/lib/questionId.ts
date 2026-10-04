import * as commonCopy from '../copy/common.js'

const MAX_UINT256 = (1n << 256n) - 1n

export function formatQuestionIdHex(questionId: bigint) {
	return `0x${questionId.toString(16)}`
}

export function normalizeQuestionId(value: string) {
	const trimmedValue = value.trim()
	if (!/^0x[0-9a-f]+$/i.test(trimmedValue)) return undefined
	const questionId = BigInt(trimmedValue)
	if (questionId > MAX_UINT256) return undefined
	return formatQuestionIdHex(questionId)
}

/** Parses a required hexadecimal question ID form input, throwing a user-facing error when it is missing or malformed. */
export function parseQuestionIdInput(value: string, label = commonCopy.questionId) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required.`)
	const normalized = normalizeQuestionId(trimmed)
	if (normalized === undefined) throw new Error(commonCopy.invalidQuestionId)
	return BigInt(normalized)
}
