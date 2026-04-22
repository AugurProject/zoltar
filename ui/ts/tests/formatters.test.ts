/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatCurrencyInputBalance, formatDuration, formatRelativeTimestamp, formatRoundedCurrencyBalance, formatTimestamp } from '../lib/formatters.js'

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

	void describe('timestamp formatting', () => {
		void test('formatTimestamp renders UTC output', () => {
			expect(formatTimestamp(1_700_000_000n)).toBe('2023-11-14 22:13:20 UTC')
		})

		void test('formatTimestamp preserves the immediate sentinel', () => {
			expect(formatTimestamp(0n)).toBe('Immediate')
		})

		void test('formatRelativeTimestamp renders now for an exact match', () => {
			expect(formatRelativeTimestamp(1_000n, 1_000n)).toBe('now')
		})

		void test('formatRelativeTimestamp renders sub-minute future values as less than a minute', () => {
			expect(formatRelativeTimestamp(1_001n, 1_000n)).toBe('in less than a minute')
		})

		void test('formatRelativeTimestamp renders sub-minute past values as less than a minute ago', () => {
			expect(formatRelativeTimestamp(997n, 1_000n)).toBe('less than a minute ago')
		})

		void test('formatRelativeTimestamp omits seconds for longer durations', () => {
			expect(formatRelativeTimestamp(90_061n, 0n)).toBe('in 1d 1h 1m')
		})

		void test('formatDuration renders sub-minute values as less than a minute', () => {
			expect(formatDuration(59n)).toBe('less than a minute')
		})
	})

	void describe('formatRoundedCurrencyBalance — 2 significant figures for tiny values', () => {
		// 0.000025532 ETH → 6 decimal places to capture 2 sig figs
		void test('0.000025532 ETH rounds to 0.000026', () => {
			expect(formatRoundedCurrencyBalance(25532000000000n, 18, 2)).toBe('0.000026')
		})

		// 0.023 ETH → 3 decimal places (first non-zero at position 2)
		void test('0.023 ETH rounds to 0.023', () => {
			expect(formatRoundedCurrencyBalance(23000000000000000n, 18, 2)).toBe('0.023')
		})

		// 0.0045 ETH → 4 decimal places to capture 2 sig figs (4 and 5)
		void test('0.0045 ETH rounds to 0.0045', () => {
			expect(formatRoundedCurrencyBalance(4500000000000000n, 18, 2)).toBe('0.0045')
		})

		// 0.00041 ETH (typical REP/ETH price) → 5 decimal places: 0.00041
		void test('0.00041 ETH rounds to 0.00041', () => {
			expect(formatRoundedCurrencyBalance(410000000000000n, 18, 2)).toBe('0.00041')
		})

		// Values >= 1 are unaffected — still use fixed decimal count
		void test('1.234 ETH rounds to 1.23 (unchanged behaviour)', () => {
			expect(formatRoundedCurrencyBalance(1234000000000000000n, 18, 2)).toBe('1.23')
		})

		// USDC (6 decimals) — 0.85 USDC stays at 2 decimal places
		void test('0.85 USDC rounds to 0.85', () => {
			expect(formatRoundedCurrencyBalance(850000n, 6, 2)).toBe('0.85')
		})
	})
})
