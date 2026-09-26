import { createRouting, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'
import type { Route } from '../types/app.js'
import { parsePoolsRouteHash, POOLS_ROUTE_HASH, PORTFOLIO_ROUTE_HASH } from './statoblastLocation.js'

type StatoblastRoute = Exclude<Route, 'not-found'>

const STATOBLAST_ROUTING_CONFIG: RoutingConfig<StatoblastRoute> = {
	defaultRoute: 'portfolio',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: PORTFOLIO_ROUTE_HASH, name: 'portfolio' },
		// The pre-portfolio security pools hash resolves to Pools; the URL state rewrites its query onto the pool path.
		{ aliases: ['#/security-pools'], hash: POOLS_ROUTE_HASH, name: 'pools', queryParameters: new Set(['questionId']) },
		{ match: routeHash => (parsePoolsRouteHash(routeHash) === undefined ? undefined : 'pools') },
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleReportId', 'openOracleView']) },
	],
}

export const statoblastRouting = createRouting(STATOBLAST_ROUTING_CONFIG)

export function installStatoblastRouting() {
	installRouting(STATOBLAST_ROUTING_CONFIG)
}
