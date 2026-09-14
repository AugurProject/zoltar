import { expect, test } from 'bun:test'
import { ceilDiv } from './bigint.js'

test('ceilDiv rounds unsigned ratios exactly at bigint boundaries', () => {
	const large = 2n ** 256n - 1n
	expect(ceilDiv(0n, 3n)).toBe(0n)
	expect(ceilDiv(6n, 3n)).toBe(2n)
	expect(ceilDiv(7n, 3n)).toBe(3n)
	expect(ceilDiv(large, 2n)).toBe(2n ** 255n)
	for (const denominator of [0n, -1n]) expect(() => ceilDiv(1n, denominator)).toThrow('positive denominator')
	expect(() => ceilDiv(-1n, 2n)).toThrow('nonnegative numerator')
})
