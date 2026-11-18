import { describe, expect, test } from 'bun:test'
import {
	computeEscalationBindingCapitalAttoRep,
	computeEscalationCurveAttoRep,
	computeEscalationFinalityElapsed,
	ESCALATION_ACTIVATION_DELAY,
	ESCALATION_TIME_LENGTH,
	getEscalationRequiredSupportAttoRep,
	getWinningEscalationDepositClaimAmount,
	getWinningImportedEscalationDepositClaimAmount,
	hasReachedNonDecision,
	projectEscalationDeposit,
	projectEscalationEndTime,
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

	test('applies the start bond to the offered amount, before the tie adjustment', () => {
		expect(projectEscalationDeposit({ amountAttoRep: 10n, balancesAttoRep: [0n, 0n, 10n], nonDecisionThresholdAttoRep: 100n, outcome: 'yes', startBondAttoRep: 10n })).toMatchObject({ acceptedAmountAttoRep: 9n, projectedBalancesAttoRep: [0n, 9n, 10n], takesLead: false, tieAdjusted: true })
		expect(projectEscalationDeposit({ amountAttoRep: 9n, balancesAttoRep: [0n, 0n, 10n], nonDecisionThresholdAttoRep: 100n, outcome: 'yes', startBondAttoRep: 10n })).toBeUndefined()
	})

	test('requires support to meet the curve only once the curve has passed the median and one outcome leads', () => {
		expect(computeEscalationCurveAttoRep(1n, 8n, 0n)).toBe(0n)
		expect(computeEscalationCurveAttoRep(1n, 8n, ESCALATION_TIME_LENGTH / 3n)).toBe(2n)
		expect(getEscalationRequiredSupportAttoRep([0n, 10n, 4n], 4n)).toBe(0n)
		expect(getEscalationRequiredSupportAttoRep([0n, 10n, 4n], 5n)).toBe(5n)
		expect(getEscalationRequiredSupportAttoRep([0n, 10n, 4n], 12n)).toBe(12n)
		expect(getEscalationRequiredSupportAttoRep([0n, 10n, 10n], 12n)).toBe(0n)
	})

	test('rejects a deposit that leaves its outcome below a curve that has passed the median', () => {
		const base = { balancesAttoRep: [0n, 10n, 4n], nonDecisionThresholdAttoRep: 100n, outcome: 'no', startBondAttoRep: 1n } as const
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 2n, curveAttoRep: 4n })).toMatchObject({ acceptedAmountAttoRep: 2n, takesLead: false })
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 2n, curveAttoRep: 7n })).toBeUndefined()
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 3n, curveAttoRep: 7n })).toMatchObject({ projectedBalancesAttoRep: [0n, 10n, 7n], takesLead: false })
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 7n, curveAttoRep: 12n })).toBeUndefined()
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 8n, curveAttoRep: 12n })).toMatchObject({ projectedBalancesAttoRep: [0n, 10n, 12n], takesLead: true })
		expect(projectEscalationDeposit({ ...base, outcome: 'yes', amountAttoRep: 1n, curveAttoRep: 12n })).toBeUndefined()
		// The tie adjustment applies before the curve comparison.
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 6n, curveAttoRep: 10n })).toBeUndefined()
	})

	test('marks a deposit as taking the lead only when a trailing outcome passes the previous maximum', () => {
		const base = { nonDecisionThresholdAttoRep: 100n, startBondAttoRep: 1n } as const
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 7n, balancesAttoRep: [0n, 10n, 4n], outcome: 'no' })?.takesLead).toBe(true)
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 5n, balancesAttoRep: [0n, 10n, 4n], outcome: 'no' })?.takesLead).toBe(false)
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 5n, balancesAttoRep: [0n, 10n, 4n], outcome: 'yes' })?.takesLead).toBe(false)
		expect(projectEscalationDeposit({ ...base, amountAttoRep: 5n, balancesAttoRep: [0n, 10n, 10n], outcome: 'yes' })?.takesLead).toBe(false)
	})

	test('projects the end time as the later of the curve deadline and the response period', () => {
		const base = { activationTime: 1000n, nonDecisionThresholdAttoRep: 8n, startBondAttoRep: 1n, timestamp: 5000n } as const
		const curveElapsed = computeEscalationFinalityElapsed(1n, 8n, 2n)
		const balances = [0n, 4n, 2n] as const
		expect(projectEscalationEndTime({ ...base, projection: { projectedBalancesAttoRep: balances, takesLead: false }, responseRestartedUntil: 0n })).toBe(1000n + curveElapsed)
		expect(projectEscalationEndTime({ ...base, projection: { projectedBalancesAttoRep: balances, takesLead: false }, responseRestartedUntil: 1000n + curveElapsed + 7n })).toBe(1000n + curveElapsed + 7n)
		const late = 1000n + curveElapsed
		expect(projectEscalationEndTime({ ...base, timestamp: late, projection: { projectedBalancesAttoRep: balances, takesLead: true }, responseRestartedUntil: 0n })).toBe(late + ESCALATION_ACTIVATION_DELAY)
		// A lead change early on the curve leaves the later curve deadline in force.
		expect(projectEscalationEndTime({ ...base, timestamp: 0n, projection: { projectedBalancesAttoRep: balances, takesLead: true }, responseRestartedUntil: 0n })).toBe(1000n + curveElapsed)
	})

	test('projects a resumed continuation from its rebased curve, its fresh response period and any restart', () => {
		const base = { activationTime: 0n, nonDecisionThresholdAttoRep: 8n, startBondAttoRep: 1n, timestamp: 500n } as const
		const curveElapsed = computeEscalationFinalityElapsed(1n, 8n, 2n)
		const projection = { projectedBalancesAttoRep: [0n, 4n, 2n], takesLead: false } as const
		expect(projectEscalationEndTime({ ...base, projection, responseRestartedUntil: 0n, continuation: { forkElapsedAtStart: curveElapsed + 5n, forkResumedAt: 100n } })).toBe(100n + ESCALATION_ACTIVATION_DELAY)
		expect(projectEscalationEndTime({ ...base, projection, responseRestartedUntil: 0n, continuation: { forkElapsedAtStart: -ESCALATION_ACTIVATION_DELAY, forkResumedAt: 100n } })).toBe(100n + curveElapsed + ESCALATION_ACTIVATION_DELAY)
		expect(projectEscalationEndTime({ ...base, projection: { ...projection, takesLead: true }, responseRestartedUntil: 0n, continuation: { forkElapsedAtStart: curveElapsed + 5n, forkResumedAt: 100n } })).toBe(500n + ESCALATION_ACTIVATION_DELAY)
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
