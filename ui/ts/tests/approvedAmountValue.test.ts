/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { maxUint256 } from 'viem'
import { APPROVAL_MAX_DISPLAY_THRESHOLD, isApprovalAmountMaxDisplay } from '../components/ApprovedAmountValue.js'

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
})
