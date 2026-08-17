import { assertNever } from '../lib/assert.js'

export const CORE_SIMULATION_SCENARIOS = ['baseline', 'deployed'] as const

export type CoreSimulationScenario = (typeof CORE_SIMULATION_SCENARIOS)[number]

export type SimulationScenario = string

type ScenarioPresentation = {
	description: string
	label: string
}

const scenarioPresentations = new Map<SimulationScenario, ScenarioPresentation>()

export function registerSimulationScenario(scenario: SimulationScenario, presentation: ScenarioPresentation) {
	scenarioPresentations.set(scenario, presentation)
}

export function getRegisteredSimulationScenarios(): readonly SimulationScenario[] {
	return [...CORE_SIMULATION_SCENARIOS, ...scenarioPresentations.keys()]
}

export function getSimulationScenarioLabel(scenario: SimulationScenario) {
	const registered = scenarioPresentations.get(scenario)
	if (registered !== undefined) return registered.label
	return getCoreSimulationScenarioLabel(scenario as CoreSimulationScenario)
}

export function getSimulationScenarioDescription(scenario: SimulationScenario) {
	const registered = scenarioPresentations.get(scenario)
	if (registered !== undefined) return registered.description
	return getCoreSimulationScenarioDescription(scenario as CoreSimulationScenario)
}

export function isCoreSimulationScenario(value: string): value is CoreSimulationScenario {
	return (CORE_SIMULATION_SCENARIOS as readonly string[]).includes(value)
}

export function normalizeSimulationScenario(value: string | undefined): CoreSimulationScenario {
	return value !== undefined && isCoreSimulationScenario(value) ? value : 'baseline'
}

export function getCoreSimulationScenarioLabel(scenario: CoreSimulationScenario) {
	switch (scenario) {
		case 'baseline':
			return 'Baseline'
		case 'deployed':
			return 'Deployed'
		default:
			return assertNever(scenario)
	}
}

export function getCoreSimulationScenarioDescription(scenario: CoreSimulationScenario) {
	switch (scenario) {
		case 'baseline':
			return 'Fresh walletless simulation with funded QA accounts and no app contracts deployed. Use it to test the Deploy flow from scratch.'
		case 'deployed':
			return 'App contracts are deployed, but no security pools or questions are created. Use it to test setup flows from an empty deployment.'
		default:
			return assertNever(scenario)
	}
}
