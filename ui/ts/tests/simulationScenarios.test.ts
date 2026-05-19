/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSimulationScenarioLabel, normalizeSimulationScenario } from '../simulation/scenarios.js'

void describe('simulation scenarios', () => {
	void test('normalizes the securitypoolx2 scenario', () => {
		expect(normalizeSimulationScenario('securitypoolx2')).toBe('securitypoolx2')
	})

	void test('returns the securitypoolx2 scenario label', () => {
		expect(getSimulationScenarioLabel('securitypoolx2')).toBe('Security pool x2')
	})
})
