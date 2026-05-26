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

function splitRouteHash(hash: string) {
	const queryIndex = hash.indexOf('?')
	if (queryIndex === -1)
		return {
			routeHash: hash,
			search: '',
		}

	return {
		routeHash: hash.slice(0, queryIndex),
		search: hash.slice(queryIndex),
	}
}

export function ensureRouteHash() {
	if (window.location.hash === '') window.location.hash = ROUTE_HASHES[DEFAULT_ROUTE]
}

export function getCurrentRoute() {
	const { routeHash } = splitRouteHash(window.location.hash)
	return ROUTE_BY_HASH[routeHash] ?? (routeHash === '' ? DEFAULT_ROUTE : 'not-found')
}

export function getRouteHash(route: Exclude<Route, 'not-found'>) {
	return ROUTE_HASHES[route]
}

export function getRouteHashSearch(hash = window.location.hash) {
	return splitRouteHash(hash).search
}

export function getCurrentRouteHash() {
	const { routeHash } = splitRouteHash(window.location.hash)
	return routeHash === '' ? ROUTE_HASHES[DEFAULT_ROUTE] : routeHash
}

export function buildRouteHref(routeHash: string, search: string) {
	return `${routeHash}${search}`
}
