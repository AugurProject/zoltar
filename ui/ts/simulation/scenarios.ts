import { assertNever } from '../lib/assert.js'

export const SIMULATION_SCENARIOS = ['baseline', 'deployed', 'security-pool', 'securitypoolx2', 'securitypoolx2-auction'] as const

export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number]

export function isSimulationScenario(value: string): value is SimulationScenario {
	return SIMULATION_SCENARIOS.includes(value as SimulationScenario)
}

export function normalizeSimulationScenario(value: string | undefined): SimulationScenario {
	return value !== undefined && isSimulationScenario(value) ? value : 'baseline'
}

export function getSimulationScenarioLabel(scenario: SimulationScenario) {
	switch (scenario) {
		case 'baseline':
			return 'Baseline'
		case 'deployed':
			return 'Deployed'
		case 'security-pool':
			return 'Security pool'
		case 'securitypoolx2':
			return 'Security pool x2'
		case 'securitypoolx2-auction':
			return 'Security pool x2 auction'
		default:
			return assertNever(scenario)
	}
}

export function getSimulationScenarioDescription(scenario: SimulationScenario) {
	switch (scenario) {
		case 'baseline':
			return 'Fresh walletless simulation with funded QA accounts and no app contracts deployed. Use it to test the Deploy flow from scratch.'
		case 'deployed':
			return 'App contracts are deployed, but no security pools or seeded markets are created. Use it to test setup flows from an empty deployment.'
		case 'security-pool':
			return 'One seeded market, one security pool, and one funded vault with an active security bond allowance. Use it to test pool workflows and liquidation paths.'
		case 'securitypoolx2':
			return 'Two seeded markets with two security pools and two funded vaults in each pool. Use it to test multi-pool selection and repeated pool workflows.'
		case 'securitypoolx2-auction':
			return 'Two seeded markets with one own-escalation fork already triggered and one child truth auction seeded with ten bids. Use it to test fork-auction bidbook and settlement workflows.'
		default:
			return assertNever(scenario)
	}
}
