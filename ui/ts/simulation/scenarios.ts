export const SIMULATION_SCENARIOS = ['baseline', 'deployed', 'security-pool', 'securitypoolx2'] as const

export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number]

function isSimulationScenario(value: string): value is SimulationScenario {
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
	}
}
