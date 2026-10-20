import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { App } from './app/App.js'
import { installZoltarRouting } from '@zoltar/ui-zoltar-shared/lib/routing.js'
import { registerZoltarSimulationScenarios } from './simulation/index.js'
import { applicationTitle } from '@zoltar/ui-zoltar-shared/copy/zoltar.js'

installZoltarRouting()
registerZoltarSimulationScenarios()

void mountApp({ applicationTitle, root: () => createElement(App, {}) })
