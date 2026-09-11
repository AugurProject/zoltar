import { buildRouteHref, createRouting, getRouteHashSearch, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'

export type TradingRoute = 'markets' | 'security-pools' | 'create-market' | 'market' | 'liquidity' | 'portfolio' | 'deploy' | 'help' | `security-pool/${string}` | `market/${string}` | `liquidity/${string}` | `create-market/${string}`

export type TradingBrowseRoute = Extract<TradingRoute, 'markets' | 'security-pools'>
export type TradingLookupRoute = Extract<TradingRoute, 'market' | 'liquidity' | 'create-market'>

const TRADING_ROUTING_CONFIG: RoutingConfig<TradingRoute> = {
	defaultRoute: 'market',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ aliases: ['#/developer'], hash: '#/markets', name: 'markets' },
		{ hash: '#/security-pools', name: 'security-pools' },
		{ hash: '#/market', name: 'market' },
		{ hash: '#/create-market', name: 'create-market' },
		{ hash: '#/liquidity', name: 'liquidity' },
		{ hash: '#/portfolio', name: 'portfolio' },
		{ hash: '#/help', name: 'help' },
		{
			match: (routeHash: string): TradingRoute | undefined => {
				const match = /^#\/(security-pool|market|liquidity|create-market)\/(0x[0-9a-f]{40})$/i.exec(routeHash)
				if (match === null) return undefined
				const address = match[2]
				if (match[1] === 'market') return `market/${address}`
				if (match[1] === 'liquidity') return `liquidity/${address}`
				if (match[1] === 'create-market') return `create-market/${address}`
				return `security-pool/${address}`
			},
		},
	],
}

export const tradingRouting = createRouting(TRADING_ROUTING_CONFIG)

export function getTradingRouteHref(routeHash: string) {
	return buildRouteHref(routeHash, getRouteHashSearch())
}

export function getTradingEnvironmentLocationKey(location: Pick<Location, 'hash' | 'search'> = window.location) {
	return `${location.search}|${getRouteHashSearch(location.hash)}`
}

export function installTradingRouting() {
	installRouting(TRADING_ROUTING_CONFIG)
}

export function tradingWorkflowRoute<T extends TradingRoute | 'not-found'>(route: T) {
	if (route.startsWith('market/')) return 'market'
	if (route.startsWith('liquidity/')) return 'liquidity'
	if (route.startsWith('create-market/')) return 'create-market'
	return route
}

export function isTradingBrowseRoute(route: string): route is TradingBrowseRoute {
	return route === 'markets' || route === 'security-pools'
}

export function isTradingLookupRoute(route: string): route is TradingLookupRoute {
	return route === 'market' || route === 'liquidity' || route === 'create-market'
}

/** The browse route that lists candidates for a lookup workflow: trading markets for trade and liquidity, SecurityPools for market creation. */
export function tradingBrowseRouteFor(lookupRoute: TradingLookupRoute): TradingBrowseRoute {
	return lookupRoute === 'create-market' ? 'security-pools' : 'markets'
}
