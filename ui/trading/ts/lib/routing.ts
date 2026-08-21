import { buildRouteHref, getRouteHashSearch, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/lib/routing.js'

export type TradingRoute = 'markets' | 'market' | 'liquidity' | 'portfolio' | 'deploy' | 'help' | `security-pool/${string}`

export const TRADING_ROUTING_CONFIG: RoutingConfig<TradingRoute> = {
	defaultRoute: 'markets',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: '#/markets', name: 'markets' },
		{ hash: '#/market', name: 'market' },
		{ hash: '#/liquidity', name: 'liquidity' },
		{ hash: '#/portfolio', name: 'portfolio' },
		{ hash: '#/help', name: 'help' },
		{
			match: (routeHash: string): TradingRoute | undefined => {
				const match = /^#\/security-pool\/(0x[0-9a-f]{40})$/i.exec(routeHash)
				return match === null ? undefined : `security-pool/${match[1]}`
			},
		},
	],
}

export function normalizeTradingRouteHash(hash: string) {
	const queryIndex = hash.indexOf('?')
	const routeHash = queryIndex === -1 ? hash : hash.slice(0, queryIndex)
	const search = queryIndex === -1 ? '' : hash.slice(queryIndex)
	const routePath = routeHash.replace(/^#\/?/, '')
	return `${routePath === '' ? '' : `#/${routePath}`}${search}`
}

export function getTradingRouteHref(routeHash: string) {
	return buildRouteHref(routeHash, getRouteHashSearch())
}

export function getTradingEnvironmentLocationKey(location: Pick<Location, 'hash' | 'search'> = window.location) {
	return `${location.search}|${getRouteHashSearch(location.hash)}`
}

export function installTradingRouting() {
	installRouting(TRADING_ROUTING_CONFIG)
}
