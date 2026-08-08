import { describe, expect, test } from 'bun:test'
import { computeEscalationBindingCapitalAttoRep, computeEscalationTimeSinceStartFromAttritionCostAttoRep, ESCALATION_TIME_LENGTH, projectEscalationDeposit } from './escalationMath'

describe('escalation math', () => {
	test('preserves logarithm components at exact power-of-two ratios', () => {
		expect(computeEscalationTimeSinceStartFromAttritionCostAttoRep(1n, 8n, 2n)).toBe(ESCALATION_TIME_LENGTH / 3n)
		expect(computeEscalationTimeSinceStartFromAttritionCostAttoRep(1n, 8n, 4n)).toBe((ESCALATION_TIME_LENGTH * 2n) / 3n)
	})

	test('shares the contract forward curve and deposit projection', () => {
		expect(computeEscalationBindingCapitalAttoRep(1n, 8n, 0n)).toBe(1n)
		expect(computeEscalationBindingCapitalAttoRep(1n, 8n, ESCALATION_TIME_LENGTH / 3n)).toBe(2n)
		expect(computeEscalationBindingCapitalAttoRep(1n, 8n, ESCALATION_TIME_LENGTH)).toBe(8n)
		expect(projectEscalationDeposit({ amountAttoRep: 1n, balancesAttoRep: [0n, 1n, 1n], nonDecisionThresholdAttoRep: 3n, outcome: 'yes', startBondAttoRep: 1n })).toMatchObject({ acceptedAmountAttoRep: 1n, projectedBalancesAttoRep: [0n, 2n, 1n], tieAdjusted: false })
	})
})
