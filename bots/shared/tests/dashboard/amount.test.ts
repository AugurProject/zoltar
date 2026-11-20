import { describe, expect, test } from 'bun:test'
import { formatAmount, formatAtomicAmount, nonnegativeAtomicValue } from '../../src/dashboard/amount.ts'

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

	test('never renders a negative zero', () => {
		expect(formatAmount('-0', 'ETH')).toBe('0 ETH')
		expect(formatAmount('-0.000', 'ETH')).toBe('0 ETH')
		expect(formatAmount(-0, 'ETH')).toBe('0 ETH')
		expect(formatAmount('-0.5', 'ETH')).toBe('-0.5 ETH')
	})

	test('expands the exponent notation of small numeric values', () => {
		expect(formatAmount(2 ** -24, 'ETH')).toBe('0.00000005960464477539063 ETH')
		expect(formatAmount(-(2 ** -24), 'ETH')).toBe('-0.00000005960464477539063 ETH')
		expect(formatAmount(1e-7, 'ETH')).toBe('0.0000001 ETH')
		expect(formatAmount('0.000000059604644775390625', 'ETH')).toBe('0.000000059604644775390625 ETH')
	})

	test('parses whole amounts for zero-decimal tokens the formatter displays', () => {
		expect(formatAtomicAmount(7, 'TOK', 0)).toBe('7 TOK')
		expect(nonnegativeAtomicValue('7', 'TOK', 0)).toBe(7n)
		expect(() => nonnegativeAtomicValue('7.5', 'TOK', 0)).toThrow('at most 0 decimal places')
	})
})
