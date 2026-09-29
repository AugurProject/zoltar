import { expect, test } from 'bun:test'
import { ceilDiv, compareBigint } from './bigint.js'

test('ceilDiv rounds unsigned ratios exactly at bigint boundaries', () => {
	const large = 2n ** 256n - 1n
	expect(ceilDiv(0n, 3n)).toBe(0n)
	expect(ceilDiv(6n, 3n)).toBe(2n)
	expect(ceilDiv(7n, 3n)).toBe(3n)
	expect(ceilDiv(large, 2n)).toBe(2n ** 255n)
	for (const denominator of [0n, -1n]) expect(() => ceilDiv(1n, denominator)).toThrow('positive denominator')
	expect(() => ceilDiv(-1n, 2n)).toThrow('nonnegative numerator')
})

test('compareBigint orders values beyond the safe integer range', () => {
	expect(compareBigint(1n, 2n)).toBe(-1)
	expect(compareBigint(2n ** 200n, 2n ** 200n)).toBe(0)
	expect(compareBigint(2n ** 200n + 1n, 2n ** 200n)).toBe(1)
	expect([3n, -(2n ** 100n), 2n ** 100n, 0n].sort(compareBigint)).toEqual([-(2n ** 100n), 0n, 3n, 2n ** 100n])
})
