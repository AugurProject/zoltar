/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { parseDecimalInput } from '../lib/decimal.js'

void describe('decimal helpers', () => {
	void test('parseDecimalInput accepts trimmed decimals and normalizes leading or trailing dots', () => {
		expect(parseDecimalInput('1.25', 'Price', 18)).toBe(1_250_000_000_000_000_000n)
		expect(parseDecimalInput(' .5 ', 'Price', 18)).toBe(500_000_000_000_000_000n)
		expect(parseDecimalInput('5.', 'Price', 18)).toBe(5_000_000_000_000_000_000n)
	})

	void test('parseDecimalInput rejects empty or invalid input', () => {
		expect(() => parseDecimalInput('', 'Price', 18)).toThrow('Price is required')
		expect(() => parseDecimalInput('not-a-number', 'Price', 18)).toThrow('Price must be a decimal number')
	})
})
