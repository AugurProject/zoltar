import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { registerStatoblastSimulationScenarios } from './simulation/index.js'
import { App } from './app/App.js'
import { initializeStatoblastActiveEnvironment } from './app/activeEnvironment.js'
import { installStatoblastRouting } from './lib/routing.js'

installStatoblastRouting()

registerStatoblastSimulationScenarios()

void mountApp({ initialize: initializeStatoblastActiveEnvironment, root: () => createElement(App, {}) })
