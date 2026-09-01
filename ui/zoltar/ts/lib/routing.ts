import { createRouting, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/lib/routing.js'
import type { Route } from '../types/app.js'

type ZoltarRoute = Exclude<Route, 'not-found'>

const ZOLTAR_ROUTING_CONFIG: RoutingConfig<ZoltarRoute> = {
	defaultRoute: 'zoltar',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: '#/zoltar', name: 'zoltar', queryParameters: new Set(['universe', 'zoltarView']) },
	],
}

export const zoltarRouting = createRouting(ZOLTAR_ROUTING_CONFIG)

export function isUniverseIndependentZoltarView(view: 'create' | 'fork' | 'migrate' | 'questions' | 'universes') {
	return view === 'questions' || view === 'create' || view === 'universes'
}

export function installZoltarRouting() {
	installRouting(ZOLTAR_ROUTING_CONFIG)
}
