const SHARED_ROUTE_QUERY_PARAMETERS = new Set(['network', 'rpcUrl', 'simScenario', 'simState', 'simulate', 'universe']);
function buildRoutingState(config) {
    const routeByHash = {};
    const hashByRoute = {};
    const queryParametersByRoute = {};
    for (const route of config.routes) {
        routeByHash[route.hash] = route.name;
        hashByRoute[route.name] = route.hash;
        queryParametersByRoute[route.name] = route.queryParameters ?? new Set();
    }
    return { config, routeByHash, hashByRoute, queryParametersByRoute };
}
function getRoutingState() {
    return globalThis.__zoltarActiveRoutingState__;
}
export function installRouting(config) {
    globalThis.__zoltarActiveRoutingState__ = buildRoutingState(config);
}
export function resetRoutingForTesting() {
    globalThis.__zoltarActiveRoutingState__ = undefined;
}
function requireRouting() {
    const activeRouting = getRoutingState();
    if (activeRouting === undefined)
        throw new Error('Routing has not been installed. Call installRouting() during application bootstrap before reading routes.');
    return activeRouting;
}
export function getRouteHashForName(route) {
    const hash = requireRouting().hashByRoute[route];
    if (hash === undefined)
        throw new Error(`Unknown route: ${route}`);
    return hash;
}
function splitRouteHash(hash) {
    const queryIndex = hash.indexOf('?');
    if (queryIndex === -1)
        return {
            routeHash: hash,
            search: '',
        };
    return {
        routeHash: hash.slice(0, queryIndex),
        search: hash.slice(queryIndex),
    };
}
export function ensureRouteHash() {
    const routing = requireRouting();
    if (window.location.hash === '')
        window.location.hash = routing.hashByRoute[routing.config.defaultRoute] ?? '';
}
export function getCurrentRoute() {
    const routing = requireRouting();
    const { routeHash } = splitRouteHash(window.location.hash);
    return routing.routeByHash[routeHash] ?? (routeHash === '' ? routing.config.defaultRoute : 'not-found');
}
export function getRouteHash(route) {
    return getRouteHashForName(route);
}
export function getRouteHashSearch(hash = window.location.hash) {
    return splitRouteHash(hash).search;
}
export function getTopLevelRouteSearch(nextRoute, search = getRouteHashSearch(), preservedParameters = new Set()) {
    const routing = requireRouting();
    const destinationParameters = routing.queryParametersByRoute[nextRoute] ?? new Set();
    const sourceParameters = new URLSearchParams(search);
    const destinationSearch = new URLSearchParams();
    for (const [key, value] of sourceParameters) {
        if (SHARED_ROUTE_QUERY_PARAMETERS.has(key) || destinationParameters.has(key) || preservedParameters.has(key))
            destinationSearch.append(key, value);
    }
    const serializedSearch = destinationSearch.toString();
    return serializedSearch === '' ? '' : `?${serializedSearch}`;
}
export function getCurrentRouteHash() {
    const routing = requireRouting();
    const { routeHash } = splitRouteHash(window.location.hash);
    return routeHash === '' ? (routing.hashByRoute[routing.config.defaultRoute] ?? '') : routeHash;
}
export function buildRouteHref(routeHash, search) {
    return `${routeHash}${search}`;
}
//# sourceMappingURL=routing.js.map