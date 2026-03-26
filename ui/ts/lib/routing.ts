import type { Route } from '../types/app.js'

export const DEPLOY_ROUTE = '#/deploy'
export const MARKET_ROUTE = '#/markets'
export const SECURITY_POOL_ROUTE = '#/security-pools'
export const SECURITY_POOLS_OVERVIEW_ROUTE = '#/security-pools-overview'
export const SECURITY_VAULT_ROUTE = '#/security-vaults'
export const OPEN_ORACLE_ROUTE = '#/open-oracle'
export const TRADING_ROUTE = '#/trading'

export function ensureRouteHash() {
	if (window.location.hash === '') {
		window.location.hash = DEPLOY_ROUTE
	}
}

export function getCurrentRoute() {
	if (window.location.hash === MARKET_ROUTE) return 'markets' satisfies Route
	if (window.location.hash === SECURITY_POOL_ROUTE) return 'security-pools' satisfies Route
	if (window.location.hash === SECURITY_POOLS_OVERVIEW_ROUTE) return 'security-pools-overview' satisfies Route
	if (window.location.hash === SECURITY_VAULT_ROUTE) return 'security-vaults' satisfies Route
	if (window.location.hash === OPEN_ORACLE_ROUTE) return 'open-oracle' satisfies Route
	if (window.location.hash === TRADING_ROUTE) return 'trading' satisfies Route
	return 'deploy' satisfies Route
}
