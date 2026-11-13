import { expect, test } from 'bun:test'
import { roundedOpenInterestFeePerYear } from './retentionRate.js'

const precision = 10n ** 18n

test('compounds a per-second retention rate into a rounded annual fee percentage', () => {
	expect(roundedOpenInterestFeePerYear(undefined, 2)).toBeUndefined()
	expect(roundedOpenInterestFeePerYear(0n, 2)).toBe(10_000n)
	expect(roundedOpenInterestFeePerYear(precision, 2)).toBe(0n)
	expect(roundedOpenInterestFeePerYear(2n * precision, 2)).toBe(0n)
	// 0.999999999 per second retains about 96.9% over a year.
	expect(roundedOpenInterestFeePerYear(999_999_999_000_000_000n, 2)).toBe(310n)
})
