/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { calculateEstimatedEscalationReturn, getMaxProfitContribution, getMinimumOutcomeChangeContribution } from '../lib/reportingDomain.js'
import type { ActiveReportingDetails, MarketDetails } from '../types/contracts.js'

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
