import { createElement, render, type ComponentChildren } from 'preact'
import * as appCopy from '../copy/app.js'
import { getErrorMessage } from '../lib/errors.js'
import { initializeActiveEnvironment } from '../lib/activeEnvironment.js'
import { App } from './App.js'
import { AppErrorBoundary } from './components/AppErrorBoundary.js'
import { ApplicationErrorNotice } from './components/ApplicationErrorNotice.js'

export function createAppRoot(children: ComponentChildren = createElement(App, {})) {
	return createElement(AppErrorBoundary, {}, children)
}

type MountAppOptions = {
	initialize?: () => Promise<unknown>
	root?: () => ComponentChildren
	target?: Element
}

export async function mountApp(options: MountAppOptions = {}) {
	const initialize = options.initialize ?? initializeActiveEnvironment
	const root = options.root ?? createAppRoot
	const target = options.target ?? document.body
	try {
		await initialize()
		render(root(), target)
	} catch (error) {
		const errorMessage = getErrorMessage(error, appCopy.applicationInitializationErrorFallback)
		render(createElement(ApplicationErrorNotice, { errorMessage, onRetry: () => mountApp(options) }), target)
	}
}
