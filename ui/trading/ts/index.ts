import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { App } from './app/App.js'
import { initializeTradingActiveEnvironment } from './app/activeEnvironment.js'
import { installTradingRouting } from './lib/routing.js'
import { registerTradingSimulationScenario, withDefaultTradingSimulationScenario } from './simulation/index.js'

const root = document.querySelector('#app') ?? document.body
async function initializeTradingForMount() {
	try {
		await initializeTradingActiveEnvironment()
	} finally {
		document.querySelector('body > main')?.remove()
	}
}
installTradingRouting()
registerTradingSimulationScenario()
const defaultSimulationUrl = withDefaultTradingSimulationScenario(window.location.href)
if (defaultSimulationUrl !== undefined) window.history.replaceState({}, '', defaultSimulationUrl)
void mountApp({ initialize: initializeTradingForMount, root: () => createElement(App, null), target: root })
