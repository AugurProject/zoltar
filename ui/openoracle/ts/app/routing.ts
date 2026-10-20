import { createRouting, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'

const config: RoutingConfig<'open-oracle' | 'deploy'> = {
	defaultRoute: 'open-oracle',
	routes: [
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleView', 'openOracleReportId']) },
		{ hash: '#/deploy', name: 'deploy' },
	],
}

export const openOracleRouting = createRouting(config)
export const installOpenOracleRouting = () => installRouting(config)
