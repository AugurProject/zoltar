import type { ChainBackend } from './chainBackend.js'
import { createInjectedBackend } from './chainBackend.js'
import { getErrorMessage } from './errors.js'
import type { NetworkProfile } from './networkProfile.js'
import type { SimulationController } from '../simulation/controller.js'
import { getSavedSimulationStateEnvelope } from '../simulation/savedStates.js'
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

const SIMULATION_QUERY_PARAM = 'simulate'
const SIMULATION_QUERY_VALUE = '1'

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
	// Simulation mode is intentionally available as a public URL opt-in on any hostname,
	// including production deployments. It boots a browser-local chain instead of
	// granting privileged access to production state.
	return params.get(SIMULATION_QUERY_PARAM) === SIMULATION_QUERY_VALUE
}

function getSimulationScenario(location: LocationLike): SimulationScenario {
	const params = readLocationParams(location)
	return normalizeSimulationScenario(params.get('simScenario') ?? undefined)
}

function getSimulationStateId(location: LocationLike) {
	const params = readLocationParams(location)
	const stateId = params.get('simState')
	return stateId === null || stateId.trim() === '' ? undefined : stateId
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

	const savedStateId = getSimulationStateId(location)
	let initialBootstrapError: string | undefined = undefined
	let savedState = undefined
	if (savedStateId !== undefined) {
		try {
			savedState = getSavedSimulationStateEnvelope(savedStateId)
		} catch (error) {
			initialBootstrapError = `Saved simulation state "${savedStateId}" could not be loaded. ${getErrorMessage(error, 'The saved state is invalid')}. Falling back to the baseline scenario.`
		}
		if (savedState === undefined && initialBootstrapError === undefined) {
			initialBootstrapError = `Saved simulation state "${savedStateId}" could not be loaded. Falling back to the baseline scenario.`
		}
	}
	const simulationBackend =
		savedStateId !== undefined && savedState !== undefined
			? await createSimulationBackend({
					savedState,
					savedStateId,
				})
			: await createSimulationBackend({
					...(initialBootstrapError === undefined ? {} : { initialBootstrapError }),
					scenario: savedStateId === undefined ? getSimulationScenario(location) : 'baseline',
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
