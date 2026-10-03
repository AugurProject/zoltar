import type { ScannerContext } from './app-context.ts'
import type { HistoryRangeElements } from './app-dom.ts'
import { reconcileRouteNetwork, type NetworkControls } from './app-network.ts'
import { focusNewRoute, hydrateVisibleRoute, invalidateRouteRequests, loadVisibleRoute, refocusLoadedRoute, restoreOperationsRoute, restoreRouteDeepLink, stashOperationsRoute, syncVisibleRoute } from './app-routing.ts'
import type { ScannerViews } from './app-views.ts'
import { navigationTarget } from './routes.ts'

export interface NavigationDeps {
	readonly views: ScannerViews
	readonly network: NetworkControls
	readonly historyRange: HistoryRangeElements
	readonly initialNetworkStatusLoad: Promise<void>
}

/** Switches the visible route without a document load, then restores focus and any deep-linked detail. */
export const navigateInPlace = async (context: ScannerContext, deps: NavigationDeps, url: URL, replace = false): Promise<void> => {
	if (url.pathname === location.pathname && url.search === location.search) return
	const { state } = context
	const { views } = deps
	const navigation = ++state.navigationGeneration
	stashOperationsRoute(context)
	views.detail.eventDetail.closeEventDrawer()
	// A modal left open would cover the route that a link inside it just opened.
	if (context.elements.dialog.open) views.detail.account.closeDetail()
	invalidateRouteRequests(context, views)
	if (replace) history.replaceState(null, '', url)
	else history.pushState(null, '', url)
	state.pageUrl = new URL(location.href)
	reconcileRouteNetwork(context, views, deps.network)
	syncVisibleRoute(context)
	const restoredPosition = restoreOperationsRoute(context)
	hydrateVisibleRoute(context, views, deps.historyRange)
	// Focus and scroll move with the route change itself; waiting for data would pull the user back after they started reading.
	const focusedBeforeLoad = restoredPosition === undefined ? focusNewRoute() : undefined
	await loadVisibleRoute(context, views, deps.initialNetworkStatusLoad)
	if (navigation !== state.navigationGeneration) return
	if (restoredPosition === undefined) refocusLoadedRoute(focusedBeforeLoad)
	await restoreRouteDeepLink(context, views)
}

const decodeFragment = (fragment: string): string => {
	try {
		return decodeURIComponent(fragment)
	} catch (error) {
		if (!(error instanceof URIError)) throw error
		return fragment
	}
}

/** Moves focus to an in-page target (such as the skip link's section) without creating a history entry. */
const focusFragmentTarget = (destination: HTMLElement): void => {
	const heading = destination.matches('section') ? focusNewRoute({ scrollToTop: false }) : undefined
	if (heading !== undefined && destination.contains(heading)) {
		heading.scrollIntoView({ block: 'start' })
		return
	}
	if (!destination.hasAttribute('tabindex')) destination.tabIndex = -1
	destination.focus({ preventScroll: true })
	destination.scrollIntoView({ block: 'start' })
}

const isPlainPrimaryClick = (event: MouseEvent): boolean => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

const handlePopState = (context: ScannerContext, deps: NavigationDeps): void => {
	const { state, elements } = context
	const { views } = deps
	const navigation = ++state.navigationGeneration
	stashOperationsRoute(context)
	views.detail.eventDetail.closeEventDrawer({ clearUrl: false })
	invalidateRouteRequests(context, views)
	state.pageUrl = new URL(location.href)
	if (elements.dialog.open) {
		const restoredUrl = new URL(location.href)
		views.detail.account.closeDetail()
		history.replaceState(null, '', restoredUrl)
		state.pageUrl = restoredUrl
	}
	reconcileRouteNetwork(context, views, deps.network)
	syncVisibleRoute(context)
	const restoredPosition = restoreOperationsRoute(context)
	hydrateVisibleRoute(context, views, deps.historyRange)
	// History traversal keeps the scroll position the browser restores for the entry.
	const focusedBeforeLoad = restoredPosition === undefined ? focusNewRoute({ scrollToTop: false }) : undefined
	void loadVisibleRoute(context, views, deps.initialNetworkStatusLoad).then(async () => {
		if (navigation !== state.navigationGeneration) return
		if (restoredPosition === undefined) refocusLoadedRoute(focusedBeforeLoad)
		await restoreRouteDeepLink(context, views)
	})
}

/** Routes navigation links, the operations route picker, same-origin anchors, and history traversal in place. */
export const bindNavigation = (context: ScannerContext, deps: NavigationDeps): void => {
	const navigate = (target: URL) => void navigateInPlace(context, deps, target)
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a, .operations-nav a, .brand-block')) {
		link.addEventListener('click', event => {
			if (!isPlainPrimaryClick(event)) return
			event.preventDefault()
			// The highlighted section link still leads to the section's own page from any of its sub-routes.
			if (new URL(link.href).pathname === location.pathname) return
			navigate(navigationTarget(new URL(link.href), new URL(location.href)))
		})
	}

	const { operationsRouteSelect } = context.elements
	operationsRouteSelect.addEventListener('change', () => {
		navigate(navigationTarget(new URL(operationsRouteSelect.value, location.origin), new URL(location.href)))
	})

	document.addEventListener('click', event => {
		if (event.defaultPrevented || !isPlainPrimaryClick(event)) return
		const targetElement = event.target
		if (!(targetElement instanceof Element)) return
		const link = targetElement.closest<HTMLAnchorElement>('a[href]')
		if (link === null || link.hasAttribute('download') || (link.target !== '' && link.target !== '_self')) return
		const target = new URL(link.href)
		if (target.origin !== location.origin || target.pathname.startsWith('/api/')) return
		if (target.hash !== '') {
			// A fragment navigation fires popstate and would reload the whole route; same-page targets are focused directly instead.
			if (target.pathname !== location.pathname || target.search !== location.search) return
			const destination = document.getElementById(decodeFragment(target.hash.slice(1)))
			if (destination === null) return
			event.preventDefault()
			focusFragmentTarget(destination)
			return
		}
		event.preventDefault()
		navigate(target)
	})

	window.addEventListener('popstate', () => handlePopState(context, deps))
}
