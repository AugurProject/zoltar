import { createElement } from 'preact'
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js'
import { App } from './app/App.js'
import { installZoltarRouting } from './lib/routing.js'

installZoltarRouting()

void mountApp({ root: () => createElement(App, {}) })
