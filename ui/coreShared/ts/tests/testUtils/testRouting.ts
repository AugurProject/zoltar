import { installRouting, resetRoutingForTesting } from '../../lib/routing.js'

const DEFAULT_TEST_ROUTES = [
	{ hash: '#/deploy', name: 'deploy' },
	{ hash: '#/zoltar', name: 'zoltar' },
	{ hash: '#/security-pools', name: 'security-pools', queryParameters: new Set(['questionId', 'securityPool', 'securityPoolAddress', 'securityPoolQuestionId', 'securityPoolsView', 'selectedPoolView']) },
	{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleReportId', 'openOracleView']) },
] as const

export function installTestRouting() {
	installRouting({ defaultRoute: 'zoltar', routes: DEFAULT_TEST_ROUTES })
	return () => resetRoutingForTesting()
}
