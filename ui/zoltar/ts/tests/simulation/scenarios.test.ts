/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { registerZoltarSimulationScenarios } from '../../simulation/index.js'

void describe('zoltar simulation scenarios', () => {
	void test('registers scenarios into the shared registry', () => {
		registerZoltarSimulationScenarios()
		expect(getRegisteredSimulationScenarios()).toContain('two-questions')
		expect(getRegisteredSimulationScenarios()).toContain('forked-categorical')
		expect(getSimulationScenarioLabel('two-questions')).toBe('Two questions')
		expect(getSimulationScenarioLabel('forked-categorical')).toBe('Forked categorical')
		expect(getSimulationScenarioDescription('forked-categorical')).toContain('five-way categorical fork')
		expect(getSimulationScenarioDescription('forked-categorical')).toContain('two child universes are deployed')
	})
})
