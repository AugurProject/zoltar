import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { getStatoblastScenarioDescription, getStatoblastScenarioLabel, type StatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'

const STATOBLAST_SCENARIOS = ['security-pool', 'securitypoolx2', 'securitypoolx2-auction'] as const satisfies readonly StatoblastScenario[]

export function registerStatoblastSimulationScenarios() {
	for (const scenario of STATOBLAST_SCENARIOS) {
		registerSimulationScenario(scenario, {
			description: getStatoblastScenarioDescription(scenario),
			label: getStatoblastScenarioLabel(scenario),
		})
	}
}
