import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { getZoltarScenarioDescription, getZoltarScenarioLabel, type ZoltarScenario } from './zoltarScenarios.js'

const ZOLTAR_SCENARIOS = ['two-questions', 'forked-categorical'] as const satisfies readonly ZoltarScenario[]

export function registerZoltarSimulationScenarios() {
	for (const scenario of ZOLTAR_SCENARIOS) {
		registerSimulationScenario(scenario, {
			description: getZoltarScenarioDescription(scenario),
			label: getZoltarScenarioLabel(scenario),
		})
	}
}
