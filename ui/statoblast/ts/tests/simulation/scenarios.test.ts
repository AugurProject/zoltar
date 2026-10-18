/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { registerStatoblastSimulationScenarios } from '../../simulation/index.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { STATOBLAST_SCENARIOS } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'

type StatoblastScenario = (typeof STATOBLAST_SCENARIOS)[number]

// Every scenario needs an entry, so a new one cannot register without a checked label and description.
const EXPECTED_PRESENTATION = {
	portfolio: ['Portfolio', 'A shared REP reserve funding two questions'],
	'security-pool': ['Security pool', 'seeded question'],
	securitypoolx2: ['Security pool x2', 'Two seeded questions with two security pools'],
	'securitypoolx2-auction': ['Security pool x2 auction', 'child truth auction seeded with ten bids'],
	'finalized-truth-auction': ['Finalized truth auction', 'run past its end and finalized'],
	'ended-pool-commitment': ['Ended pool commitment', 'question has resolved while the pool stays operational'],
	'escalation-in-progress': ['Escalation in progress', 'disputed by a larger No report'],
	'liquidation-distance': ['Liquidation distance', 'minimum liquidation price distance'],
	'near-minimum-vault': ['Near-minimum vault', 'just above the security multiplier'],
} satisfies Record<StatoblastScenario, readonly [label: string, descriptionFragment: string]>

void describe('statoblast simulation scenarios', () => {
	void test('registers every scenario into the shared registry with its readable label and description', () => {
		registerStatoblastSimulationScenarios()
		const registered = getRegisteredSimulationScenarios()
		for (const scenario of STATOBLAST_SCENARIOS) {
			const [label, descriptionFragment] = EXPECTED_PRESENTATION[scenario]
			expect(registered).toContain(scenario)
			expect(getSimulationScenarioLabel(scenario)).toBe(label)
			expect(getSimulationScenarioDescription(scenario)).toContain(descriptionFragment)
		}
	})
})
