/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { applyReportingFormUpdate } from '../lib/reportingForm.js'
import type { ReportingFormState } from '../types/app.js'

function createReportingFormState(): ReportingFormState {
	return {
		reportAmount: '10',
		securityPoolAddress: '0x0000000000000000000000000000000000000001',
		selectedOutcome: 'yes',
		selectedWithdrawDepositIndexesByOutcome: {
			invalid: [3n],
			yes: [1n, 2n],
			no: [4n],
		},
	}
}

describe('reporting form updates', () => {
	test('clears the selected outcome and withdraw selections when the reporting pool address changes', () => {
		expect(
			applyReportingFormUpdate(createReportingFormState(), {
				securityPoolAddress: '0x0000000000000000000000000000000000000002',
			}),
		).toEqual({
			reportAmount: '10',
			securityPoolAddress: '0x0000000000000000000000000000000000000002',
			selectedOutcome: undefined,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [],
				yes: [],
				no: [],
			},
		})
	})

	test('keeps the selected outcome and withdraw selections when the reporting pool address is unchanged', () => {
		expect(
			applyReportingFormUpdate(createReportingFormState(), {
				reportAmount: '12',
				securityPoolAddress: '0x0000000000000000000000000000000000000001',
			}),
		).toEqual({
			reportAmount: '12',
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			selectedOutcome: 'yes',
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [3n],
				yes: [1n, 2n],
				no: [4n],
			},
		})
	})

	test('preserves withdraw selections when only the selected outcome changes', () => {
		expect(
			applyReportingFormUpdate(createReportingFormState(), {
				selectedOutcome: 'no',
			}),
		).toEqual({
			reportAmount: '10',
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			selectedOutcome: 'no',
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [3n],
				yes: [1n, 2n],
				no: [4n],
			},
		})
	})

	test('returns the current form for no-op pool-address sync updates', () => {
		const current = createReportingFormState()
		expect(
			applyReportingFormUpdate(current, {
				securityPoolAddress: '0x0000000000000000000000000000000000000001',
			}),
		).toBe(current)
	})
})
