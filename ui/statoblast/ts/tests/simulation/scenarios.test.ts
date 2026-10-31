/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { registerStatoblastSimulationScenarios } from '@zoltar/ui-statoblast-shared/simulation/registerStatoblastScenarios.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
const EXPECTED_PRESENTATION = {
	portfolio: ['Portfolio', 'Individual REP accounts back two questions'],
	'security-pool': ['Security pool', 'seeded question'],
	securitypoolx2: ['Security pool x2', 'Two seeded questions with two security pools'],
	'securitypoolx2-auction': ['Security pool x2 auction', 'child truth auction seeded with ten bids'],
	'finalized-truth-auction': ['Finalized truth auction', 'run past its end and finalized'],
	'ended-pool-commitment': ['Ended pool commitment', 'question has resolved while the pool stays operational'],
	'escalation-in-progress': ['Escalation in progress', 'disputed by a larger No report'],
	'liquidation-distance': ['Liquidation distance', 'minimum liquidation price distance'],
	'near-minimum-vault': ['Near-minimum vault', 'just above the security multiplier'],
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
