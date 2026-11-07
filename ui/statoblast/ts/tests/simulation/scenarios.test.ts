/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { registerStatoblastSimulationScenarios } from '@zoltar/ui-statoblast-shared/simulation/registerStatoblastScenarios.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
const EXPECTED_PRESENTATION = {
	portfolio: ['Shared portfolio', 'two registered questions'],
	'portfolio-auction': ['Portfolio branch auction', 'winning and excluded bids'],
	'security-pool': ['One-question portfolio', 'one registered question'],
	securitypoolx2: ['Two-question portfolio', 'two registered questions'],
} satisfies Record<string, readonly [label: string, descriptionFragment: string]>

void describe('statoblast simulation scenarios', () => {
	void test('registers every scenario into the shared registry with its readable label and description', () => {
		registerStatoblastSimulationScenarios()
		const registered = getRegisteredSimulationScenarios()
		expect(registered).toEqual(['baseline', 'deployed', ...Object.keys(EXPECTED_PRESENTATION)])
		for (const [scenario, [label, descriptionFragment]] of Object.entries(EXPECTED_PRESENTATION)) {
			expect(registered).toContain(scenario)
			expect(getSimulationScenarioLabel(scenario)).toBe(label)
			expect(getSimulationScenarioDescription(scenario)).toContain(descriptionFragment)
		}
	})
})
