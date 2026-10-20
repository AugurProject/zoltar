import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { installStatoblastContractLabels } from '@zoltar/ui-statoblast-shared/protocol/contractLabels.js'
import { registerStatoblastSimulationScenarios } from '@zoltar/ui-statoblast-shared/simulation/registerStatoblastScenarios.js'
import { initializeOpenOracleActiveEnvironment } from './app/activeEnvironment.js'
import { installOpenOracleRouting } from './app/routing.js'
import { App } from './app/App.js'
import { applicationTitle } from './copy/app.js'

installOpenOracleRouting()
installStatoblastContractLabels()
registerStatoblastSimulationScenarios()
void mountApp({ applicationTitle, requireGenesisSelection: false, initialize: initializeOpenOracleActiveEnvironment, root: () => createElement(App, {}) })
