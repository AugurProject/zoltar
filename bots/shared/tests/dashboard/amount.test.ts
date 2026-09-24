import { describe, expect, test } from 'bun:test'
import { formatAmount, formatAtomicAmount } from '../../src/dashboard/amount.ts'

describe('operator amounts', () => {
	test('keeps exact fractional precision without padding', () => {
		expect(formatAmount('12345678901234567890.000000000000000001', 'ETH')).toBe('12345678901234567890.000000000000000001 ETH')
		expect(formatAtomicAmount('1000000000000000001', 'WETH')).toBe('1.000000000000000001 WETH')
		expect(formatAtomicAmount('1000000000000000000', 'ETH')).toBe('1 ETH')
	})

	test('rejects unsafe numeric and malformed values', () => {
		expect(formatAtomicAmount(10 ** 18, 'ETH')).toBe('Unavailable')
		expect(formatAmount('1e18', 'ETH')).toBe('Unavailable')
	})
})
