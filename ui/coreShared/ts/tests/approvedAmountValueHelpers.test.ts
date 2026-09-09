/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getApprovedAmountTone } from '../components/ApprovedAmountValue.js'

void describe('ApprovedAmountValue helpers', () => {
	void test('reports whether the approved amount satisfies the required amount', () => {
		expect(getApprovedAmountTone(25n, 25n)).toBe('sufficient')
		expect(getApprovedAmountTone(26n, 25n)).toBe('sufficient')
		expect(getApprovedAmountTone(24n, 25n)).toBe('insufficient')
		expect(getApprovedAmountTone(undefined, 25n)).toBe(undefined)
		expect(getApprovedAmountTone(25n, undefined)).toBe(undefined)
	})
})
