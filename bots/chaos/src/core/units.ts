/** Canonical base-10 JSON representation of an unsigned EVM integer. */
export type CanonicalUintString = string

/**
 * Preserve exact atomic-unit values across JSON boundaries without implying a
 * human-formatted decimal. Runtime readers still validate external strings.
 */
export function canonicalUintString(value: bigint): CanonicalUintString {
	if (value < 0n) throw new Error('Cannot serialize a negative value as an unsigned integer')
	return value.toString()
}

const MAXIMUM_DATE_MILLISECONDS = 8_640_000_000_000_000n

/**
 * Convert a canonical unix-seconds string into an ISO timestamp so operator-facing copy never
 * shows a raw epoch value.
 */
export function isoTimestampFromSeconds(value: string | undefined, subject: string) {
	if (value === undefined) return undefined
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${subject} is invalid`)
	const milliseconds = BigInt(value) * 1_000n
	if (milliseconds > MAXIMUM_DATE_MILLISECONDS) throw new Error(`${subject} is outside the supported date range`)
	return new Date(Number(milliseconds)).toISOString()
}
