import { createElement, render } from 'preact'
import { App } from './App.js'
import { initializeActiveEnvironment } from './lib/activeEnvironment.js'

function rerender() {
	const element = createElement(App, {})
	render(element, document.body)
}

void initializeActiveEnvironment()
	.then(() => {
		rerender()
	})
	.catch(error => {
		console.error('[ui] failed to initialize active environment', error)
		render(createElement('div', { className: 'notice error' }, 'Failed to initialize the app environment. Check the console for details.'), document.body)
	})
