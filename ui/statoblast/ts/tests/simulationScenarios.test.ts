/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getStatoblastScenarioDescription, getStatoblastScenarioLabel, isStatoblastScenario, registerStatoblastSimulationScenarios } from '../simulation/index.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'

void describe('statoblast simulation scenarios', () => {
	void test('recognizes statoblast scenarios', () => {
		expect(isStatoblastScenario('security-pool')).toBe(true)
		expect(isStatoblastScenario('securitypoolx2')).toBe(true)
		expect(isStatoblastScenario('securitypoolx2-auction')).toBe(true)
		expect(isStatoblastScenario('baseline')).toBe(false)
	})

	void test('returns labels for statoblast scenarios', () => {
		expect(getStatoblastScenarioLabel('security-pool')).toBe('Security pool')
		expect(getStatoblastScenarioLabel('securitypoolx2')).toBe('Security pool x2')
		expect(getStatoblastScenarioLabel('securitypoolx2-auction')).toBe('Security pool x2 auction')
	})

	void test('returns descriptions for statoblast scenarios', () => {
		expect(getStatoblastScenarioDescription('security-pool')).toBe('One seeded question, one security pool, and one funded vault with an active capacity ownership. Use it to test pool actions and liquidation paths.')
		expect(getStatoblastScenarioDescription('securitypoolx2')).toBe('Two seeded questions with two security pools and two funded vaults in each pool. Use it to test multi-pool selection and repeated pool actions.')
		expect(getStatoblastScenarioDescription('securitypoolx2-auction')).toBe('Two seeded questions with one own-escalation fork already triggered and one child truth auction seeded with ten bids. Use it to test the fork-auction bidbook and settlement actions.')
	})

	void test('registers scenarios into the shared registry', () => {
		registerStatoblastSimulationScenarios()
		expect(getRegisteredSimulationScenarios()).toContain('securitypoolx2-auction')
		expect(getSimulationScenarioLabel('securitypoolx2-auction')).toBe('Security pool x2 auction')
		expect(getSimulationScenarioDescription('security-pool')).toContain('seeded question')
	})
})
