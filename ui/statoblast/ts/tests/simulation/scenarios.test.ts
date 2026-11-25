/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { registerStatoblastSimulationScenarios } from '@zoltar/ui-statoblast-shared/simulation/registerStatoblastScenarios.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
const EXPECTED_PRESENTATION = {
	'portfolio-auction': ['Security pool branch auction', 'open recapitalization auction', 'still in contention', 'outbid and refundable', 'Another wallet has also bid'],
	'security-pool': ['One-question security pool', 'one registered question'],
	securitypoolx2: ['Two-question security pool', 'two registered questions'],
} satisfies Record<string, readonly [label: string, ...descriptionFragments: string[]]>

void describe('statoblast simulation scenarios', () => {
	void test('registers every scenario into the shared registry with its readable label and description', () => {
		registerStatoblastSimulationScenarios()
		const registered = getRegisteredSimulationScenarios()
		expect(registered).toEqual(['baseline', 'deployed', ...Object.keys(EXPECTED_PRESENTATION)])
		for (const [scenario, [label, ...descriptionFragments]] of Object.entries(EXPECTED_PRESENTATION)) {
			expect(registered).toContain(scenario)
			expect(getSimulationScenarioLabel(scenario)).toBe(label)
			const description = getSimulationScenarioDescription(scenario)
			for (const fragment of descriptionFragments) expect(description).toContain(fragment)
		}
	})
})
