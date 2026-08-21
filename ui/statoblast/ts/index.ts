import { createElement } from 'preact'
import { installRouting } from '@zoltar/ui-core-shared/lib/routing.js'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { registerStatoblastSimulationScenarios } from './simulation/index.js'
import { App } from './app/App.js'
import { initializeStatoblastActiveEnvironment } from './app/activeEnvironment.js'

installRouting({
	defaultRoute: 'security-pools',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: '#/security-pools', name: 'security-pools', queryParameters: new Set(['questionId', 'securityPool', 'securityPoolsView', 'selectedPoolView']) },
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleReportId', 'openOracleView']) },
	],
})

registerStatoblastSimulationScenarios()

void mountApp({ initialize: initializeStatoblastActiveEnvironment, root: () => createElement(App, {}) })
