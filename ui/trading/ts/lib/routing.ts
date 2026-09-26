import { buildRouteHref, createRouting, getRouteHashSearch, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { withoutTicketSideParam } from './ticketSide.js'

export type TradingRoute = 'create-market' | 'market' | 'liquidity' | 'portfolio' | 'universe' | 'deploy' | 'help' | `security-pool/${string}` | `market/${string}` | `liquidity/${string}` | `create-market/${string}`

export type TradingLookupRoute = Extract<TradingRoute, 'market' | 'liquidity' | 'create-market'>

/** Candidate list a lookup landing pages through: trading markets for trade and liquidity, security pools without a pair for market creation. */
export type TradingListKind = 'markets' | 'security-pools'

const TRADING_ROUTING_CONFIG: RoutingConfig<TradingRoute> = {
	defaultRoute: 'market',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		// The retired browse hashes resolve to the lookup landing that replaced them so old bookmarks keep working.
		{ aliases: ['#/markets', '#/developer'], hash: '#/market', name: 'market' },
		{ aliases: ['#/security-pools'], hash: '#/create-market', name: 'create-market' },
		{ hash: '#/liquidity', name: 'liquidity' },
		{ hash: '#/portfolio', name: 'portfolio' },
		{ hash: '#/universe', name: 'universe' },
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

/**
 * The parts of the location that select the environment; the universe parameter changes what the routes show, and the
 * ticket side only preselects an outcome, so neither changes which chain the routes read.
 */
export function getTradingEnvironmentLocationKey(location: Pick<Location, 'hash' | 'search'> = window.location) {
	return `${location.search}|${withoutTicketSideParam(writeUniverseQueryParam(getRouteHashSearch(location.hash), undefined))}`
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

export function isTradingLookupRoute(route: string): route is TradingLookupRoute {
	return route === 'market' || route === 'liquidity' || route === 'create-market'
}

/** Lookup routes are list-first: each pages through the candidates of its workflow. Other routes have no list. */
export function tradingListKindFor(route: string): TradingListKind | undefined {
	if (!isTradingLookupRoute(route)) return undefined
	return route === 'create-market' ? 'security-pools' : 'markets'
}
