/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { parseDecimalInput, parseDecimalInputResult, parseNonNegativeDecimalInput, tryParseNonNegativeDecimalInput } from '../forms/decimal.js'

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
		expect(() => parseDecimalInputResult('1', -1)).toThrow('Units must be a nonnegative safe integer')
	})

	void test('non-negative variants reject negative amounts with a field-level reason', () => {
		expect(tryParseNonNegativeDecimalInput('0', 18)).toBe(0n)
		expect(tryParseNonNegativeDecimalInput('-1', 18)).toBeUndefined()
		expect(parseNonNegativeDecimalInput(' 1.5 ', 2)).toBe(150n)
		expect(() => parseNonNegativeDecimalInput('1.234', 2)).toThrow('Use no more than 2 decimal places')
		expect(() => parseNonNegativeDecimalInput('-1', 2)).toThrow('Enter a valid nonnegative amount')
		expect(() => parseNonNegativeDecimalInput('.', 2)).toThrow('Enter a valid nonnegative amount')
	})
})
