import { parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { registerSimulationScenario } from '@zoltar/ui-core-shared/simulation/scenarios.js'

// Intentionally reuses the core `deployed` id so Trading's seeded-pool bootstrap and presentation replace the Statoblast-only core scenario.
export const DEPLOYED_TRADING_SIMULATION_SCENARIO = 'deployed'
export const FUNDED_TRADING_SIMULATION_SCENARIO = 'trading-funded'

export function registerTradingSimulationScenario() {
	registerSimulationScenario(DEPLOYED_TRADING_SIMULATION_SCENARIO, {
		description: 'A seeded Statoblast security pool with the trading factory and router deployed for walletless trade, liquidity, and settlement testing.',
		label: 'Deployed',
	})
	registerSimulationScenario(FUNDED_TRADING_SIMULATION_SCENARIO, {
		description: 'A deployed trading market with liquidity and YES, NO, INVALID, and LP shares in the simulation wallet.',
		label: 'Trading with liquidity',
	})
}

/** Returns the URL to replace the current one with when `simulate=1` was opened without a scenario or saved-state selection. */
export function withDefaultTradingSimulationScenario(href: string): URL | undefined {
	const url = new URL(href)
	const { routeHash, search } = parseRouteHash(url.hash)
	const hashParams = new URLSearchParams(search)
	const pageSimulation = url.searchParams.get('simulate') === '1'
	if (!pageSimulation && hashParams.get('simulate') !== '1') return undefined
	if (['simScenario', 'simState'].some(key => url.searchParams.has(key) || hashParams.has(key))) return undefined
	if (pageSimulation) {
		url.searchParams.set('simScenario', FUNDED_TRADING_SIMULATION_SCENARIO)
		return url
	}
	hashParams.set('simScenario', FUNDED_TRADING_SIMULATION_SCENARIO)
	url.hash = `${routeHash}?${hashParams.toString()}`
	return url
}
