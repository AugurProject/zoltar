/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	getEscalationTimeRemaining,
	getEscalationPhase,
	getEscalationDepositClaimAmount,
	getImportedEscalationDepositClaimAmount,
	getRemainingSelectedOutcomeContributionCapacity,
	getReportingMaxProfitContribution,
	getReportingMinimumOutcomeChangeContribution,
	previewReportingContribution,
} from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingDomain.js'
import type { ActiveReportingDetails, MarketDetails, ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'

const ATTO_REP = 10n ** 18n

function rep(value: bigint) {
	return value * ATTO_REP
}

function createMarketDetails(): MarketDetails {
	return {
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
	}
}

function createReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		bindingCapital: rep(10n),
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: rep(20n),
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: rep(200n),
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThresholdAttoRep: rep(100n),
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		activationTime: 120n,
		startBondAttoRep: rep(3n),
		status: 'active',
		systemState: 'operational',
		totalCostAttoRep: rep(20n),
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 1n * ATTO_REP,
		viewerVaultRepBackingAttoRep: 11n * ATTO_REP,
		...overrides,
	}
}

function createNotStartedReportingDetails(overrides: Partial<Extract<ReportingDetails, { status: 'not-started' }>> = {}): ReportingDetails {
	return {
		settlementCollateralAttoEth: 1n,
		currentTime: 150n,
		forkThresholdAttoRep: rep(100n),
		marketDetails: createMarketDetails(),
		nonDecisionThresholdAttoRep: rep(50n),
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		startBondAttoRep: rep(3n),
		status: 'not-started',
		systemState: 'operational',
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 0n,
		viewerVaultRepBackingAttoRep: 10n * ATTO_REP,
		...overrides,
	}
}

describe('reportingDomain', () => {
	test('getEscalationPhase prioritizes non-decision before timeout', () => {
		const details = createReportingDetails({
			currentTime: 300n,
			escalationEndTime: 300n,
			hasReachedNonDecision: true,
		})

		expect(getEscalationPhase(details)).toBe('Fork Triggered')
	})

	test('reports no remaining escalation time after non-decision is reached', () => {
		const details = createReportingDetails({
			currentTime: 300n,
			escalationEndTime: 2n ** 255n,
			hasReachedNonDecision: true,
		})

		expect(getEscalationTimeRemaining(details)).toBe(0n)
	})

	test('getEscalationPhase keeps the exact timeout boundary active and times out one second later', () => {
		expect(
			getEscalationPhase(
				createReportingDetails({
					currentTime: 300n,
					escalationEndTime: 300n,
				}),
			),
		).toBe('Active')

		expect(
			getEscalationPhase(
				createReportingDetails({
					currentTime: 301n,
					escalationEndTime: 300n,
				}),
			),
		).toBe('Timed Out')
	})

	test('getReportingMinimumOutcomeChangeContribution returns the smallest strict lead', () => {
		expect(getReportingMinimumOutcomeChangeContribution(createReportingDetails(), 'yes')).toEqual({
			amountAttoRep: rep(4n),
			reason: undefined,
		})
	})

	test('getReportingMinimumOutcomeChangeContribution returns 1001 REP for 1000 REP on yes and no selected', () => {
		const details = createReportingDetails({
			currentRequiredBond: rep(1_000n),
			nonDecisionThresholdAttoRep: rep(2_000n),
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(1_000n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBondAttoRep: rep(1n),
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amountAttoRep: rep(1_001n),
			reason: undefined,
		})
	})

	test('getReportingMinimumOutcomeChangeContribution respects startBondAttoRep when the lead delta is smaller than the minimum report', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBondAttoRep: rep(3n),
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amountAttoRep: rep(3n),
			reason: undefined,
		})
	})

	test('getReportingMinimumOutcomeChangeContribution disables the preset when the question already resolved', () => {
		const details = createReportingDetails({
			questionOutcome: 'yes',
			sides: [
				{ balance: rep(9n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amountAttoRep: undefined,
			reason: 'Escalation is already resolved.',
		})
	})

	test('getImportedEscalationDepositClaimAmount stays pending until pool-level question finalization', () => {
		const details = createReportingDetails({
			questionOutcome: 'none',
			sides: [
				{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{
					balance: rep(5n),
					deposits: [],
					importedUserDeposits: [
						{
							amountAttoRep: rep(2n),
							cumulativeAmountAttoRep: rep(1n),
							depositor: zeroAddress,
							parentDepositIndex: 7n,
						},
					],
					key: 'yes',
					label: 'Yes',
					userDeposits: [],
				},
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(
			getImportedEscalationDepositClaimAmount(details, 'yes', {
				amountAttoRep: rep(2n),
				cumulativeAmountAttoRep: rep(1n),
				depositor: zeroAddress,
				parentDepositIndex: 7n,
			}),
		).toBeUndefined()
	})

	test('getImportedEscalationDepositClaimAmount stays pending when a child outcome is known before the pool becomes operational', () => {
		const details = createReportingDetails({
			questionOutcome: 'yes',
			systemState: 'forkTruthAuction',
			sides: [
				{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{
					balance: rep(5n),
					deposits: [],
					importedUserDeposits: [
						{
							amountAttoRep: rep(2n),
							cumulativeAmountAttoRep: rep(1n),
							depositor: zeroAddress,
							parentDepositIndex: 7n,
						},
					],
					key: 'yes',
					label: 'Yes',
					userDeposits: [],
				},
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(
			getImportedEscalationDepositClaimAmount(details, 'yes', {
				amountAttoRep: rep(2n),
				cumulativeAmountAttoRep: rep(1n),
				depositor: zeroAddress,
				parentDepositIndex: 7n,
			}),
		).toBeUndefined()
	})

	test('getImportedEscalationDepositClaimAmount treats imported cumulative depth as the post-deposit boundary', () => {
		const details = createReportingDetails({
			bindingCapital: rep(20n),
			questionOutcome: 'yes',
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{
					balance: rep(34n),
					deposits: [],
					importedUserDeposits: [],
					key: 'yes',
					label: 'Yes',
					userDeposits: [],
				},
				{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(
			getImportedEscalationDepositClaimAmount(details, 'yes', {
				amountAttoRep: rep(14n),
				cumulativeAmountAttoRep: rep(34n),
				depositor: zeroAddress,
				parentDepositIndex: 1n,
			}),
		).toBe(rep(18n))
	})

	test('getReportingMinimumOutcomeChangeContribution disables the preset when the selected side already leads', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(9n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amountAttoRep: undefined,
			reason: 'Selected side already leads.',
		})
	})

	test('getReportingMinimumOutcomeChangeContribution falls back to the remaining threshold room when the selected side cannot take the lead', () => {
		const details = createReportingDetails({
			nonDecisionThresholdAttoRep: rep(20n),
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(19n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBondAttoRep: rep(1n),
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amountAttoRep: rep(1n),
			reason: undefined,
		})
	})

	test('getReportingMaxProfitContribution fills the remaining reward window', () => {
		expect(getReportingMaxProfitContribution(createReportingDetails(), 'yes')).toEqual({
			amountAttoRep: rep(7n),
			reason: undefined,
		})
	})

	test('getReportingMaxProfitContribution returns 1500 REP for 1000 REP on yes and no selected', () => {
		const details = createReportingDetails({
			currentRequiredBond: rep(1_000n),
			nonDecisionThresholdAttoRep: rep(2_000n),
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(1_000n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBondAttoRep: rep(1n),
		})

		expect(getReportingMaxProfitContribution(details, 'no')).toEqual({
			amountAttoRep: rep(1_500n),
			reason: undefined,
		})
	})

	test('getReportingMaxProfitContribution is unavailable when the reward window is already filled', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(15n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(getReportingMaxProfitContribution(details, 'yes')).toEqual({
			amountAttoRep: undefined,
			reason: 'Max profit preset unavailable because the reward window is already filled on the selected side.',
		})
	})

	test('getReportingMaxProfitContribution reports unavailable when the selected side is not present', () => {
		expect(
			getReportingMaxProfitContribution(
				createReportingDetails({
					sides: [
						{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
					],
				}),
				'invalid',
			),
		).toEqual({
			amountAttoRep: undefined,
			reason: 'Selected side is unavailable.',
		})
	})

	test('projecting an invalid-side report preserves branch coverage in balance recalculation helpers', () => {
		const details = createReportingDetails({
			nonDecisionThresholdAttoRep: rep(5000n),
			sides: [
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(4n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBondAttoRep: rep(1n),
		})

		expect(previewReportingContribution(details, 'invalid', rep(1n))).toEqual({
			actualDepositAmount: rep(1n),
			reason: undefined,
		})
	})

	test('getReportingMinimumOutcomeChangeContribution returns the first-report minimum before the escalation game exists', () => {
		expect(getReportingMinimumOutcomeChangeContribution(createNotStartedReportingDetails(), 'yes')).toEqual({
			amountAttoRep: rep(3n),
			reason: undefined,
		})
	})

	test('getReportingMaxProfitContribution is unavailable before the escalation game exists', () => {
		expect(getReportingMaxProfitContribution(createNotStartedReportingDetails(), 'yes')).toEqual({
			amountAttoRep: undefined,
			reason: 'Max profit becomes available after the escalation game starts.',
		})
	})

	test('reporting preset helpers disable both presets once the escalation game is resolved', () => {
		const details = createReportingDetails({
			questionOutcome: 'yes',
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amountAttoRep: undefined,
			reason: 'Escalation is already resolved.',
		})
		expect(getReportingMaxProfitContribution(details, 'yes')).toEqual({
			amountAttoRep: undefined,
			reason: 'Escalation is already resolved.',
		})
	})

	test('previewReportingContribution rejects a pre-start amount below the first-report minimum', () => {
		expect(previewReportingContribution(createNotStartedReportingDetails(), 'yes', rep(2n))).toEqual({
			actualDepositAmount: undefined,
			reason: 'Enter at least 3\u00a0REP to start the escalation game.',
		})
	})

	test('previewReportingContribution accepts a valid pre-start amount', () => {
		expect(previewReportingContribution(createNotStartedReportingDetails(), 'yes', rep(3n))).toEqual({
			actualDepositAmount: rep(3n),
			reason: undefined,
		})
	})

	test('throws a clear error when escalation timing inputs are malformed', () => {
		expect(() =>
			getEscalationTimeRemaining({
				...createReportingDetails(),
				escalationEndTime: undefined as unknown as bigint,
			}),
		).toThrow('Escalation end time is required')
	})

	test('returns reward-window metadata in no-op forms and missing-side paths', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(3n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			],
		})
		expect(getRemainingSelectedOutcomeContributionCapacity(details, 'no')).toBe(0n)
		expect(getRemainingSelectedOutcomeContributionCapacity({ ...details, nonDecisionThresholdAttoRep: rep(20n) }, 'invalid')).toBe(rep(18n))
	})

	test('preview helpers return zero-state messages for resolved and full-side states', () => {
		expect(
			previewReportingContribution(
				{
					...createReportingDetails(),
					questionOutcome: 'yes',
				},
				'yes',
				rep(1n),
			),
		).toEqual({
			actualDepositAmount: undefined,
			reason: 'Escalation is already resolved.',
		})
		expect(
			previewReportingContribution(
				{
					...createReportingDetails(),
					nonDecisionThresholdAttoRep: rep(10n),
					sides: [
						{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
					],
				},
				'yes',
				rep(1n),
			),
		).toEqual({
			actualDepositAmount: undefined,
			reason: 'Selected side is already full at 10\u00a0REP.',
		})
	})

	test('uses the reward floor when the selected resolved side has no reward-eligible principal', () => {
		const details = createReportingDetails({
			questionOutcome: 'yes',
			parentWithdrawalEnabled: true,
			settlementState: 'resolved',
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(
			getEscalationDepositClaimAmount(details, 'yes', {
				amountAttoRep: rep(1n),
				cumulativeAmountAttoRep: rep(1n),
				depositIndex: 0n,
				depositor: zeroAddress,
			}),
		).toBe(rep(1n))
	})

	test('returns selected-side lookup errors for missing active reporting sides', () => {
		expect(
			previewReportingContribution(
				{
					...createReportingDetails(),
					sides: [
						{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
					],
				},
				'yes',
				rep(1n),
			),
		).toEqual({
			actualDepositAmount: undefined,
			reason: 'Select a valid reporting outcome.',
		})
	})
})
