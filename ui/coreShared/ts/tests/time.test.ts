/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getTimeRemaining } from '../lib/time.js'

void describe('time helpers', () => {
	void test('getTimeRemaining returns undefined when the target is absent', () => {
		expect(getTimeRemaining(undefined, 10n)).toBe(undefined)
	})

	void test('getTimeRemaining clamps past targets to zero', () => {
		expect(getTimeRemaining(10n, 12n)).toBe(0n)
	})

	void test('getTimeRemaining returns the positive difference for future targets', () => {
		expect(getTimeRemaining(15n, 12n)).toBe(3n)
	})
})
