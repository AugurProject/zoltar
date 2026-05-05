import './liveReload.js'
import { createElement, render } from 'preact'
import { App } from './App.js'
import { initializeActiveEnvironment } from './lib/activeEnvironment.js'

// specify our render function, which will be fired anytime rootModel is mutated
function rerender() {
	const element = createElement(App, {})
	render(element, document.body)
}

void initializeActiveEnvironment().then(() => {
	rerender()
})
