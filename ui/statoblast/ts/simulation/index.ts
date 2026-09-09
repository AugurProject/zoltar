import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { getStatoblastScenarioDescription, getStatoblastScenarioLabel, type StatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'

const STATOBLAST_SCENARIOS = ['security-pool', 'securitypoolx2', 'securitypoolx2-auction'] as const satisfies readonly StatoblastScenario[]

export function isStatoblastScenario(value: string): value is StatoblastScenario {
	return (STATOBLAST_SCENARIOS as readonly string[]).includes(value)
}

export { getStatoblastScenarioDescription, getStatoblastScenarioLabel }

export function registerStatoblastSimulationScenarios() {
	for (const scenario of STATOBLAST_SCENARIOS) {
		registerSimulationScenario(scenario, {
			description: getStatoblastScenarioDescription(scenario),
			label: getStatoblastScenarioLabel(scenario),
		})
	}
}
