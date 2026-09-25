/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	formatAdditionalCurrencyBalance,
	formatAmount,
	formatAmountDisplay,
	formatCurrencyBalanceWithUnit,
	formatCurrencyInputBalance,
	formatDuration,
	formatMultiplier,
	formatMultiplierText,
	formatRelativeTimestamp,
	formatRoundedCurrencyBalance,
	formatScaledPercentage,
	formatTimestamp,
	formatTrimmedUnits,
	formatUnitSuffix,
	formatValueWithUnit,
} from '../lib/formatters.js'

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

	void test('formatTrimmedUnits truncates fractional digits and preserves grouped whole units', () => {
		expect(formatTrimmedUnits(1_234_567_890_000_000_000_000n, 18, 4)).toBe('1 234.5678')
		expect(formatTrimmedUnits(-1_200_000n, 6, 4)).toBe('-1.2')
	})

	void test('keeps formatted values and units together with nonbreaking spaces', () => {
		expect(formatValueWithUnit('9 000 000.00', 'REP')).toBe('9 000 000.00\u00a0REP')
		expect(formatCurrencyBalanceWithUnit(2n * 10n ** 18n, 'REP')).toBe('2\u00a0REP')
		expect(formatAdditionalCurrencyBalance(2n * 10n ** 18n, 'REP')).toBe('2\u00a0more\u00a0REP')
	})

	void describe('formatAmount compact notation', () => {
		const compact = (value: bigint, units = 18) => formatAmount(value, { notation: 'compact', units }).text

		void test('formats thousands with SI suffixes', () => {
			expect(compact(10000n * 10n ** 18n)).toBe('10k')
		})

		void test('formats millions with a single decimal place', () => {
			expect(compact(1234000n * 10n ** 18n)).toBe('1.2M')
		})

		void test('carries rounded values into the next suffix', () => {
			expect(compact(999999990000n * 10n ** 18n)).toBe('1T')
		})

		void test('preserves the sign for negative values', () => {
			expect(compact(-1250n * 10n ** 18n)).toBe('-1.3k')
		})

		void test('supports non-18-decimal token units', () => {
			expect(compact(1234567890000n, 6)).toBe('1.2M')
		})

		void test('falls back to scientific notation beyond yotta', () => {
			expect(compact(1234000000000000000000000000n, 0)).toBe('1.2E27')
		})

		void test('keeps the standard form below one thousand', () => {
			expect(formatAmount(99999n * 10n ** 16n, { notation: 'compact' })).toEqual({ approximate: false, exact: '999.99', text: '999.99' })
		})
	})

	void describe('formatAmount precision detection', () => {
		void test('does not mark exact values, including zero, as approximate', () => {
			expect(formatAmount(0n)).toEqual({ approximate: false, exact: '0', text: '0.00' })
			expect(formatAmount(2n * 10n ** 18n)).toEqual({ approximate: false, exact: '2', text: '2.00' })
			expect(formatAmount(1_500_000n, { units: 6 })).toEqual({ approximate: false, exact: '1.5', text: '1.50' })
			expect(formatAmountDisplay(10_000n * 10n ** 18n, { notation: 'compact' })).toBe('10k')
		})

		void test('marks values whose dropped digits are non-zero', () => {
			expect(formatAmount(1_234_567n * 10n ** 15n)).toEqual({ approximate: true, exact: '1 234.567', text: '1 234.57' })
			expect(formatAmountDisplay(999_999_990_000n * 10n ** 18n, { notation: 'compact' })).toBe('≈ 1T')
			expect(formatAmountDisplay(1_234_000n * 10n ** 18n, { notation: 'compact' })).toBe('≈ 1.2M')
		})

		void test('keeps two significant digits for tiny values and marks only lossy ones', () => {
			expect(formatAmountDisplay(137_760_122n)).toBe('≈ 0.00000000014')
			expect(formatAmountDisplay(410_000_000_000_000n)).toBe('0.00041')
			expect(formatAmountDisplay(1n)).toBe('0.0000000000000000010')
		})

		void test('marks negative values symmetrically', () => {
			expect(formatAmountDisplay(-125n, { decimals: 1, units: 2 })).toBe('≈ -1.3')
			expect(formatAmountDisplay(-150n, { decimals: 1, units: 2 })).toBe('-1.5')
		})

		void test('treats more requested decimals than token units as exact', () => {
			expect(formatAmount(12_345n, { decimals: 4, units: 2 })).toEqual({ approximate: false, exact: '123.45', text: '123.4500' })
		})

		void test('rejects negative decimals', () => {
			expect(() => formatAmount(1n, { decimals: -1 })).toThrow(RangeError)
		})
	})

	void describe('multiplier, percentage, and unit formatting', () => {
		void test('formats fixed-point multipliers with the multiplication sign', () => {
			expect(formatMultiplier(20_000n, 4)).toBe('2×')
			expect(formatMultiplier(25_000n, 4)).toBe('2.5×')
			expect(formatMultiplier(1_250_000n, 4)).toBe('125×')
			expect(formatMultiplier(140n, 2)).toBe('1.4×')
			expect(formatMultiplier(-5_000n, 4)).toBe('-0.5×')
			expect(formatMultiplierText('1.75')).toBe('1.75×')
		})

		void test('formats fixed-point percentages without a space', () => {
			expect(formatScaledPercentage(30n, 2)).toBe('0.3%')
			expect(formatScaledPercentage(10_000n, 2)).toBe('100%')
		})

		void test('attaches percent and multiplier signs but spaces other units', () => {
			expect(formatUnitSuffix('')).toBe('')
			expect(formatUnitSuffix('%')).toBe('%')
			expect(formatUnitSuffix('×')).toBe('×')
			expect(formatUnitSuffix('ETH')).toBe(' ETH')
		})
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

		// 0.00041 ETH → 5 decimal places: 0.00041
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
