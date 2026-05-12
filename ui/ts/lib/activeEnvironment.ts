import type { ChainBackend } from './chainBackend.js'
import { createInjectedBackend } from './chainBackend.js'
import type { NetworkProfile } from './networkProfile.js'
import type { SimulationController } from '../simulation/controller.js'
import { createSimulationBackend } from '../simulation/tevmBackend.js'
import { normalizeSimulationScenario, type SimulationScenario } from '../simulation/scenarios.js'

type LocationLike = {
	hash?: string
	hostname: string
	search: string
}

const injectedBackend = createInjectedBackend()

let activeBackend: ChainBackend | undefined = undefined
let activeSimulationController: SimulationController | undefined = undefined

function readLocationParams(location: LocationLike) {
	const params = new URLSearchParams(location.search)
	const hash = location.hash ?? ''
	const queryIndex = hash.indexOf('?')
	if (queryIndex === -1) return params

	for (const [key, value] of new URLSearchParams(hash.slice(queryIndex))) {
		params.set(key, value)
	}

	return params
}

export function shouldUseSimulationLocation(location: LocationLike) {
	const params = readLocationParams(location)
	return params.get('simulate') === '1'
}

function getSimulationScenario(location: LocationLike): SimulationScenario {
	const params = readLocationParams(location)
	return normalizeSimulationScenario(params.get('simScenario') ?? undefined)
}

export async function initializeActiveEnvironment(location: LocationLike = window.location) {
	if (activeSimulationController !== undefined) {
		await activeSimulationController.dispose()
		activeSimulationController = undefined
	}

	if (!shouldUseSimulationLocation(location)) {
		activeBackend = injectedBackend
		return injectedBackend
	}

	const simulationBackend = await createSimulationBackend({
		scenario: getSimulationScenario(location),
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

function setActiveEnvironmentForTesting(backend: ChainBackend, simulationController?: SimulationController) {
	activeBackend = backend
	activeSimulationController = simulationController
}

export function installActiveEnvironmentForTesting(backend: ChainBackend, simulationController?: SimulationController) {
	setActiveEnvironmentForTesting(backend, simulationController)
	return () => {
		resetActiveEnvironmentForTesting()
	}
}

export function resetActiveEnvironmentForTesting() {
	activeBackend = undefined
	activeSimulationController = undefined
}
