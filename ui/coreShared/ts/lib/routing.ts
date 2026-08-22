export type AppRoute = string

type RouteDefinitionBase = {
	readonly aliases?: readonly string[]
	readonly queryParameters?: ReadonlySet<string>
}

export type RouteDefinition<TRoute extends AppRoute = AppRoute> = RouteDefinitionBase & ({ readonly hash: string; readonly match?: never; readonly name: TRoute } | { readonly hash?: never; readonly match: (routeHash: string) => TRoute | undefined; readonly name?: never })

export type RoutingConfig<TRoute extends AppRoute = AppRoute> = {
	readonly defaultRoute: TRoute
	readonly routes: readonly RouteDefinition<TRoute>[]
}

const SHARED_ROUTE_QUERY_PARAMETERS = new Set(['network', 'rpcUrl', 'simScenario', 'simState', 'simulate', 'universe'])

type RoutingState<TRoute extends AppRoute = AppRoute> = {
	readonly config: RoutingConfig<TRoute>
	readonly routeByHash: Readonly<Record<string, TRoute>>
	readonly hashByRoute: Readonly<Partial<Record<TRoute, string>>>
	readonly queryParametersByRoute: Readonly<Record<string, ReadonlySet<string>>>
	readonly routeMatchers: readonly ((routeHash: string) => TRoute | undefined)[]
}

function buildRoutingState<TRoute extends AppRoute>(config: RoutingConfig<TRoute>): RoutingState<TRoute> {
	const routeByHash: Record<string, TRoute> = {}
	const hashByRoute: Partial<Record<TRoute, string>> = {}
	const queryParametersByRoute: Record<string, ReadonlySet<string>> = {}
	const routeMatchers: ((routeHash: string) => TRoute | undefined)[] = []
	for (const route of config.routes) {
		if (route.hash !== undefined) {
			routeByHash[route.hash] = route.name
			for (const alias of route.aliases ?? []) routeByHash[alias] = route.name
			hashByRoute[route.name] = route.hash
			queryParametersByRoute[route.name] = route.queryParameters ?? new Set()
		}
		if (route.match !== undefined) routeMatchers.push(route.match)
	}
	return { config, routeByHash, hashByRoute, queryParametersByRoute, routeMatchers }
}

function resolveRoutingStateRoute<TRoute extends AppRoute>(routing: RoutingState<TRoute>, hash: string): TRoute | 'not-found' {
	const { routeHash } = parseRouteHash(hash)
	const exactRoute = routing.routeByHash[routeHash]
	if (exactRoute !== undefined) return exactRoute
	if (routeHash === '') return routing.config.defaultRoute
	for (const matchRoute of routing.routeMatchers) {
		const matchedRoute = matchRoute(routeHash)
		if (matchedRoute !== undefined) return matchedRoute
	}
	return 'not-found'
}

export function resolveRoute<TRoute extends AppRoute>(config: RoutingConfig<TRoute>, hash: string): TRoute | 'not-found' {
	return resolveRoutingStateRoute(buildRoutingState(config), hash)
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

export function parseRouteHash(hash: string) {
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

export function normalizeRouteHash(hash: string) {
	const { routeHash, search } = parseRouteHash(hash)
	const routePath = routeHash.replace(/^#\/?/, '')
	return `${routePath === '' ? '' : `#/${routePath}`}${search}`
}

export function createRouting<TRoute extends AppRoute>(config: RoutingConfig<TRoute>) {
	const routing = buildRoutingState(config)
	return {
		getHash(route: TRoute) {
			const hash = routing.hashByRoute[route]
			if (hash === undefined) throw new Error(`Unknown route: ${route}`)
			return hash
		},
		resolve(hash: string): TRoute | 'not-found' {
			return resolveRoutingStateRoute(routing, normalizeRouteHash(hash))
		},
	}
}

export function ensureRouteHash() {
	const routing = requireRouting()
	if (window.location.hash === '') window.location.hash = routing.hashByRoute[routing.config.defaultRoute] ?? ''
}

export function getCurrentRoute(): AppRoute | 'not-found' {
	return resolveRoutingStateRoute(requireRouting(), window.location.hash)
}

export function getRouteHash(route: AppRoute) {
	return getRouteHashForName(route)
}

export function getRouteHashSearch(hash = window.location.hash) {
	return parseRouteHash(hash).search
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
	const { routeHash } = parseRouteHash(window.location.hash)
	return routeHash === '' ? (routing.hashByRoute[routing.config.defaultRoute] ?? '') : routeHash
}

export function buildRouteHref(routeHash: string, search: string) {
	return `${routeHash}${search}`
}
