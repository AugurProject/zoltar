/** Round an unsigned bigint ratio up without losing precision. */
export function ceilDiv(numerator: bigint, denominator: bigint) {
	if (numerator < 0n || denominator <= 0n) throw new Error('ceilDiv requires a nonnegative numerator and positive denominator')
	return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n
}
