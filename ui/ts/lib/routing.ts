import type { Route } from '../types/app.js'

export const DEPLOY_ROUTE = '#/deploy'
export const MARKET_ROUTE = '#/markets'

export function getCurrentRoute() {
	if (window.location.hash === MARKET_ROUTE) return 'markets' satisfies Route
	if (window.location.hash === '') {
		window.location.hash = DEPLOY_ROUTE
	}
	return 'deploy' satisfies Route
}
