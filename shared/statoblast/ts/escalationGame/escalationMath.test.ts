import { describe, expect, test } from 'bun:test'
import {
	getWinningEscalationDepositClaimAmount,
	getWinningImportedEscalationDepositClaimAmount,
	computeEscalationBindingCapitalAttoRep,
	computeEscalationFinalityElapsed,
	ESCALATION_TIME_LENGTH,
	hasReachedNonDecision,
	projectEscalationDeposit,
} from './escalationMath'

describe('escalation math', () => {
	test('finality uses the strict forward crossing through quantized and flat curves', () => {
		const bond = 10n ** 18n
		for (const [start, threshold, binding] of [
			[1n, 8n, 1n],
			[1n, 8n, 2n],
			[bond, 1000n * bond, 7n * bond],
			[bond, bond + 10n ** 12n, bond],
			[bond, bond + 10n ** 12n, bond + 1n],
		] as const) {
			const elapsed = computeEscalationFinalityElapsed(start, threshold, binding)
			expect(computeEscalationBindingCapitalAttoRep(start, threshold, elapsed)).toBeLessThanOrEqual(binding)
			expect(computeEscalationBindingCapitalAttoRep(start, threshold, elapsed + 1n)).toBeGreaterThan(binding)
		}
		expect(computeEscalationFinalityElapsed(bond, 10n * bond, 0n)).toBe(0n)
		expect(computeEscalationFinalityElapsed(bond, 10n * bond, 10n * bond)).toBe(ESCALATION_TIME_LENGTH)
	})
	test('ordinary intervals preserve total payout through reward and haircut rounding', () => {
		const base = { bindingCapitalAttoRep: 7n, winningOutcomeBalanceAttoRep: 11n, forkThresholdAttoRep: 13n, nonDecisionThresholdAttoRep: 19n, ordinarySettlement: true }
		let total = 0n
		for (let end = 1n; end <= 11n; end++) total += getWinningEscalationDepositClaimAmount({ ...base, depositAmountAttoRep: 1n, cumulativeAmountAttoRep: end })
		expect(total).toBe(getWinningEscalationDepositClaimAmount({ ...base, depositAmountAttoRep: 11n, cumulativeAmountAttoRep: 11n }))
		expect(total).toBe(10n)
	})
	test('includes the final two seconds of power-of-two forward plateaus', () => {
		const bond = 10n ** 18n
		expect(computeEscalationFinalityElapsed(bond, 8n * bond, 2n * bond)).toBe(ESCALATION_TIME_LENGTH / 3n + 2n)
		expect(computeEscalationFinalityElapsed(bond, 8n * bond, 4n * bond)).toBe((ESCALATION_TIME_LENGTH * 2n) / 3n + 2n)
	})

	test('maps a zero-log curve to its terminal step without an early projected deadline', () => {
		const bond = 10n ** 18n
		const threshold = bond + 10n ** 12n
		expect(computeEscalationBindingCapitalAttoRep(bond, threshold, ESCALATION_TIME_LENGTH - 1n)).toBe(bond)
		expect(computeEscalationBindingCapitalAttoRep(bond, threshold, ESCALATION_TIME_LENGTH)).toBe(threshold)
		for (const [cost, expectedTime] of [
			[0n, 0n],
			[bond, ESCALATION_TIME_LENGTH - 1n],
			[bond + 1n, ESCALATION_TIME_LENGTH - 1n],
			[bond + 10n ** 11n, ESCALATION_TIME_LENGTH - 1n],
			[threshold - 1n, ESCALATION_TIME_LENGTH - 1n],
			[threshold, ESCALATION_TIME_LENGTH],
			[threshold + 1n, ESCALATION_TIME_LENGTH],
		] as const) {
			expect(computeEscalationFinalityElapsed(bond, threshold, cost)).toBe(expectedTime)
		}
	})

	test('shares the contract forward curve and deposit projection', () => {
		expect(computeEscalationBindingCapitalAttoRep(1n, 8n, 0n)).toBe(1n)
		expect(computeEscalationBindingCapitalAttoRep(1n, 8n, ESCALATION_TIME_LENGTH / 3n)).toBe(2n)
		expect(computeEscalationBindingCapitalAttoRep(1n, 8n, ESCALATION_TIME_LENGTH)).toBe(8n)
		expect(projectEscalationDeposit({ amountAttoRep: 1n, balancesAttoRep: [0n, 1n, 1n], nonDecisionThresholdAttoRep: 3n, outcome: 'yes', startBondAttoRep: 1n })).toMatchObject({ acceptedAmountAttoRep: 1n, projectedBalancesAttoRep: [0n, 2n, 1n], tieAdjusted: false })
	})

	test('requires two outcomes to reach the non-decision threshold', () => {
		expect(hasReachedNonDecision([3n, 2n, 1n], 3n)).toBe(false)
		expect(hasReachedNonDecision([3n, 3n, 1n], 3n)).toBe(true)
		expect(hasReachedNonDecision([3n, 3n, 3n], 3n)).toBe(true)
	})
})

void test('inherited rewards retain the canonical principal after distinct ancestry haircuts', () => {
	expect(getWinningImportedEscalationDepositClaimAmount({ bindingCapitalAttoRep: 100n, depositAmountAttoRep: 10n, principalAttoRep: 4n, postDepositCumulativeAmountAttoRep: 10n, forkThresholdAttoRep: 100n, nonDecisionThresholdAttoRep: 100n, winningOutcomeBalanceAttoRep: 100n })).toBe(10n)
})
