/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'

describe('reporting guards', () => {
	test('blocks report submission for locked, disconnected, and invalid amount states', () => {
		expect(
			getReportingReportGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				lockedReason: 'Reporting opens after market end.',
				reportAmount: '1',
				reportingDetailsLoaded: true,
				selectedAmount: 1n,
			}),
		).toBe('Reporting opens after market end.')

		expect(
			getReportingReportGuardMessage({
				accountAddress: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingDetailsLoaded: true,
				selectedAmount: 1n,
			}),
		).toBe('Connect a wallet before reporting on a market.')

		expect(
			getReportingReportGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '0',
				reportingDetailsLoaded: true,
				selectedAmount: 0n,
			}),
		).toBe('Enter a valid report amount greater than zero.')
	})

	test('blocks withdraw submission until the selected side has deposits', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: false,
				isMainnet: true,
				lockedReason: undefined,
				reportingDetailsLoaded: true,
			}),
		).toBe('No deposits are available to withdraw on the selected side.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingDetailsLoaded: true,
			}),
		).toBeUndefined()
	})
})
