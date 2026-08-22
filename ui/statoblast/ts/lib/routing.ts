import { createRouting, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/lib/routing.js'
import type { Route } from '../types/app.js'

type StatoblastRoute = Exclude<Route, 'not-found'>

const STATOBLAST_ROUTING_CONFIG: RoutingConfig<StatoblastRoute> = {
	defaultRoute: 'security-pools',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: '#/security-pools', name: 'security-pools', queryParameters: new Set(['questionId', 'securityPool', 'securityPoolsView', 'selectedPoolView']) },
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleReportId', 'openOracleView']) },
	],
}

export const statoblastRouting = createRouting(STATOBLAST_ROUTING_CONFIG)

export function installStatoblastRouting() {
	installRouting(STATOBLAST_ROUTING_CONFIG)
}
