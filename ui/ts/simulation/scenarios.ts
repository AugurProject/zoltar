export const SIMULATION_SCENARIOS = ['base', 'deployed', 'security-pool'] as const

export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number]

function isSimulationScenario(value: string): value is SimulationScenario {
	return SIMULATION_SCENARIOS.includes(value as SimulationScenario)
}

export function normalizeSimulationScenario(value: string | undefined): SimulationScenario {
	// Keep `baseline` as a backwards-compatible alias for older docs and links.
	if (value === 'baseline') return 'base'
	return value !== undefined && isSimulationScenario(value) ? value : 'base'
}

export function getSimulationScenarioLabel(scenario: SimulationScenario) {
	switch (scenario) {
		case 'base':
			return 'Base'
		case 'deployed':
			return 'Deployed'
		case 'security-pool':
			return 'Security pool'
	}
}
