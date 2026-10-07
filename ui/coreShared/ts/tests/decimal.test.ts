/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getDecimalSeparatorError, getLocaleDecimalSeparator, parseDecimalInput, parseDecimalInputResult, parseNonNegativeDecimalInput, tryParseDecimalInput, tryParseNonNegativeDecimalInput } from '../forms/decimal.js'

void describe('decimal helpers', () => {
	void test('parseDecimalInput accepts trimmed decimals and normalizes leading or trailing dots', () => {
		expect(parseDecimalInput('1.25', 'Price', 18)).toBe(1_250_000_000_000_000_000n)
		expect(parseDecimalInput(' .5 ', 'Price', 18)).toBe(500_000_000_000_000_000n)
		expect(parseDecimalInput('5.', 'Price', 18)).toBe(5_000_000_000_000_000_000n)
		expect(parseDecimalInput('2 550 000', 'Price', 18)).toBe(2_550_000n * 10n ** 18n)
		expect(parseDecimalInput('2 550 000.25', 'Price', 18)).toBe(2_550_000_250_000_000_000_000_000n)
		expect(parseDecimalInput('1.0000000000000000000', 'Price', 18)).toBe(1_000_000_000_000_000_000n)
	})

	void test('parseDecimalInput rejects empty or invalid input', () => {
		expect(() => parseDecimalInput('', 'Price', 18)).toThrow('Price is required')
		expect(() => parseDecimalInput('.', 'Price', 18)).toThrow('Price must be a decimal number')
		expect(() => parseDecimalInput('-.', 'Price', 18)).toThrow('Price must be a decimal number')
		expect(() => parseDecimalInput('not-a-number', 'Price', 18)).toThrow('Price must be a decimal number')
		expect(() => parseDecimalInput('1.0000000000000000001', 'Price', 18)).toThrow('Price must be a decimal number')
	})

	void test('parseDecimalInputResult names the rejection reason', () => {
		expect(parseDecimalInputResult('', 18)).toEqual({ problem: 'empty' })
		expect(parseDecimalInputResult('abc', 18)).toEqual({ problem: 'invalid' })
		expect(parseDecimalInputResult('1.001', 2)).toEqual({ problem: 'precision' })
		expect(parseDecimalInputResult('1.100', 2)).toEqual({ value: 110n })
		expect(() => parseDecimalInputResult('1', -1)).toThrow('Units must be a non-negative safe integer')
	})

	void test('reads the decimal separator from the locale', () => {
		expect(getLocaleDecimalSeparator('de-DE')).toBe(',')
		expect(getLocaleDecimalSeparator('fr-FR')).toBe(',')
		expect(getLocaleDecimalSeparator('en-US')).toBe('.')
		expect(getLocaleDecimalSeparator('en-GB')).toBe('.')
	})

	void test('accepts one comma as the decimal separator only where the locale writes decimals with a comma', () => {
		expect(parseDecimalInputResult('1,5', 18, ',')).toEqual({ value: 1_500_000_000_000_000_000n })
		expect(parseDecimalInputResult(',5', 2, ',')).toEqual({ value: 50n })
		expect(parseDecimalInputResult('5,', 2, ',')).toEqual({ value: 500n })
		expect(parseDecimalInputResult('-1,25', 2, ',')).toEqual({ value: -125n })
		expect(parseDecimalInputResult('1 234,5', 2, ',')).toEqual({ value: 123_450n })
		expect(parseDecimalInputResult('1,001', 2, ',')).toEqual({ problem: 'precision' })
		// A period stays a decimal separator in every locale, so existing input keeps its meaning.
		expect(parseDecimalInputResult('1.5', 2, ',')).toEqual({ value: 150n })
		expect(tryParseDecimalInput('1,5', 2, ',')).toBe(150n)
		expect(tryParseNonNegativeDecimalInput('0,5', 2, ',')).toBe(50n)
	})

	void test('never reads a comma as a decimal point where it groups thousands', () => {
		// In en-US, 1,234 means one thousand two hundred thirty-four; reading it as 1.234 would silently shrink the amount.
		expect(parseDecimalInputResult('1,234', 18, '.')).toEqual({ problem: 'separator' })
		expect(parseDecimalInputResult('1,5', 18, '.')).toEqual({ problem: 'separator' })
		expect(tryParseDecimalInput('1,234', 18, '.')).toBeUndefined()
	})

	void test('rejects mixed or repeated separators in every locale', () => {
		for (const separator of ['.', ','] as const) {
			expect(parseDecimalInputResult('1,234.56', 18, separator)).toEqual({ problem: 'separator' })
			expect(parseDecimalInputResult('1.234,56', 18, separator)).toEqual({ problem: 'separator' })
			expect(parseDecimalInputResult('1,234,567', 18, separator)).toEqual({ problem: 'separator' })
			expect(parseDecimalInputResult('1.234.567', 18, separator)).toEqual({ problem: 'separator' })
			expect(parseDecimalInputResult('1..5', 18, separator)).toEqual({ problem: 'separator' })
			expect(parseDecimalInputResult(',,', 18, separator)).toEqual({ problem: 'separator' })
		}
	})

	void test('names the separator rule in rejection messages', () => {
		expect(getDecimalSeparatorError(',')).toBe('Use a period or comma as the decimal separator, without thousands separators.')
		expect(getDecimalSeparatorError('.')).toBe('Use a period as the decimal separator, without thousands separators.')
		expect(() => parseDecimalInput('1,234.5', 'Price', 18, '.')).toThrow('Price must be a decimal number. Use a period as the decimal separator, without thousands separators.')
		expect(() => parseNonNegativeDecimalInput('1,2,3', 2, ',')).toThrow('Use a period or comma as the decimal separator, without thousands separators.')
		expect(parseDecimalInput('2,5', 'Price', 2, ',')).toBe(250n)
	})

	void test('non-negative variants reject negative amounts with a field-level reason', () => {
		expect(tryParseNonNegativeDecimalInput('0', 18)).toBe(0n)
		expect(tryParseNonNegativeDecimalInput('-1', 18)).toBeUndefined()
		expect(parseNonNegativeDecimalInput(' 1.5 ', 2)).toBe(150n)
		expect(() => parseNonNegativeDecimalInput('1.234', 2)).toThrow('Use no more than 2 decimal places')
		expect(() => parseNonNegativeDecimalInput('-1', 2)).toThrow('Enter a valid non-negative amount')
		expect(() => parseNonNegativeDecimalInput('.', 2)).toThrow('Enter a valid non-negative amount')
	})
})
