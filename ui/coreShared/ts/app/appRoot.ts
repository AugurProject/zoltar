import { createElement, render, type ComponentChildren } from 'preact'
import { useErrorBoundary } from 'preact/hooks'
import * as appCopy from '../copy/app.js'
import { getErrorMessage } from '../lib/errors.js'
import { initializeActiveEnvironment } from '../lib/activeEnvironment.js'
import { applyThemePreference, readThemePreference } from '../lib/themePreference.js'
import { ApplicationErrorNotice } from './components/ApplicationErrorNotice.js'

type MountAppOptions = {
	initialize?: () => Promise<unknown>
	root?: () => ComponentChildren
	target?: Element
}

/** Builds the application tree inside the boundary, so a failure while constructing it is caught as well. */
function ApplicationRoot({ root }: { root: () => ComponentChildren }) {
	return root()
}

/**
 * Replaces a tree that failed to render with a recoverable notice. Without it a render error leaves the last frame on
 * screen while nothing updates anymore, so stale buttons keep sending transactions with no feedback.
 */
function ApplicationErrorBoundary({ root }: { root: () => ComponentChildren }) {
	const [error, resetError] = useErrorBoundary((caught: unknown) => {
		console.error('[ui] application render failed', caught)
	})
	if (error !== undefined) return createElement(ApplicationErrorNotice, { errorMessage: getErrorMessage(error, appCopy.applicationRenderErrorFallback), onRetry: resetError })
	return createElement(ApplicationRoot, { root })
}

export async function mountApp(options: MountAppOptions) {
	const initialize = options.initialize ?? initializeActiveEnvironment
	const rootOption = options.root
	if (rootOption === undefined) throw new Error('mountApp requires a root component factory')
	const root = rootOption
	const target = options.target ?? document.body
	applyThemePreference(readThemePreference())
	try {
		await initialize()
		render(createElement(ApplicationErrorBoundary, { root }), target)
	} catch (error) {
		console.error('[ui] failed to initialize or mount application', error)
		const errorMessage = getErrorMessage(error, appCopy.applicationInitializationErrorFallback)
		render(createElement(ApplicationErrorNotice, { errorMessage, onRetry: () => mountApp(options) }), target)
	}
}
