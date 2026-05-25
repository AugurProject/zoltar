/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import type { ActiveReportingDetails } from '../types/contracts.js'

function createActiveReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		bindingCapital: 10n,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThreshold: 40n,
		hasReachedNonDecision: false,
		marketDetails: {
			answerUnit: '',
			createdAt: 1n,
			description: 'Question description',
			displayValueMax: 100n,
			displayValueMin: 0n,
			endTime: 100n,
			exists: true,
			marketType: 'binary',
			numTicks: 2n,
			outcomeLabels: ['Yes', 'No'],
			questionId: '0x01',
			startTime: 1n,
			title: 'Will this resolve?',
		},
		nonDecisionThreshold: 20n,
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: 5n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		activationTime: 120n,
		startBond: 1n,
		status: 'active',
		totalCost: 2n,
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 0n,
		viewerVaultRepDepositShare: 10n,
		...overrides,
	}
}

describe('reporting guards', () => {
	test('blocks report submission for locked, disconnected, unselected, and invalid amount states', () => {
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
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
			}),
		).toBe('Connect a wallet before reporting on a market.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: undefined,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: undefined,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Select an outcome side before reporting on a market.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '0',
				reportingStatus: 'active',
				selectedAmount: 0n,
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBeUndefined()
	})

	test('blocks reporting once the escalation timeout is reached', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				activeReportingDetails: createActiveReportingDetails({
					currentTime: 300n,
					escalationEndTime: 300n,
				}),
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Reporting is closed because the escalation timeout has been reached.')
	})

	test('blocks reporting once non-decision moves escalation into the fork workflow', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				activeReportingDetails: createActiveReportingDetails({
					currentTime: 300n,
					escalationEndTime: 300n,
					hasReachedNonDecision: true,
				}),
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				lockedReason: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('Reporting is closed because escalation reached non-decision and moved into the fork workflow.')
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
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 0n,
				viewerVaultExists: false,
			}),
		).toBe('Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.')
	})

	test('blocks withdraw submission until an outcome is selected and that side has deposits', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'not-started',
				selectedOutcome: 'yes',
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
				selectedOutcome: undefined,
				withdrawalEnabled: true,
				withdrawalState: 'resolved',
			}),
		).toBe('Select an outcome side before withdrawing escalation deposits.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: false,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
			}),
		).toBeUndefined()
	})

	test('blocks withdraw submission until the contract allows it', () => {
		expect(
			getReportingWithdrawGuardMessage({
				activeReportingDetails: createActiveReportingDetails({
					hasReachedNonDecision: true,
				}),
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				selectedOutcome: 'yes',
				withdrawalEnabled: false,
				withdrawalState: 'not-finalized',
			}),
		).toBe('Escalation deposits move through the Fork workflow after non-decision; they cannot be withdrawn from this panel.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasUserDepositsOnSelectedSide: true,
				isMainnet: true,
				lockedReason: undefined,
				reportingStatus: 'active',
				selectedOutcome: 'yes',
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
				selectedOutcome: 'yes',
				withdrawalEnabled: true,
				withdrawalState: 'canceled-by-external-fork',
			}),
		).toBeUndefined()
	})
})
