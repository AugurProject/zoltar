/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'

describe('reporting guards', () => {
	test('blocks report submission for locked, disconnected, and invalid amount states', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: 'Reporting opens after market end.',
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Reporting opens after market end.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: undefined,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Connect a wallet before reporting on a market.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: undefined,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '0',
				reportingStatus: 'active',
				selectedAmount: 0n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Enter a valid report amount greater than zero.')
	})

	test('allows reporting once the game is not-started or active, but blocks it while details are missing', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'missing',
				selectedAmount: 1n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Load reporting details before reporting on an outcome.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'not-started',
				selectedAmount: 1n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBeUndefined()

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBeUndefined()
	})

	test('blocks reporting when the vault lacks unlocked REP or the contribution preview is invalid', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 5n * 10n ** 18n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '5',
				reportingStatus: 'active',
				selectedAmount: 5n * 10n ** 18n,
				viewerVaultAvailableEscalationRep: 2n * 10n ** 18n,
				viewerVaultExists: true,
			}),
		).toBe('Need 3 more unlocked REP in your vault before reporting.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: undefined,
				accountAddress: zeroAddress,
				contributionPreviewReason: 'Increase the report amount slightly to avoid a tie at the minimum bond.',
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n * 10n ** 18n,
				viewerVaultAvailableEscalationRep: 10n * 10n ** 18n,
				viewerVaultExists: true,
			}),
		).toBe('Increase the report amount slightly to avoid a tie at the minimum bond.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				viewerVaultAvailableEscalationRep: 0n,
				viewerVaultExists: false,
			}),
		).toBe('Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.')
	})

	test('blocks withdraw submission until the escalation game is active and the selected side has deposits', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'not-started',
				withdrawalEnabled: false,
				withdrawalState: 'not-finalized',
			}),
		).toBe('Withdrawals are unavailable until the first report or contribution deploys the escalation game.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: false,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				withdrawalEnabled: true,
				withdrawalState: 'resolved',
			}),
		).toBe('No deposits are available to withdraw on the selected side.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				withdrawalEnabled: true,
				withdrawalState: 'resolved',
			}),
		).toBeUndefined()
	})

	test('blocks withdraw submission until the contract allows it', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				withdrawalEnabled: false,
				withdrawalState: 'not-finalized',
			}),
		).toBe('Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				withdrawalEnabled: true,
				withdrawalState: 'canceled-by-external-fork',
			}),
		).toBeUndefined()
	})
})
