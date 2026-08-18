export type AppRoute = string

export type RouteDefinition = {
	readonly hash: string
	readonly name: AppRoute
	readonly queryParameters?: ReadonlySet<string>
}

export type RoutingConfig = {
	readonly defaultRoute: AppRoute
	readonly routes: readonly RouteDefinition[]
}

const SHARED_ROUTE_QUERY_PARAMETERS = new Set(['network', 'rpcUrl', 'simScenario', 'simState', 'simulate', 'universe'])

type RoutingState = {
	readonly config: RoutingConfig
	readonly routeByHash: Readonly<Record<string, AppRoute>>
	readonly hashByRoute: Readonly<Record<string, string>>
	readonly queryParametersByRoute: Readonly<Record<string, ReadonlySet<string>>>
}

function buildRoutingState(config: RoutingConfig): RoutingState {
	const routeByHash: Record<string, AppRoute> = {}
	const hashByRoute: Record<string, string> = {}
	const queryParametersByRoute: Record<string, ReadonlySet<string>> = {}
	for (const route of config.routes) {
		routeByHash[route.hash] = route.name
		hashByRoute[route.name] = route.hash
		queryParametersByRoute[route.name] = route.queryParameters ?? new Set()
	}
	return { config, routeByHash, hashByRoute, queryParametersByRoute }
}

declare global {
	var __zoltarActiveRoutingState__: RoutingState | undefined
}

function getRoutingState(): RoutingState | undefined {
	return globalThis.__zoltarActiveRoutingState__
}

export function installRouting(config: RoutingConfig) {
	globalThis.__zoltarActiveRoutingState__ = buildRoutingState(config)
}

export function resetRoutingForTesting() {
	globalThis.__zoltarActiveRoutingState__ = undefined
}

function requireRouting(): RoutingState {
	const activeRouting = getRoutingState()
	if (activeRouting === undefined) throw new Error('Routing has not been installed. Call installRouting() during application bootstrap before reading routes.')
	return activeRouting
}

export function getRouteHashForName(route: AppRoute) {
	const hash = requireRouting().hashByRoute[route]
	if (hash === undefined) throw new Error(`Unknown route: ${route}`)
	return hash
}

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
	const routing = requireRouting()
	if (window.location.hash === '') window.location.hash = routing.hashByRoute[routing.config.defaultRoute] ?? ''
}

export function getCurrentRoute(): AppRoute | 'not-found' {
	const routing = requireRouting()
	const { routeHash } = splitRouteHash(window.location.hash)
	return routing.routeByHash[routeHash] ?? (routeHash === '' ? routing.config.defaultRoute : 'not-found')
}

export function getRouteHash(route: AppRoute) {
	return getRouteHashForName(route)
}

export function getRouteHashSearch(hash = window.location.hash) {
	return splitRouteHash(hash).search
}

export function getTopLevelRouteSearch(nextRoute: AppRoute, search = getRouteHashSearch(), preservedParameters: ReadonlySet<string> = new Set()) {
	const routing = requireRouting()
	const destinationParameters = routing.queryParametersByRoute[nextRoute] ?? new Set<string>()
	const sourceParameters = new URLSearchParams(search)
	const destinationSearch = new URLSearchParams()
	for (const [key, value] of sourceParameters) {
		if (SHARED_ROUTE_QUERY_PARAMETERS.has(key) || destinationParameters.has(key) || preservedParameters.has(key)) destinationSearch.append(key, value)
	}
	const serializedSearch = destinationSearch.toString()
	return serializedSearch === '' ? '' : `?${serializedSearch}`
}

export function getCurrentRouteHash() {
	const routing = requireRouting()
	const { routeHash } = splitRouteHash(window.location.hash)
	return routeHash === '' ? routing.hashByRoute[routing.config.defaultRoute] ?? '' : routeHash
}

export function buildRouteHref(routeHash: string, search: string) {
	return `${routeHash}${search}`
}
