import type { Route } from '../types/app.js'

export const DEPLOY_ROUTE = '#/deploy'
export const MARKET_ROUTE = '#/markets'
export const SECURITY_POOL_ROUTE = '#/security-pools'
export const SECURITY_POOLS_OVERVIEW_ROUTE = '#/security-pools-overview'
export const SECURITY_VAULT_ROUTE = '#/security-vaults'
export const OPEN_ORACLE_ROUTE = '#/open-oracle'
export const REPORTING_ROUTE = '#/reporting'
export const TRADING_ROUTE = '#/trading'
export const FORK_AUCTION_ROUTE = '#/fork-auctions'
const ROUTE_HASHES: Record<Route, string> = {
	deploy: DEPLOY_ROUTE,
	markets: MARKET_ROUTE,
	'security-pools': SECURITY_POOL_ROUTE,
	'security-pools-overview': SECURITY_POOLS_OVERVIEW_ROUTE,
	'security-vaults': SECURITY_VAULT_ROUTE,
	'open-oracle': OPEN_ORACLE_ROUTE,
	reporting: REPORTING_ROUTE,
	trading: TRADING_ROUTE,
	'fork-auctions': FORK_AUCTION_ROUTE,
}

const ROUTE_BY_HASH: Record<string, Route> = {
	[DEPLOY_ROUTE]: 'deploy',
	[MARKET_ROUTE]: 'markets',
	[SECURITY_POOL_ROUTE]: 'security-pools',
	[SECURITY_POOLS_OVERVIEW_ROUTE]: 'security-pools-overview',
	[SECURITY_VAULT_ROUTE]: 'security-vaults',
	[OPEN_ORACLE_ROUTE]: 'open-oracle',
	[REPORTING_ROUTE]: 'reporting',
	[TRADING_ROUTE]: 'trading',
	[FORK_AUCTION_ROUTE]: 'fork-auctions',
}

export function ensureRouteHash() {
	if (window.location.hash === '') {
		window.location.hash = ROUTE_HASHES.deploy
	}
}

export function getCurrentRoute() {
	return ROUTE_BY_HASH[window.location.hash] ?? 'deploy'
}

export function getRouteHash(route: Route) {
	return ROUTE_HASHES[route]
}
