/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getVisualRatio } from '../lib/visualMetrics.js'

void describe('visual metric helpers', () => {
	void test('computes bounded ratios without converting unbounded operands to numbers', () => {
		const value = 3n * BigInt(Number.MAX_SAFE_INTEGER) ** 2n
		const maxValue = 5n * BigInt(Number.MAX_SAFE_INTEGER) ** 2n

		expect(getVisualRatio({ value, maxValue })).toBe(0.6)
	})

	void test('clamps visual ratios at one for values above the maximum', () => {
		expect(getVisualRatio({ value: 10n ** 80n, maxValue: 1n })).toBe(1)
	})
})
