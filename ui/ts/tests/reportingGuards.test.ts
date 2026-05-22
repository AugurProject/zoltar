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
				reportingStatus: 'active',
				selectedAmount: 1n,
			}),
		).toBe('Reporting opens after market end.')

		expect(
			getReportingReportGuardMessage({
				accountAddress: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
			}),
		).toBe('Connect a wallet before reporting on a market.')

		expect(
			getReportingReportGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '0',
				reportingStatus: 'active',
				selectedAmount: 0n,
			}),
		).toBe('Enter a valid report amount greater than zero.')
	})

	test('allows reporting once the game is not-started or active, but blocks it while details are missing', () => {
		expect(
			getReportingReportGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'missing',
				selectedAmount: 1n,
			}),
		).toBe('Load reporting details before reporting on an outcome.')

		expect(
			getReportingReportGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'not-started',
				selectedAmount: 1n,
			}),
		).toBeUndefined()

		expect(
			getReportingReportGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
			}),
		).toBeUndefined()
	})

	test('blocks withdraw submission until the escalation game is active and the selected side has deposits', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'not-started',
			}),
		).toBe('Escalation game has not started yet.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: false,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
			}),
		).toBe('No deposits are available to withdraw on the selected side.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
			}),
		).toBeUndefined()
	})
})
