/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { maxUint256 } from 'viem'
import { APPROVAL_MAX_DISPLAY_THRESHOLD, APPROVAL_MAX_LABEL, getApprovedAmountTone, isApprovalAmountMaxDisplay } from '../components/ApprovedAmountValue.js'

void describe('ApprovedAmountValue helpers', () => {
	void test('treats maxUint256 as max display', () => {
		expect(isApprovalAmountMaxDisplay(maxUint256)).toBe(true)
	})

	void test('treats values above maxUint200 as max display', () => {
		expect(isApprovalAmountMaxDisplay(APPROVAL_MAX_DISPLAY_THRESHOLD + 1n)).toBe(true)
	})

	void test('keeps maxUint200 itself numeric', () => {
		expect(isApprovalAmountMaxDisplay(APPROVAL_MAX_DISPLAY_THRESHOLD)).toBe(false)
	})

	void test('uses a capitalized Max label for unlimited approval display', () => {
		expect(APPROVAL_MAX_LABEL).toBe('Max')
	})

	void test('reports whether the approved amount satisfies the required amount', () => {
		expect(getApprovedAmountTone(25n, 25n)).toBe('sufficient')
		expect(getApprovedAmountTone(26n, 25n)).toBe('sufficient')
		expect(getApprovedAmountTone(24n, 25n)).toBe('insufficient')
		expect(getApprovedAmountTone(undefined, 25n)).toBe(undefined)
		expect(getApprovedAmountTone(25n, undefined)).toBe(undefined)
	})
})
