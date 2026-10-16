import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { STATOBLAST_SCENARIOS, getStatoblastScenarioDescription, getStatoblastScenarioLabel } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'

export function registerStatoblastSimulationScenarios() {
	for (const scenario of STATOBLAST_SCENARIOS) {
		registerSimulationScenario(scenario, {
			description: getStatoblastScenarioDescription(scenario),
			label: getStatoblastScenarioLabel(scenario),
		})
	}
}
