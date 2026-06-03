/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSimulationScenarioDescription, getSimulationScenarioLabel, normalizeSimulationScenario } from '../simulation/scenarios.js'

void describe('simulation scenarios', () => {
	void test('normalizes the securitypoolx2 scenario', () => {
		expect(normalizeSimulationScenario('securitypoolx2')).toBe('securitypoolx2')
		expect(normalizeSimulationScenario('securitypoolx2-auction')).toBe('securitypoolx2-auction')
	})

	void test('returns the securitypoolx2 scenario label', () => {
		expect(getSimulationScenarioLabel('securitypoolx2')).toBe('Security pool x2')
		expect(getSimulationScenarioLabel('securitypoolx2-auction')).toBe('Security pool x2 auction')
	})

	void test('returns descriptions for each scenario', () => {
		expect(getSimulationScenarioDescription('baseline')).toBe('Fresh walletless simulation with funded QA accounts and no app contracts deployed. Use it to test the Deploy flow from scratch.')
		expect(getSimulationScenarioDescription('deployed')).toBe('App contracts are deployed, but no security pools or seeded markets are created. Use it to test setup flows from an empty deployment.')
		expect(getSimulationScenarioDescription('security-pool')).toBe('One seeded market, one security pool, and one funded vault with an active security bond allowance. Use it to test pool workflows and liquidation paths.')
		expect(getSimulationScenarioDescription('securitypoolx2')).toBe('Two seeded markets with two security pools and two funded vaults in each pool. Use it to test multi-pool selection and repeated pool workflows.')
		expect(getSimulationScenarioDescription('securitypoolx2-auction')).toBe('Two seeded markets with one own-escalation fork already triggered and one child truth auction seeded with ten bids. Use it to test fork-auction bidbook and settlement workflows.')
	})
})
