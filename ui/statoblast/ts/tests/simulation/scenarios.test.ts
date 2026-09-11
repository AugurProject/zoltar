/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { registerStatoblastSimulationScenarios } from '../../simulation/index.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'

void describe('statoblast simulation scenarios', () => {
	void test('registers scenarios into the shared registry', () => {
		registerStatoblastSimulationScenarios()
		expect(getRegisteredSimulationScenarios()).toContain('security-pool')
		expect(getRegisteredSimulationScenarios()).toContain('securitypoolx2')
		expect(getRegisteredSimulationScenarios()).toContain('securitypoolx2-auction')
		expect(getSimulationScenarioLabel('security-pool')).toBe('Security pool')
		expect(getSimulationScenarioLabel('securitypoolx2')).toBe('Security pool x2')
		expect(getSimulationScenarioLabel('securitypoolx2-auction')).toBe('Security pool x2 auction')
		expect(getSimulationScenarioDescription('security-pool')).toContain('seeded question')
		expect(getSimulationScenarioDescription('securitypoolx2')).toContain('Two seeded questions with two security pools')
		expect(getSimulationScenarioDescription('securitypoolx2-auction')).toContain('child truth auction seeded with ten bids')
	})
})
