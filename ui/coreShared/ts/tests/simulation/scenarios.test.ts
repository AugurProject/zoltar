/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel, registerSimulationScenario } from '../../simulation/scenarios.js'

void describe('simulation scenarios', () => {
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

	void test('an app can override a core scenario presentation without listing it twice', () => {
		const coreLabel = getSimulationScenarioLabel('deployed')
		const coreDescription = getSimulationScenarioDescription('deployed')
		registerSimulationScenario('deployed', { description: 'app deployed description', label: 'App deployed' })
		try {
			const scenarios = getRegisteredSimulationScenarios()
			expect(scenarios.filter(scenario => scenario === 'deployed')).toHaveLength(1)
			expect(scenarios.indexOf('deployed')).toBe(1)
			expect(getSimulationScenarioLabel('deployed')).toBe('App deployed')
			expect(getSimulationScenarioDescription('deployed')).toBe('app deployed description')
		} finally {
			registerSimulationScenario('deployed', { description: coreDescription, label: coreLabel })
		}
		expect(getSimulationScenarioLabel('deployed')).toBe(coreLabel)
		expect(getSimulationScenarioDescription('deployed')).toBe(coreDescription)
	})

	void test('unregistered scenario ids render without throwing', () => {
		expect(getSimulationScenarioLabel('legacy-id')).toBe('legacy-id')
		expect(getSimulationScenarioDescription('legacy-id')).toBe("Unregistered simulation scenario 'legacy-id'.")
	})
})
