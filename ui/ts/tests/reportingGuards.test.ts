/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'

describe('reporting guards', () => {
	test('blocks report submission for disconnected, unselected, and invalid amount states', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: undefined,
				contributionPreviewReason: undefined,
				isMainnet: true,
				remainingSelectedOutcomeCapacity: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
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
				remainingSelectedOutcomeCapacity: undefined,
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
				remainingSelectedOutcomeCapacity: undefined,
				reportAmount: '0',
				reportingStatus: 'active',
				selectedAmount: 0n,
				selectedOutcome: 'yes',
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
				remainingSelectedOutcomeCapacity: undefined,
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
				remainingSelectedOutcomeCapacity: undefined,
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
				remainingSelectedOutcomeCapacity: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBeUndefined()
	})

	test('leaves escalation timeout lifecycle handling to the shared action matrix', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				remainingSelectedOutcomeCapacity: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBeUndefined()
	})

	test('leaves non-decision lifecycle handling to the shared action matrix', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				remainingSelectedOutcomeCapacity: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
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
				remainingSelectedOutcomeCapacity: undefined,
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
				remainingSelectedOutcomeCapacity: undefined,
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
				remainingSelectedOutcomeCapacity: undefined,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 0n,
				viewerVaultExists: false,
			}),
		).toBe('Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.')
	})

	test('blocks reporting when the contribution would exceed the remaining selected-side threshold capacity', () => {
		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 5n * 10n ** 18n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				remainingSelectedOutcomeCapacity: 2n * 10n ** 18n,
				reportAmount: '5',
				reportingStatus: 'active',
				selectedAmount: 5n * 10n ** 18n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n * 10n ** 18n,
				viewerVaultExists: true,
			}),
		).toBe('Only 2 REP remains before the selected side reaches the threshold.')

		expect(
			getReportingReportGuardMessage({
				actualDepositAmount: 1n,
				accountAddress: zeroAddress,
				contributionPreviewReason: undefined,
				isMainnet: true,
				remainingSelectedOutcomeCapacity: 0n,
				reportAmount: '1',
				reportingStatus: 'active',
				selectedAmount: 1n,
				selectedOutcome: 'yes',
				viewerVaultAvailableEscalationRep: 10n,
				viewerVaultExists: true,
			}),
		).toBe('No remaining contribution capacity is available on the selected side.')
	})

	test('blocks withdraw submission when wallet or reporting prerequisites are missing', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: undefined,
				isMainnet: true,
				reportingStatus: 'active',
			}),
		).toBe('Connect a wallet before settling escalation deposits.')

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: false,
				reportingStatus: 'active',
			}),
		).toBeUndefined()

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				reportingStatus: 'missing',
			}),
		).toBe('Load reporting details before settling escalation deposits.')
	})

	test('leaves withdrawal lifecycle handling to the shared action matrix', () => {
		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				reportingStatus: 'active',
			}),
		).toBeUndefined()

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				reportingStatus: 'active',
			}),
		).toBeUndefined()

		expect(
			getReportingWithdrawGuardMessage({
				accountAddress: zeroAddress,
				isMainnet: true,
				reportingStatus: 'active',
			}),
		).toBeUndefined()
	})
})
