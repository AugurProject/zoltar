import { SIMULATION_QUERY_PARAM, SIMULATION_QUERY_VALUE } from '../lib/activeEnvironment.js'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../navigation/routing.js'

function buildSimulationSearch(update: (params: URLSearchParams) => void) {
	const params = new URLSearchParams(getRouteHashSearch())
	if (new URLSearchParams(window.location.search).get(SIMULATION_QUERY_PARAM) === SIMULATION_QUERY_VALUE) {
		params.delete(SIMULATION_QUERY_PARAM)
	} else {
		params.set(SIMULATION_QUERY_PARAM, SIMULATION_QUERY_VALUE)
	}
	update(params)
	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

function getSimulationLocation(nextSearch: string) {
	const nextUrl = new URL(buildRouteHref(getCurrentRouteHash(), nextSearch), window.location.href)
	// The hash search now carries the scenario or saved-state selection, so stale page-level copies would disagree with what is actually loaded.
	nextUrl.searchParams.delete('simScenario')
	nextUrl.searchParams.delete('simState')
	return nextUrl.toString()
}

export function getBuiltInScenarioLocation(scenario: string) {
	const nextSearch = buildSimulationSearch(params => {
		params.set('simScenario', scenario)
		params.delete('simState')
	})
	return getSimulationLocation(nextSearch)
}

export function getSavedSimulationStateLocation(stateId: string) {
	const nextSearch = buildSimulationSearch(params => {
		params.delete('simScenario')
		params.set('simState', stateId)
	})
	return getSimulationLocation(nextSearch)
}

export function hasSavedSimulationStateRoute() {
	const params = new URLSearchParams(getRouteHashSearch())
	const stateId = params.get('simState')
	return stateId !== null && stateId.trim() !== ''
}

function stageSimulationLocation(nextUrl: string) {
	window.history.replaceState({}, '', nextUrl)
	window.dispatchEvent(new window.PopStateEvent('popstate'))
}

function restoreSimulationLocation(previousUrl: string) {
	window.history.replaceState({}, '', previousUrl)
	window.dispatchEvent(new window.PopStateEvent('popstate'))
}

function commitSimulationLocation(previousUrl: string, nextUrl: string) {
	window.history.replaceState({}, '', previousUrl)
	window.history.pushState({}, '', nextUrl)
}

export async function refreshEnvironmentAtSimulationLocation(nextUrl: string, onEnvironmentChanged: () => Promise<void>) {
	const previousUrl = window.location.href
	stageSimulationLocation(nextUrl)
	try {
		await onEnvironmentChanged()
	} catch (error) {
		restoreSimulationLocation(previousUrl)
		throw error
	}
	commitSimulationLocation(previousUrl, nextUrl)
}
