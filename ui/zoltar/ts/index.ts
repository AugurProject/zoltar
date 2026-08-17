import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { installRouting } from '@zoltar/ui-core-shared/lib/routing.js'
import { App } from './app/App.js'

installRouting({
	defaultRoute: 'zoltar',
	routes: [
		{ hash: '#/deploy', name: 'deploy' },
		{ hash: '#/zoltar', name: 'zoltar', queryParameters: new Set(['universe', 'zoltarView']) },
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleView', 'openOracleReportId']) },
	],
})

void mountApp({ root: () => createElement(App, {}) })
