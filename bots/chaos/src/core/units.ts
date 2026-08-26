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
