import { describe, expect, test } from 'bun:test'
import { computeEscalationTimeSinceStartFromAttritionCostAttoRep, ESCALATION_TIME_LENGTH } from './escalationMath'

describe('escalation math', () => {
	test('preserves logarithm components at exact power-of-two ratios', () => {
		expect(computeEscalationTimeSinceStartFromAttritionCostAttoRep(1n, 8n, 2n)).toBe(ESCALATION_TIME_LENGTH / 3n)
		expect(computeEscalationTimeSinceStartFromAttritionCostAttoRep(1n, 8n, 4n)).toBe((ESCALATION_TIME_LENGTH * 2n) / 3n)
	})
})
