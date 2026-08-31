/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel, normalizeSimulationScenario, registerSimulationScenario } from '../../simulation/scenarios.js'

void describe('simulation scenarios', () => {
	void test('normalizes core scenarios and rejects unknown values', () => {
		expect(normalizeSimulationScenario('baseline')).toBe('baseline')
		expect(normalizeSimulationScenario('deployed')).toBe('deployed')
		expect(normalizeSimulationScenario('securitypoolx2')).toBe('baseline')
		expect(normalizeSimulationScenario(undefined)).toBe('baseline')
	})

	void test('returns labels and descriptions for core scenarios', () => {
		expect(getSimulationScenarioLabel('baseline')).toBe('Baseline')
		expect(getSimulationScenarioLabel('deployed')).toBe('Deployed')
		expect(getSimulationScenarioDescription('baseline')).toBe('Fresh walletless simulation with funded QA accounts and no app contracts deployed. Use it to test the Deploy flow from scratch.')
		expect(getSimulationScenarioDescription('deployed')).toBe('App contracts are deployed with no user-created records. Use it to test setup flows from an empty deployment.')
	})

	void test('registered app scenarios participate in listing, labels and descriptions', () => {
		registerSimulationScenario('securitypoolx2', { description: 'x2 description', label: 'Security pool x2' })
		expect(getRegisteredSimulationScenarios()).toContain('securitypoolx2')
		expect(getSimulationScenarioLabel('securitypoolx2')).toBe('Security pool x2')
		expect(getSimulationScenarioDescription('securitypoolx2')).toBe('x2 description')
	})
})
