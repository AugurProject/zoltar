import type { Route } from '../types/app.js'

export const DEPLOY_ROUTE = '#/deploy'
export const ZOLTAR_ROUTE = '#/zoltar'
export const SECURITY_POOLS_ROUTE = '#/security-pools'
export const OPEN_ORACLE_ROUTE = '#/open-oracle'
const DEFAULT_ROUTE: Exclude<Route, 'not-found'> = 'zoltar'
const ROUTE_NAMES: Exclude<Route, 'not-found'>[] = ['deploy', 'zoltar', 'security-pools', 'open-oracle']
const ROUTE_HASHES: Record<Exclude<Route, 'not-found'>, string> = {
	deploy: DEPLOY_ROUTE,
	zoltar: ZOLTAR_ROUTE,
	'security-pools': SECURITY_POOLS_ROUTE,
	'open-oracle': OPEN_ORACLE_ROUTE,
}

const ROUTE_BY_HASH = ROUTE_NAMES.reduce<Partial<Record<string, Route>>>((routeByHash, route) => {
	routeByHash[ROUTE_HASHES[route]] = route
	return routeByHash
}, {})

export function ensureRouteHash() {
	if (window.location.hash === '') {
		window.location.hash = ROUTE_HASHES[DEFAULT_ROUTE]
	}
}

export function getCurrentRoute() {
	return ROUTE_BY_HASH[window.location.hash] ?? (window.location.hash === '' ? DEFAULT_ROUTE : 'not-found')
}

export function getRouteHash(route: Exclude<Route, 'not-found'>) {
	return ROUTE_HASHES[route]
}
