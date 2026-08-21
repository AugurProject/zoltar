import { buildRouteHref, getRouteHashSearch, installRouting } from '@zoltar/ui-core-shared/lib/routing.js'

export function getTradingRouteHref(routeHash: string) {
	return buildRouteHref(routeHash, getRouteHashSearch())
}

export function getTradingRoutePath(hash: string) {
	return hash.split('?')[0] ?? ''
}

export function getTradingEnvironmentLocationKey(location: Pick<Location, 'hash' | 'search'> = window.location) {
	return `${location.search}|${getRouteHashSearch(location.hash)}`
}

export function installTradingRouting() {
	installRouting({
		defaultRoute: 'markets',
		routes: [
			{ hash: '#/deploy', name: 'deploy' },
			{ hash: '#/markets', name: 'markets' },
			{ hash: '#/market', name: 'market' },
			{ hash: '#/liquidity', name: 'liquidity' },
			{ hash: '#/portfolio', name: 'portfolio' },
			{ hash: '#/help', name: 'help' },
		],
	})
}
