import { createElement, render } from 'preact'
import { App } from './app/App.js'
import { initializeActiveEnvironment } from './lib/activeEnvironment.js'

void initializeActiveEnvironment()
	.then(() => {
		render(createElement(App, {}), document.body)
	})
	.catch(error => {
		console.error('[ui] failed to initialize active environment', error)
		render(createElement('div', { className: 'notice error' }, 'Failed to initialize the app environment. Check the console for details.'), document.body)
	})
