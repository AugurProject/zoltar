import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { getZoltarScenarioDescription, getZoltarScenarioLabel, type ZoltarScenario } from './zoltarScenarios.js'

const ZOLTAR_SCENARIOS = ['forked-categorical'] as const satisfies readonly ZoltarScenario[]

export function isZoltarScenario(value: string): value is ZoltarScenario {
	return (ZOLTAR_SCENARIOS as readonly string[]).includes(value)
}

export { getZoltarScenarioDescription, getZoltarScenarioLabel }

export function registerZoltarSimulationScenarios() {
	for (const scenario of ZOLTAR_SCENARIOS) {
		registerSimulationScenario(scenario, {
			description: getZoltarScenarioDescription(scenario),
			label: getZoltarScenarioLabel(scenario),
		})
	}
}
