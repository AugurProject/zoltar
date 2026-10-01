import { createRouting, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'
import type { ZoltarRoute } from '../types/app.js'

type NavigableZoltarRoute = Exclude<ZoltarRoute, 'not-found'>

const ZOLTAR_ROUTING_CONFIG: RoutingConfig<NavigableZoltarRoute> = {
	defaultRoute: 'zoltar',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: '#/zoltar', name: 'zoltar', queryParameters: new Set(['universe', 'zoltarView']) },
	],
}

export const zoltarRouting = createRouting(ZOLTAR_ROUTING_CONFIG)

export function installZoltarRouting() {
	installRouting(ZOLTAR_ROUTING_CONFIG)
}
