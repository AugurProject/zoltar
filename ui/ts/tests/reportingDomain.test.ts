/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { calculateEstimatedEscalationReturn, getMaxProfitContribution, getMinimumOutcomeChangeContribution, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, previewReportingContribution } from '../lib/reportingDomain.js'
import type { ActiveReportingDetails, MarketDetails, ReportingDetails } from '../types/contracts.js'

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
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(100n),
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		sides: [
			{ balance: rep(5n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
			{ balance: rep(2n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
		],
		startBond: rep(3n),
		startingTime: 120n,
		status: 'active',
		totalCost: rep(20n),
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 1n * REP,
		viewerVaultRepDepositShare: 11n * REP,
		...overrides,
	}
}

function createNotStartedReportingDetails(overrides: Partial<Extract<ReportingDetails, { status: 'not-started' }>> = {}): ReportingDetails {
	return {
		completeSetCollateralAmount: 1n,
		currentTime: 150n,
		marketDetails: createMarketDetails(),
		nonDecisionThreshold: rep(50n),
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: zeroAddress,
		startBond: rep(3n),
		status: 'not-started',
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n * REP,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 0n,
		viewerVaultRepDepositShare: 10n * REP,
		...overrides,
	}
}

describe('reportingDomain', () => {
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
				{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(1_000n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
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
				{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(5n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(5n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
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
			resolution: 'yes',
			sides: [
				{ balance: rep(9n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(2n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(getMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amount: 0n,
			reason: undefined,
		})
	})

	test('getReportingMinimumOutcomeChangeContribution disables the preset when the selected side already leads', () => {
		const details = createReportingDetails({
			sides: [
				{ balance: rep(9n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(2n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(getReportingMinimumOutcomeChangeContribution(details, 'yes')).toEqual({
			amount: undefined,
			reason: 'Selected side already leads.',
		})
	})

	test('getMinimumOutcomeChangeContribution is unavailable when the selected side cannot lead within remaining room', () => {
		const details = createReportingDetails({
			nonDecisionThreshold: rep(20n),
			sides: [
				{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(20n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(19n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
			],
			startBond: rep(1n),
		})

		expect(getMinimumOutcomeChangeContribution(details, 'no')).toEqual({
			amount: undefined,
			reason: 'Min preset unavailable because the selected side cannot take the lead within the remaining bond capacity.',
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
				{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
				{ balance: rep(1_000n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: 0n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
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
				{ balance: rep(15n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(8n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: rep(2n), deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(getMaxProfitContribution(details, 'yes')).toEqual({
			amount: undefined,
			reason: 'Max profit preset unavailable because the reward window is already filled on the selected side.',
		})
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
			resolution: 'yes',
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

	test('calculateEstimatedEscalationReturn only rewards the eligible slice when a deposit crosses the cap', () => {
		const details = createReportingDetails({
			nonDecisionThreshold: rep(40n),
			sides: [
				{ balance: rep(20n), deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(20n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
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
				{ balance: 0n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
				{ balance: rep(20n), deposits: [], key: 'no', label: 'No', userDeposits: [] },
				{ balance: 0n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			],
		})

		expect(calculateEstimatedEscalationReturn(details, 'yes', rep(14n))).toEqual({
			payout: rep(26n),
			profit: rep(12n),
		})
	})
})
