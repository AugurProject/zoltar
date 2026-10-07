/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	formatAdditionalCurrencyBalance,
	formatAmount,
	formatAmountDisplay,
	formatCeilingAmount,
	formatCurrencyBalanceWithUnit,
	formatCurrencyInputBalance,
	formatDuration,
	formatLocalTimestamp,
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
	test.each([
		[0n, 18, '0', false],
		[999991n, 3, '1k', true],
		[1000n, 0, '1k', false],
		[1230000000n, 6, '1.23k', false],
		[999999999n, 0, '1G', true],
		[99999n * 10n ** 22n, 0, '999.99Y', false],
	])('formats upward compact approval boundary %s with %s units', (amount, units, text, approximate) => {
		expect(formatCeilingAmount(amount, units)).toMatchObject({ text, approximate })
	})

	test.each([
		[99999n * 10n ** 22n + 1n, 0],
		[10n ** 27n, 0],
		[2n ** 256n - 1n, 18],
		[2n ** 256n - 1n, 0],
	])('omits approval amounts beyond compact suffixes instead of using scientific notation: %s', (amount, units) => {
		expect(formatCeilingAmount(amount, units)).toBeUndefined()
	})

	test('rejects invalid approval formatting inputs', () => {
		expect(() => formatCeilingAmount(-1n)).toThrow('non-negative')
		expect(() => formatCeilingAmount(1n, -1)).toThrow('non-negative')
		expect(() => formatCeilingAmount(1n, 1.5)).toThrow('integer')
	})

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
		expect(formatTrimmedUnits(1_234_567_890_000_000_000_000n, 18, 4)).toBe('1\u00a0234.5678')
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

		void test('switches to compact notation when rounding carries into the threshold or the next suffix', () => {
			expect(formatAmount(999_996n * 10n ** 15n, { notation: 'compact' })).toEqual({ approximate: true, exact: '999.996', text: '1k' })
			expect(formatAmount(999_950n * 10n ** 18n, { notation: 'compact' })).toEqual({ approximate: true, exact: '999\u00a0950', text: '1M' })
		})

		void test('keeps the standard form below one thousand', () => {
			expect(formatAmount(99999n * 10n ** 16n, { notation: 'compact' })).toEqual({ approximate: false, exact: '999.99', text: '999.99' })
		})
	})

	void describe('formatAmount precision detection', () => {
		void test('rounds down at the displayed precision when asked, so a limit never reads above its exact value', () => {
			expect(formatAmount(1_666_666_666_666_666_666_666n, { rounding: 'down' })).toEqual({ approximate: true, exact: '1\u00a0666.666666666666666666', text: '1\u00a0666.66' })
			// Small values keep their extra significant digits instead of flooring to 0.00.
			expect(formatAmount(4_266_666_666_666_667n, { rounding: 'down' }).text).toBe('0.0042')
			expect(formatAmount(999_999_999_999_999_999n, { rounding: 'down' }).text).toBe('0.99')
			expect(formatAmount(5n * 10n ** 18n, { rounding: 'down' })).toEqual({ approximate: false, exact: '5', text: '5.00' })
			// Compact SI rounding could read above the exact value, so rounding down keeps standard notation.
			expect(formatAmount(1_234_567n * 10n ** 18n, { notation: 'compact', rounding: 'down' }).text).toBe('1\u00a0234\u00a0567.00')
		})

		void test('does not mark exact values, including zero, as approximate', () => {
			expect(formatAmount(0n)).toEqual({ approximate: false, exact: '0', text: '0.00' })
			expect(formatAmount(2n * 10n ** 18n)).toEqual({ approximate: false, exact: '2', text: '2.00' })
			expect(formatAmount(1_500_000n, { units: 6 })).toEqual({ approximate: false, exact: '1.5', text: '1.50' })
			expect(formatAmountDisplay(10_000n * 10n ** 18n, { notation: 'compact' })).toBe('10k')
		})

		void test('marks values whose dropped digits are non-zero', () => {
			expect(formatAmount(1_234_567n * 10n ** 15n)).toEqual({ approximate: true, exact: '1\u00a0234.567', text: '1\u00a0234.57' })
			expect(formatAmountDisplay(999_999_990_000n * 10n ** 18n, { notation: 'compact' })).toBe('≈ 1T')
			expect(formatAmountDisplay(1_234_000n * 10n ** 18n, { notation: 'compact' })).toBe('≈ 1.2M')
		})

		void test('keeps two significant digits for tiny values and marks only lossy ones', () => {
			expect(formatAmountDisplay(137_760_122n)).toBe('≈ 0.00000000014')
			expect(formatAmountDisplay(410_000_000_000_000n)).toBe('0.00041')
			// Two significant digits never need more decimals than the token has, so one attounit reads exactly.
			expect(formatAmountDisplay(1n)).toBe('0.000000000000000001')
			expect(formatAmountDisplay(12n)).toBe('0.000000000000000012')
			expect(formatAmountDisplay(5n, { units: 6 })).toBe('0.000005')
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

		void test('formatLocalTimestamp renders the viewer zone in the UTC layout and nothing when it matches UTC', () => {
			expect(formatLocalTimestamp(1_700_000_000n, 'America/New_York')).toBe('2023-11-14 17:13:20 EST')
			expect(formatLocalTimestamp(1_700_000_000n, 'Asia/Kolkata')).toBe('2023-11-15 03:43:20 GMT+5:30')
			expect(formatLocalTimestamp(1_700_000_000n, 'UTC')).toBeUndefined()
			expect(formatLocalTimestamp(1_700_000_000n, 'Europe/London')).toBeUndefined()
			expect(formatLocalTimestamp(10n ** 30n, 'America/New_York')).toBeUndefined()
		})

		void test('formatTimestamp preserves the immediate sentinel', () => {
			expect(formatTimestamp(0n)).toBe('Immediate')
		})

		void test('formatRelativeTimestamp renders now for an exact match', () => {
			expect(formatRelativeTimestamp(1_000n, 1_000n)).toBe('now')
		})

		void test('formatRelativeTimestamp counts down the final seconds', () => {
			expect(formatRelativeTimestamp(1_001n, 1_000n)).toBe('in 1s')
			expect(formatRelativeTimestamp(997n, 1_000n)).toBe('3s ago')
		})

		void test('formatRelativeTimestamp keeps the two largest units of longer durations', () => {
			expect(formatRelativeTimestamp(90_061n, 0n)).toBe('in 1d 1h')
		})

		void test('formatDuration shows the two largest non-zero units at a precision suited to the length', () => {
			const minute = 60n
			const hour = 60n * minute
			const day = 24n * hour
			expect(formatDuration(0n)).toBe('0s')
			expect(formatDuration(59n)).toBe('59s')
			expect(formatDuration(minute)).toBe('1m')
			expect(formatDuration(minute + 1n)).toBe('1m 1s')
			expect(formatDuration(2n * minute + 59n)).toBe('2m')
			expect(formatDuration(hour - 1n)).toBe('59m')
			expect(formatDuration(hour)).toBe('1h')
			expect(formatDuration(2n * hour + 5n * minute + 30n)).toBe('2h 5m')
			expect(formatDuration(day)).toBe('1d')
			expect(formatDuration(6n * day + 23n * hour + 59n * minute)).toBe('6d 23h')
			expect(formatDuration(60n * day + 5n * hour)).toBe('60d')
			expect(formatDuration(881n * day + 23n * hour + 59n * minute)).toBe('2y 151d')
			expect(formatDuration(3650n * day)).toBe('10y')
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
