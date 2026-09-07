import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { registerStatoblastSimulationScenarios } from './simulation/index.js'
import { App } from './app/App.js'
import { initializeStatoblastActiveEnvironment } from './app/activeEnvironment.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-domain/lib/routing.js'
import { installStatoblastContractLabels } from '@zoltar/ui-statoblast-domain/protocol/contractLabels.js'

installStatoblastRouting()
installStatoblastContractLabels()

registerStatoblastSimulationScenarios()

void mountApp({ initialize: initializeStatoblastActiveEnvironment, root: () => createElement(App, {}) })
