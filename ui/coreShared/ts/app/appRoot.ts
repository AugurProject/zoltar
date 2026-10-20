import { createElement, render, type ComponentChildren } from 'preact'
import { useLayoutEffect, useErrorBoundary } from 'preact/hooks'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import * as appCopy from '../copy/app.js'
import { getErrorMessage } from '../lib/errors.js'
import { initializeActiveEnvironment } from '../lib/activeEnvironment.js'
import { applyThemePreference, readThemePreference } from '../lib/themePreference.js'
import { ApplicationErrorNotice } from './components/ApplicationErrorNotice.js'
import { GenesisUniverseEntry } from './components/GenesisUniverseEntry.js'
import { getGenesisUniverseHref, readGenesisOutcomeFromLocation } from '../navigation/genesisNavigation.js'
import { subscribeToLocationChanges } from '../navigation/historyEntries.js'

const mountedDocuments = new WeakSet<Document>()

type MountAppOptions = {
	applicationTitle: string
	initialize?: () => Promise<unknown>
	/** Independent applications can boot without choosing a Zoltar genesis deployment. */
	requireGenesisSelection?: boolean
	root?: () => ComponentChildren
	target?: Element
}

type ApplicationProps = {
	genesisOutcome: GenesisOutcome | undefined
	root: () => ComponentChildren
}

/** Builds the application tree inside the boundary, so a failure while constructing it is caught as well. */
function ApplicationRoot({ root, genesisOutcome }: ApplicationProps) {
	useLayoutEffect(() => {
		const reloadOnGenesisChange = () => {
			// Different genesis deployments have different pools, tokens, and pending reads. Reload their complete app session.
			if (readGenesisOutcomeFromLocation() !== genesisOutcome) window.location.reload()
		}
		const unsubscribe = subscribeToLocationChanges(reloadOnGenesisChange)
		reloadOnGenesisChange()
		return unsubscribe
	}, [genesisOutcome])
	return root()
}

/**
 * Replaces a tree that failed to render with a recoverable notice. Without it a render error leaves the last frame on
 * screen while nothing updates anymore, so stale buttons keep sending transactions with no feedback.
 */
function ApplicationErrorBoundary({ root, genesisOutcome }: ApplicationProps) {
	const [error, resetError] = useErrorBoundary((caught: unknown) => {
		console.error('[ui] application render failed', caught)
	})
	if (error !== undefined) return createElement(ApplicationErrorNotice, { errorMessage: getErrorMessage(error, appCopy.applicationRenderErrorFallback), onRetry: resetError })
	return createElement(ApplicationRoot, { root, genesisOutcome })
}

export async function mountApp(options: MountAppOptions) {
	const initialize = options.initialize ?? initializeActiveEnvironment
	const rootOption = options.root
	if (rootOption === undefined) throw new Error('mountApp requires a root component factory')
	const root = rootOption
	const target = options.target ?? document.body
	// Only capture the static fallback, the page's top-level frame, on startup; later mounts must leave Preact's frame alone.
	const startupPlaceholder = mountedDocuments.has(target.ownerDocument) ? undefined : (target.ownerDocument.querySelector('body > .app-frame') ?? undefined)
	mountedDocuments.add(target.ownerDocument)
	const genesisOutcome = readGenesisOutcomeFromLocation()
	applyThemePreference(readThemePreference())
	if (options.requireGenesisSelection !== false && genesisOutcome === undefined) {
		if (startupPlaceholder !== target) startupPlaceholder?.remove()
		render(
			createElement(GenesisUniverseEntry, {
				applicationTitle: options.applicationTitle,
				onSelect: async outcome => {
					window.history.replaceState({}, '', getGenesisUniverseHref(outcome))
					await mountApp(options)
				},
			}),
			target,
		)
		return
	}
	try {
		await initialize()
		if (readGenesisOutcomeFromLocation() !== genesisOutcome) {
			window.location.reload()
			return
		}
		if (startupPlaceholder !== target) startupPlaceholder?.remove()
		render(createElement(ApplicationErrorBoundary, { root, genesisOutcome }), target)
	} catch (error) {
		if (readGenesisOutcomeFromLocation() !== genesisOutcome) {
			window.location.reload()
			return
		}
		console.error('[ui] failed to initialize or mount application', error)
		const errorMessage = getErrorMessage(error, appCopy.applicationInitializationErrorFallback)
		if (startupPlaceholder !== target) startupPlaceholder?.remove()
		render(createElement(ApplicationErrorNotice, { errorMessage, onRetry: () => mountApp(options) }), target)
	}
}
