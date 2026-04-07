/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatCurrencyInputBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js'

void describe('formatting helpers', () => {
	void test('formatRoundedCurrencyBalance rounds positive balances without a decimal part when decimals are zero', () => {
		expect(formatRoundedCurrencyBalance(125n, 2, 0)).toBe('1')
	})

	void test('formatRoundedCurrencyBalance rounds negative balances without invalid fractional output', () => {
		expect(formatRoundedCurrencyBalance(-125n, 2, 1)).toBe('-1.3')
	})

	void test('formatRoundedCurrencyBalance rejects non-integer units and decimals', () => {
		expect(() => formatRoundedCurrencyBalance(125n, 1.5)).toThrow(RangeError)
		expect(() => formatRoundedCurrencyBalance(125n, 2, 1.25)).toThrow(RangeError)
	})

	void test('formatCurrencyInputBalance returns a compact decimal string without grouped separators', () => {
		expect(formatCurrencyInputBalance(1234567890000000000000n)).toBe('1234.56789')
	})
})
