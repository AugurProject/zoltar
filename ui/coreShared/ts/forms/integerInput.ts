const WHOLE_NUMBER_PATTERN = /^-?\d+$/
const HEX_BIGINT_PATTERN = /^0x[0-9a-fA-F]+$/

export function tryParseBigIntInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '' || (!WHOLE_NUMBER_PATTERN.test(trimmed) && !HEX_BIGINT_PATTERN.test(trimmed))) return undefined
	return BigInt(trimmed)
}

export function parseBigIntInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	const parsed = tryParseBigIntInput(trimmed)
	if (parsed === undefined) throw new Error(`${label} must be a whole number`)
	return parsed
}
