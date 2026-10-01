import { expect, test } from 'bun:test'
import { ORIGIN_POOL_INITIAL_RETENTION_RATE, openInterestFeePerYearBigint, roundedOpenInterestFeePerYear, rpow } from './retentionRate.js'

const precision = 10n ** 18n

test('rpow raises fixed-point values with floor division like the contract', () => {
	expect(rpow(2n * precision, 0n, precision)).toBe(precision)
	expect(rpow(2n * precision, 10n, precision)).toBe(1_024n * precision)
	expect(rpow(precision / 2n, 3n, precision)).toBe(precision / 8n)
	expect(rpow(3n, 2n, 2n)).toBe(4n)
})

test('annual open interest fee follows the per-second retention rate', () => {
	expect(openInterestFeePerYearBigint(undefined)).toBeUndefined()
	expect(openInterestFeePerYearBigint(0n)).toBe(100n * precision)
	expect(openInterestFeePerYearBigint(precision)).toBe(0n)
	const originFee = openInterestFeePerYearBigint(ORIGIN_POOL_INITIAL_RETENTION_RATE)
	if (originFee === undefined) throw new Error('Origin pool fee should be defined')
	expect(originFee).toBe((precision - rpow(ORIGIN_POOL_INITIAL_RETENTION_RATE, 31_536_000n, precision)) * 100n)
	expect(originFee > 0n && originFee < 100n * precision).toBe(true)
	const lowerRetentionFee = openInterestFeePerYearBigint(ORIGIN_POOL_INITIAL_RETENTION_RATE - 1_000_000_000n)
	if (lowerRetentionFee === undefined) throw new Error('Lower retention fee should be defined')
	expect(lowerRetentionFee > originFee).toBe(true)
})

test('rounded annual fee rounds half up at the requested precision', () => {
	expect(roundedOpenInterestFeePerYear(undefined, 2)).toBeUndefined()
	expect(roundedOpenInterestFeePerYear(0n, 2)).toBe(10_000n)
	expect(roundedOpenInterestFeePerYear(precision, 4)).toBe(0n)
	const fee = openInterestFeePerYearBigint(ORIGIN_POOL_INITIAL_RETENTION_RATE)
	if (fee === undefined) throw new Error('Origin pool fee should be defined')
	const step = 10n ** 16n
	expect(roundedOpenInterestFeePerYear(ORIGIN_POOL_INITIAL_RETENTION_RATE, 2)).toBe((fee + step / 2n) / step)
})
