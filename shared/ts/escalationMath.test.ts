import { describe, expect, test } from 'bun:test'
import { computeEscalationTimeSinceStartFromAttritionCost, ESCALATION_TIME_LENGTH } from './escalationMath'

describe('escalation math', () => {
	test('preserves logarithm components at exact power-of-two ratios', () => {
		expect(computeEscalationTimeSinceStartFromAttritionCost(1n, 8n, 2n)).toBe(ESCALATION_TIME_LENGTH / 3n)
		expect(computeEscalationTimeSinceStartFromAttritionCost(1n, 8n, 4n)).toBe((ESCALATION_TIME_LENGTH * 2n) / 3n)
	})
})
