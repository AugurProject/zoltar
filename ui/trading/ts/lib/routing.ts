import { buildRouteHref, createRouting, getRouteHashSearch, installRouting, normalizeRouteHash, type RoutingConfig } from '@zoltar/ui-core-shared/lib/routing.js'

export type TradingRoute = 'markets' | 'market' | 'liquidity' | 'portfolio' | 'deploy' | 'help' | `security-pool/${string}`

export const TRADING_ROUTING_CONFIG: RoutingConfig<TradingRoute> = {
	defaultRoute: 'markets',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ aliases: ['#/developer'], hash: '#/markets', name: 'markets' },
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

export const tradingRouting = createRouting(TRADING_ROUTING_CONFIG)

export const normalizeTradingRouteHash = normalizeRouteHash

export function getTradingRouteHref(routeHash: string) {
	return buildRouteHref(routeHash, getRouteHashSearch())
}

export function getTradingEnvironmentLocationKey(location: Pick<Location, 'hash' | 'search'> = window.location) {
	return `${location.search}|${getRouteHashSearch(location.hash)}`
}

export function installTradingRouting() {
	installRouting(TRADING_ROUTING_CONFIG)
}
