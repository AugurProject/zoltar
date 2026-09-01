/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription, getSimulationScenarioLabel } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { getZoltarScenarioDescription, getZoltarScenarioLabel, isZoltarScenario, registerZoltarSimulationScenarios } from '../../simulation/index.js'

void describe('zoltar simulation scenarios', () => {
	void test('recognizes zoltar scenarios', () => {
		expect(isZoltarScenario('forked-categorical')).toBe(true)
		expect(isZoltarScenario('baseline')).toBe(false)
	})

	void test('returns labels and descriptions for zoltar scenarios', () => {
		expect(getZoltarScenarioLabel('forked-categorical')).toBe('Forked categorical')
		expect(getZoltarScenarioDescription('forked-categorical')).toContain('five-way categorical fork')
	})

	void test('registers scenarios into the shared registry', () => {
		registerZoltarSimulationScenarios()
		expect(getRegisteredSimulationScenarios()).toContain('forked-categorical')
		expect(getSimulationScenarioLabel('forked-categorical')).toBe('Forked categorical')
		expect(getSimulationScenarioDescription('forked-categorical')).toContain('two child universes are deployed')
	})
})
