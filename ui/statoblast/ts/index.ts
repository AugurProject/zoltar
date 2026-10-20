import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { registerStatoblastSimulationScenarios } from '@zoltar/ui-statoblast-shared/simulation/registerStatoblastScenarios.js'
import { App } from './app/App.js'
import { initializeStatoblastActiveEnvironment } from './app/activeEnvironment.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { installStatoblastContractLabels } from '@zoltar/ui-statoblast-shared/protocol/contractLabels.js'
import { applicationTitle } from './app/lib/appPageTitle.js'

installStatoblastRouting()
installStatoblastContractLabels()

registerStatoblastSimulationScenarios()

void mountApp({ applicationTitle, initialize: initializeStatoblastActiveEnvironment, root: () => createElement(App, {}) })
