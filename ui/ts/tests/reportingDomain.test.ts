/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import {
	ESCALATION_GAME_ACTIVATION_DELAY,
	calculateEstimatedEscalationReturn,
	computeEscalationTimeSinceStartFromAttritionCost,
	getEscalationBalanceTuple,
	getEscalationBindingCapital,
	getEscalationTimeRemaining,
	getEscalationPhase,
	getEscalationDepositClaimAmount,
	getImportedEscalationDepositClaimAmount,
	getMaxProfitContribution,
	getMinimumOutcomeChangeContribution,
	getRemainingSelectedOutcomeContributionCapacity,
	getReportingMaxProfitContribution,
	getReportingMinimumOutcomeChangeContribution,
	getReportingTimerPreview,
	getSelectedOutcomeRewardWindowFillTimestamp,
	isReportingClosed,
	previewReportingContribution,
	projectEscalationEndTime,
} from '../lib/reportingDomain.js'
import type { ActiveReportingDetails, MarketDetails, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'

const REP = 10n ** 18n

function rep(value: bigint) {
	return value * REP
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
		completeSetCollateralAmount: 1n,
		currentRequiredBond: rep(20n),
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThreshold: rep(200n),
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(100n),
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		activationTime: 120n,
		startBond: rep(3n),
		status: 'active',
		systemState: 'operational',
		totalCost: rep(20n),
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultEscrowedRep: 1n * REP,
		viewerVaultRepDepositShare: 11n * REP,
		...overrides,
	}
}

function createNotStartedReportingDetails(overrides: Partial<Extract<ReportingDetails, { status: 'not-started' }>> = {}): ReportingDetails {
	return {
		completeSetCollateralAmount: 1n,
		currentTime: 150n,
		forkThreshold: rep(100n),
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(50n),
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		startBond: rep(3n),
		status: 'not-started',
		systemState: 'operational',
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultEscrowedRep: 0n,
		viewerVaultRepDepositShare: 10n * REP,
		...overrides,
	}
}

function createDynamicReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	const sides = overrides.sides ?? [
		{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
		{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
		{ balance: rep(3n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
	]
	const startBond = overrides.startBond ?? rep(1n)
	const nonDecisionThreshold = overrides.nonDecisionThreshold ?? rep(20n)
	const forkThreshold = overrides.forkThreshold ?? nonDecisionThreshold * 2n
	const activationTime = overrides.activationTime ?? 120n
	const currentTime = overrides.currentTime ?? 150n
	const bindingCapital = getEscalationBindingCapital(getEscalationBalanceTuple(sides))
	const escalationEndTime = activationTime + computeEscalationTimeSinceStartFromAttritionCost(startBond, nonDecisionThreshold, bindingCapital)

	const baseDetails: ActiveReportingDetails = {
		bindingCapital,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: rep(2n),
		currentTime,
		escalationEndTime,
		escalationGameAddress: zeroAddress,
		forkThreshold,
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold,
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		sides,
		startBond,
		activationTime,
		status: 'active',
		systemState: 'operational',
		totalCost: 0n,
		universeId: 1n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultEscrowedRep: 1n * REP,
		viewerVaultRepDepositShare: 11n * REP,
	}

	return {
		...baseDetails,
		...overrides,
		bindingCapital,
		currentTime,
		escalationEndTime,
		forkThreshold,
		nonDecisionThreshold,
		sides,
		startBond,
		activationTime,
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

	test('getEscalationPhase treats the exact timeout boundary as Timed Out', () => {
		const details = createReportingDetails({
			currentTime: 300n,
			escalationEndTime: 300n,
		})

		expect(getEscalationPhase(details)).toBe('Timed Out')
	})

	test('isReportingClosed treats non-decision and the exact timeout boundary as closed', () => {
		expect(
			isReportingClosed(
				createReportingDetails({
					currentTime: 200n,
					escalationEndTime: 300n,
					hasReachedNonDecision: true,
				}),
			),
		).toBe(true)

		expect(
			isReportingClosed(
				createReportingDetails({
					currentTime: 300n,
					escalationEndTime: 300n,
				}),
			),
		).toBe(true)
	})

	test('getMinimumOutcomeChangeContribution returns the smallest strict lead', () => {
		expect(getMinimumOutcomeChangeContribution(createReportingDetails(), 'yes')).toEqual({
			amount: rep(4n),
			reason: undefined,
		})
	})

	test('getMinimumOutcomeChangeContribution returns 1001 REP for 1000 REP on yes and no selected', () => {
		const details = createReportingDetails({
			currentRequiredBond: rep(1_000n),
			nonDecisionThreshold: rep(2_000n),
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(1_000n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBond: rep(1n),
		})

		expect(getMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amount: rep(1_001n),
			reason: undefined,
		})
	})

	test('getMinimumOutcomeChangeContribution respects startBond when the lead delta is smaller than the minimum report', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBond: rep(3n),
		})

		expect(getMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amount: rep(3n),
			reason: undefined,
		})
	})

	test('getMinimumOutcomeChangeContribution returns zero when the selected side already resolves', () => {
		const details = createReportingDetails({
			questionOutcome: 'yes',
			sides: [
				{ balance: rep(9n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(getMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amount: 0n,
			reason: undefined,
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
							amount: rep(2n),
							cumulativeAmount: rep(1n),
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
				amount: rep(2n),
				cumulativeAmount: rep(1n),
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
							amount: rep(2n),
							cumulativeAmount: rep(1n),
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
				amount: rep(2n),
				cumulativeAmount: rep(1n),
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
				amount: rep(14n),
				cumulativeAmount: rep(34n),
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
			amount: undefined,
			reason: 'Selected side already leads.',
		})
	})

	test('getMinimumOutcomeChangeContribution falls back to the remaining threshold room when the selected side cannot take the lead', () => {
		const details = createReportingDetails({
			nonDecisionThreshold: rep(20n),
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(19n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBond: rep(1n),
		})

		expect(getMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amount: rep(1n),
			reason: undefined,
		})
	})

	test('getMaxProfitContribution fills the remaining reward window', () => {
		expect(getMaxProfitContribution(createReportingDetails(), 'yes')).toEqual({
			amount: rep(7n),
			reason: undefined,
		})
	})

	test('getMaxProfitContribution returns 1500 REP for 1000 REP on yes and no selected', () => {
		const details = createReportingDetails({
			currentRequiredBond: rep(1_000n),
			nonDecisionThreshold: rep(2_000n),
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(1_000n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBond: rep(1n),
		})

		expect(getMaxProfitContribution(details, 'no')).toEqual({
			amount: rep(1_500n),
			reason: undefined,
		})
	})

	test('getMaxProfitContribution is unavailable when the reward window is already filled', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(15n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(getMaxProfitContribution(details, 'yes')).toEqual({
			amount: undefined,
			reason: 'Max profit preset unavailable because the reward window is already filled on the selected side.',
		})
	})

	test('getMaxProfitContribution reports unavailable when the selected side is not present', () => {
		expect(
			getMaxProfitContribution(
				createReportingDetails({
					sides: [
						{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: rep(8n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
					],
				}),
				'invalid',
			),
		).toEqual({
			amount: undefined,
			reason: 'Selected side is unavailable.',
		})
	})

	test('projecting an invalid-side report preserves branch coverage in balance recalculation helpers', () => {
		const details = createReportingDetails({
			nonDecisionThreshold: rep(5000n),
			sides: [
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(4n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBond: rep(1n),
		})

		expect(previewReportingContribution(details, 'invalid', rep(1n))).toEqual({
			actualDepositAmount: rep(1n),
			reason: undefined,
		})
	})

	test('getSelectedOutcomeRewardWindowFillTimestamp returns the future reward-window fill time when room remains', () => {
		const details = createDynamicReportingDetails()

		expect(getSelectedOutcomeRewardWindowFillTimestamp(details, 'no', rep(2n))).toBe(details.activationTime + computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, rep(12n)))
	})

	test('getSelectedOutcomeRewardWindowFillTimestamp returns undefined when the reward window is already filled', () => {
		const details = createDynamicReportingDetails()

		expect(getSelectedOutcomeRewardWindowFillTimestamp(details, 'yes', rep(1n))).toBeUndefined()
	})

	test('getReportingMinimumOutcomeChangeContribution returns the first-report minimum before the escalation game exists', () => {
		expect(getReportingMinimumOutcomeChangeContribution(createNotStartedReportingDetails(), 'yes')).toEqual({
			amount: rep(3n),
			reason: undefined,
		})
	})

	test('getReportingMaxProfitContribution is unavailable before the escalation game exists', () => {
		expect(getReportingMaxProfitContribution(createNotStartedReportingDetails(), 'yes')).toEqual({
			amount: undefined,
			reason: 'Max profit becomes available after the escalation game starts.',
		})
	})

	test('reporting preset helpers disable both presets once the escalation game is resolved', () => {
		const details = createReportingDetails({
			questionOutcome: 'yes',
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amount: undefined,
			reason: 'Escalation is already resolved.',
		})
		expect(getReportingMaxProfitContribution(details, 'yes')).toEqual({
			amount: undefined,
			reason: 'Escalation is already resolved.',
		})
	})

	test('previewReportingContribution rejects a pre-start amount below the first-report minimum', () => {
		expect(previewReportingContribution(createNotStartedReportingDetails(), 'yes', rep(2n))).toEqual({
			actualDepositAmount: undefined,
			reason: 'Enter at least 3 REP to start the escalation game.',
		})
	})

	test('previewReportingContribution accepts a valid pre-start amount', () => {
		expect(previewReportingContribution(createNotStartedReportingDetails(), 'yes', rep(3n))).toEqual({
			actualDepositAmount: rep(3n),
			reason: undefined,
		})
	})

	test('getReportingTimerPreview returns a pre-start timer preview for a valid first report', () => {
		const hypotheticalDuration = computeEscalationTimeSinceStartFromAttritionCost(rep(3n), rep(50n), rep(10n))

		expect(getReportingTimerPreview(createNotStartedReportingDetails(), 'yes', rep(10n))).toEqual({
			hypotheticalDuration: computeEscalationTimeSinceStartFromAttritionCost(rep(3n), rep(50n), rep(10n)),
			kind: 'not-started',
			timeUntilEnd: ESCALATION_GAME_ACTIVATION_DELAY + hypotheticalDuration,
			timeUntilStart: ESCALATION_GAME_ACTIVATION_DELAY,
		})
	})

	test('getReportingTimerPreview returns undefined for an invalid pre-start amount', () => {
		expect(getReportingTimerPreview(createNotStartedReportingDetails(), 'yes', rep(2n))).toBeUndefined()
	})

	test('projectEscalationEndTime keeps the timer unchanged for a leading-side deposit', () => {
		const details = createDynamicReportingDetails()

		expect(projectEscalationEndTime(details, 'yes', rep(1n))).toEqual({
			acceptedAmount: rep(1n),
			endsImmediately: false,
			projectedEndTime: details.escalationEndTime,
		})
	})

	test('projectEscalationEndTime extends the timer for a non-leading-side deposit that raises binding capital', () => {
		const details = createDynamicReportingDetails()
		const projection = projectEscalationEndTime(details, 'no', rep(2n))

		expect(projection).toBeDefined()
		expect(projection?.acceptedAmount).toBe(rep(2n))
		expect(projection?.endsImmediately).toBe(false)
		expect(projection?.projectedEndTime).toBeGreaterThan(details.escalationEndTime)
	})

	test('getReportingTimerPreview reports timer extensions for active escalation contributions', () => {
		const details = createDynamicReportingDetails()

		expect(getReportingTimerPreview(details, 'no', rep(2n))).toEqual({
			acceptedAmount: rep(2n),
			actualState: 'extends',
			hypotheticalDuration: computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, rep(2n)),
			kind: 'active-or-pending',
			timerIncrease: computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, rep(5n)) - computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, rep(3n)),
		})
	})

	test('getReportingTimerPreview reports unchanged timers while still using the standalone amount for hypothetical duration', () => {
		const details = createDynamicReportingDetails()

		expect(getReportingTimerPreview(details, 'yes', rep(5n))).toEqual({
			acceptedAmount: rep(5n),
			actualState: 'unchanged',
			hypotheticalDuration: computeEscalationTimeSinceStartFromAttritionCost(details.startBond, details.nonDecisionThreshold, rep(5n)),
			kind: 'active-or-pending',
		})
	})

	test('projectEscalationEndTime reflects the tie-adjusted accepted amount', () => {
		const details = createDynamicReportingDetails({
			sides: [
				{ balance: rep(5n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(projectEscalationEndTime(details, 'yes', rep(5n))?.acceptedAmount).toBe(rep(5n) - 1n)
	})

	test('projectEscalationEndTime ends escalation immediately when a deposit creates a threshold tie', () => {
		const details = createDynamicReportingDetails({
			nonDecisionThreshold: rep(10n),
			sides: [
				{ balance: rep(10n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(9n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(projectEscalationEndTime(details, 'yes', rep(1n))).toEqual({
			acceptedAmount: rep(1n),
			endsImmediately: true,
			projectedEndTime: details.currentTime,
		})
	})

	test('calculateEstimatedEscalationReturn only rewards the eligible slice when a deposit crosses the cap', () => {
		const details = createReportingDetails({
			nonDecisionThreshold: rep(40n),
			sides: [
				{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(calculateEstimatedEscalationReturn(details, 'yes', rep(14n))).toEqual({
			payout: rep(18n),
			profit: rep(4n),
		})
	})

	test('calculateEstimatedEscalationReturn matches the pro-rata reward schedule inside the window', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(20n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(calculateEstimatedEscalationReturn(details, 'yes', rep(14n))).toEqual({
			payout: rep(26n),
			profit: rep(12n),
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

	test('returns undefined when selected outcome metadata is not available for reward-window timing', () => {
		expect(
			getSelectedOutcomeRewardWindowFillTimestamp(
				createReportingDetails({
					sides: [{ balance: 1n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] }],
				}),
				'yes',
				rep(1n),
			),
		).toBeUndefined()
	})

	test('returns undefined for active reporting timer previews when non-decision has been reached', () => {
		expect(
			getReportingTimerPreview(
				createReportingDetails({
					hasReachedNonDecision: true,
				}),
				'yes',
				rep(1n),
			),
		).toBeUndefined()
	})

	test('returns reward-window metadata in no-op forms and missing-side paths', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(2n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(3n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			],
		})
		expect(getRemainingSelectedOutcomeContributionCapacity(details, 'no')).toBe(0n)
		expect(getRemainingSelectedOutcomeContributionCapacity({ ...details, nonDecisionThreshold: rep(20n) }, 'invalid')).toBe(rep(18n))
	})

	test('returns undefined amount/profit for zero-deposit and unknown-side contribution calculations', () => {
		const unknownOutcome = 'ghost' as unknown as ReportingOutcomeKey
		expect(calculateEstimatedEscalationReturn(createReportingDetails(), 'yes', 0n)).toEqual({
			payout: 0n,
			profit: 0n,
		})
		expect(calculateEstimatedEscalationReturn(createReportingDetails(), unknownOutcome, rep(5n))).toEqual({
			payout: 0n,
			profit: 0n,
		})
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
					nonDecisionThreshold: rep(10n),
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
			reason: 'Selected side is already full at 10 REP.',
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
				amount: rep(1n),
				cumulativeAmount: rep(1n),
				depositIndex: 0n,
				depositor: zeroAddress,
			}),
		).toBe(rep(1n))
	})

	test('returns no reward for capped projections when selected side has no room', () => {
		expect(
			calculateEstimatedEscalationReturn(
				{
					...createReportingDetails(),
					sides: [
						{ balance: rep(100n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
						{ balance: rep(1n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
					],
				},
				'yes',
				rep(5n),
			),
		).toEqual({
			payout: 0n,
			profit: 0n,
		})
	})

	test('returns pure deposit payout when reward eligibility is effectively empty', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(0n), deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(0n), deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(0n), deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
		})

		expect(calculateEstimatedEscalationReturn(details, 'yes', rep(1n))).toEqual({
			payout: rep(1n),
			profit: 0n,
		})
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

	test('throws when projection logic receives an unknown reporting outcome', () => {
		const unknownOutcome = 'ghost' as unknown as ReportingOutcomeKey
		expect(() => getReportingTimerPreview(createDynamicReportingDetails(), unknownOutcome, rep(1n))).toThrow('Unhandled discriminated union member: "ghost"')
	})
})
