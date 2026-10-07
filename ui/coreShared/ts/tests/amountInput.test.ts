/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatAmountForDisplay, getAmountInputErrorMessage, getAmountPreset, validateAmountInput, type AmountInputLimits } from '../forms/amountInput.js'

const ONE = 10n ** 18n

function messageFor(value: string, limits: AmountInputLimits & { unit?: string } = {}) {
	return getAmountInputErrorMessage(validateAmountInput(value, limits), limits)
}

void describe('amount input validation', () => {
	void test('treats blank input as empty rather than invalid', () => {
		expect(validateAmountInput('')).toEqual({ status: 'empty' })
		expect(validateAmountInput('   ')).toEqual({ status: 'empty' })
		expect(messageFor('')).toBeUndefined()
	})

	void test('parses decimals with the token decimals', () => {
		expect(validateAmountInput('1.5')).toEqual({ status: 'valid', amount: (3n * ONE) / 2n })
		expect(validateAmountInput('1 200')).toEqual({ status: 'valid', amount: 1200n * ONE })
		expect(validateAmountInput('.25', { decimals: 6 })).toEqual({ status: 'valid', amount: 250_000n })
		expect(validateAmountInput('1.1234567', { decimals: 6 })).toEqual({ status: 'invalid', problem: 'precision' })
		expect(messageFor('1.1234567', { decimals: 6 })).toBe('Use no more than 6 decimal places.')
	})

	void test('rejects malformed, negative, and zero amounts with a message for each', () => {
		expect(validateAmountInput('abc')).toEqual({ status: 'invalid', problem: 'invalid' })
		expect(messageFor('1e5')).toBe('Enter a number, such as 1.5.')
		expect(validateAmountInput('-1')).toEqual({ status: 'invalid', problem: 'negative', amount: -ONE })
		expect(messageFor('-1', { allowZero: true })).toBe('Enter a valid non-negative amount.')
		expect(validateAmountInput('0', { allowZero: true })).toEqual({ status: 'valid', amount: 0n })
		// An invalid amount always has text, so a field never turns red without saying why.
		expect(validateAmountInput('0')).toEqual({ status: 'invalid', problem: 'zero', amount: 0n })
		expect(messageFor('0')).toBe('Enter an amount greater than 0.')
		expect(messageFor('0.0')).toBe('Enter an amount greater than 0.')
		expect(messageFor('-5')).toBe('Enter an amount greater than 0.')
	})

	void test('accepts a locale decimal comma and explains a rejected separator', () => {
		expect(validateAmountInput('1,5', { decimalSeparator: ',' })).toEqual({ status: 'valid', amount: (3n * ONE) / 2n })
		expect(validateAmountInput('1,234', { decimalSeparator: '.' })).toEqual({ status: 'invalid', problem: 'separator' })
		expect(messageFor('1,234', { decimalSeparator: '.' })).toBe('Use a period as the decimal separator, without thousands separators.')
		expect(messageFor('1,234.56', { decimalSeparator: ',' })).toBe('Use a period or comma as the decimal separator, without thousands separators.')
	})

	void test('checks the minimum, balance, and maximum in that order', () => {
		const limits = { balance: 10n * ONE, maximum: 5n * ONE, minimum: ONE, unit: 'REP' }
		expect(validateAmountInput('0.5', limits)).toEqual({ status: 'invalid', problem: 'belowMinimum', amount: ONE / 2n })
		expect(messageFor('0.5', limits)).toBe('Enter at least 1 REP.')
		expect(validateAmountInput('11', limits)).toEqual({ status: 'invalid', problem: 'exceedsBalance', amount: 11n * ONE })
		expect(messageFor('11', limits)).toBe('Exceeds your balance of 10 REP.')
		expect(validateAmountInput('6', limits)).toEqual({ status: 'invalid', problem: 'aboveMaximum', amount: 6n * ONE })
		expect(messageFor('6', limits)).toBe('Enter at most 5 REP.')
		expect(validateAmountInput('5', limits)).toEqual({ status: 'valid', amount: 5n * ONE })
		expect(messageFor('5', limits)).toBeUndefined()
	})

	void test('formats bounds with grouping, truncated precision, and the unit', () => {
		expect(formatAmountForDisplay(1_200n * ONE + ONE / 3n, 18, 'REP')).toBe('≈ 1\u00a0200.3333 REP')
		expect(formatAmountForDisplay(1_500_000n, 6)).toBe('1.5')
		expect(formatAmountForDisplay(12n, 0, 'sets')).toBe('12 sets')
		expect(messageFor('1', { minimum: ONE + 1n })).toBe('Enter at least 1.000000000000000001.')
	})

	void test('marks truncated hints, never reads above the exact amount, and shows dust exactly', () => {
		// Truncation keeps a limit at or below the exact amount a user may type back.
		expect(formatAmountForDisplay((199_999n * ONE) / 100_000n, 18, 'REP')).toBe('≈ 1.9999 REP')
		expect(formatAmountForDisplay(2n * ONE, 18, 'REP')).toBe('2 REP')
		// A dust balance would otherwise read 0 REP while Max fills a non-zero amount.
		expect(formatAmountForDisplay(12_340_000_000_000n, 18, 'REP')).toBe('0.00001234 REP')
		expect(formatAmountForDisplay(1n, 18)).toBe('0.000000000000000001')
		expect(formatAmountForDisplay(0n, 18, 'REP')).toBe('0 REP')
		expect(messageFor('2', { balance: (199_999n * ONE) / 100_000n, unit: 'REP' })).toBe('Exceeds your balance of ≈ 1.9999 REP.')
	})

	void test('computes percentage presets without exceeding the source amount', () => {
		expect(getAmountPreset(1001n, 50)).toBe(500n)
		expect(getAmountPreset(1001n, 100)).toBe(1001n)
		expect(getAmountPreset(1001n, 0)).toBe(0n)
		expect(() => getAmountPreset(1n, 101)).toThrow('Preset percent must be an integer from 0 to 100')
		expect(() => getAmountPreset(1n, 12.5)).toThrow('Preset percent must be an integer from 0 to 100')
	})
})
