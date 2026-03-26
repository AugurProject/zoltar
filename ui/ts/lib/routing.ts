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

export function ensureRouteHash() {
	if (window.location.hash === '') {
		window.location.hash = DEPLOY_ROUTE
	}
}

export function getCurrentRoute() {
	switch (window.location.hash) {
		case MARKET_ROUTE:
			return 'markets' satisfies Route
		case SECURITY_POOL_ROUTE:
			return 'security-pools' satisfies Route
		case SECURITY_POOLS_OVERVIEW_ROUTE:
			return 'security-pools-overview' satisfies Route
		case SECURITY_VAULT_ROUTE:
			return 'security-vaults' satisfies Route
		case OPEN_ORACLE_ROUTE:
			return 'open-oracle' satisfies Route
		case REPORTING_ROUTE:
			return 'reporting' satisfies Route
		case TRADING_ROUTE:
			return 'trading' satisfies Route
		case FORK_AUCTION_ROUTE:
			return 'fork-auctions' satisfies Route
		case DEPLOY_ROUTE:
		case '':
			return 'deploy' satisfies Route
		default:
			return 'deploy' satisfies Route
	}
}
