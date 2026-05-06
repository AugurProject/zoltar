import type { ChainBackend } from './chainBackend.js'
import { createInjectedBackend } from './chainBackend.js'
import type { NetworkProfile } from './networkProfile.js'
import type { SimulationController } from '../simulation/controller.js'
import { createSimulationBackend } from '../simulation/tevmBackend.js'
import { normalizeSimulationScenario, type SimulationScenario } from '../simulation/scenarios.js'

type LocationLike = {
	hostname: string
	search: string
}

const injectedBackend = createInjectedBackend()

let activeBackend: ChainBackend | undefined = undefined
let activeSimulationController: SimulationController | undefined = undefined

export function shouldUseSimulationLocation(location: LocationLike) {
	const params = new URLSearchParams(location.search)
	return params.get('simulate') === '1'
}

function getSimulationScenario(search: string): SimulationScenario {
	const params = new URLSearchParams(search)
	return normalizeSimulationScenario(params.get('simScenario') ?? undefined)
}

export async function initializeActiveEnvironment(location: LocationLike = window.location) {
	if (!shouldUseSimulationLocation(location)) {
		activeBackend = injectedBackend
		activeSimulationController = undefined
		return injectedBackend
	}

	const simulationBackend = await createSimulationBackend({
		scenario: getSimulationScenario(location.search),
	})
	activeBackend = simulationBackend
	activeSimulationController = simulationBackend
	void simulationBackend.bootstrap().catch(error => {
		console.error('[simulation] bootstrap failed', error)
	})
	return simulationBackend
}

export function getActiveBackend() {
	return activeBackend ?? injectedBackend
}

export function getActiveNetworkProfile(): NetworkProfile {
	return getActiveBackend().profile
}

export function getActiveSimulationController() {
	return activeSimulationController
}

export function setActiveEnvironmentForTesting(backend: ChainBackend, simulationController?: SimulationController) {
	activeBackend = backend
	activeSimulationController = simulationController
}

export function resetActiveEnvironmentForTesting() {
	activeBackend = undefined
	activeSimulationController = undefined
}
