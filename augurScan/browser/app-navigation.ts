import type { ScannerContext } from './app-context.ts'
import type { HistoryRangeElements } from './app-dom.ts'
import { reconcileRouteNetwork, type NetworkControls } from './app-network.ts'
import { focusNewRoute, hydrateVisibleRoute, invalidateRouteRequests, loadVisibleRoute, restoreOperationsRoute, restoreRouteDeepLink, stashOperationsRoute, syncVisibleRoute } from './app-routing.ts'
import type { ScannerViews } from './app-views.ts'

export interface NavigationDeps {
	readonly views: ScannerViews
	readonly network: NetworkControls
	readonly historyRange: HistoryRangeElements
	readonly initialNetworkStatusLoad: Promise<void>
}

const routeScopedParameters = ['log', 'account', 'contract', 'entity', 'tab', 'fromBlock', 'toBlock']

/** Switches the visible route without a document load, then restores focus and any deep-linked detail. */
export const navigateInPlace = async (context: ScannerContext, deps: NavigationDeps, url: URL, replace = false): Promise<void> => {
	if (url.pathname === location.pathname && url.search === location.search) return
	const { state } = context
	const { views } = deps
	const navigation = ++state.navigationGeneration
	stashOperationsRoute(context)
	views.detail.eventDetail.closeEventDrawer()
	invalidateRouteRequests(context, views)
	if (replace) history.replaceState(null, '', url)
	else history.pushState(null, '', url)
	state.pageUrl = new URL(location.href)
	reconcileRouteNetwork(context, views, deps.network)
	syncVisibleRoute(context)
	const restoredPosition = restoreOperationsRoute(context)
	hydrateVisibleRoute(context, views, deps.historyRange)
	await loadVisibleRoute(context, views, deps.initialNetworkStatusLoad)
	if (navigation !== state.navigationGeneration) return
	if (restoredPosition === undefined) focusNewRoute()
	await restoreRouteDeepLink(context, views)
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
	void loadVisibleRoute(context, views, deps.initialNetworkStatusLoad).then(async () => {
		if (navigation !== state.navigationGeneration) return
		if (restoredPosition === undefined) focusNewRoute()
		await restoreRouteDeepLink(context, views)
	})
}

/** Routes navigation links, the operations route picker, same-origin anchors, and history traversal in place. */
export const bindNavigation = (context: ScannerContext, deps: NavigationDeps): void => {
	const navigate = (target: URL) => void navigateInPlace(context, deps, target)
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a, .operations-nav a, .brand-block')) {
		link.addEventListener('click', event => {
			if (!isPlainPrimaryClick(event)) return
			const target = new URL(link.href)
			const activeProductTab = link.closest('.product-nav') !== null && link.getAttribute('aria-current') === 'page'
			if (activeProductTab || target.pathname === location.pathname) {
				event.preventDefault()
				return
			}
			event.preventDefault()
			for (const name of routeScopedParameters) target.searchParams.delete(name)
			for (const [name, value] of new URL(location.href).searchParams) {
				if (!target.searchParams.has(name) && !routeScopedParameters.includes(name)) target.searchParams.set(name, value)
			}
			navigate(target)
		})
	}

	const { operationsRouteSelect } = context.elements
	operationsRouteSelect.addEventListener('change', () => {
		const target = new URL(operationsRouteSelect.value, location.href)
		for (const [name, value] of new URL(location.href).searchParams) {
			if (!routeScopedParameters.includes(name)) target.searchParams.set(name, value)
		}
		navigate(target)
	})

	document.addEventListener('click', event => {
		if (event.defaultPrevented || !isPlainPrimaryClick(event)) return
		const targetElement = event.target
		if (!(targetElement instanceof Element)) return
		const link = targetElement.closest<HTMLAnchorElement>('a[href]')
		if (link === null || link.hasAttribute('download') || (link.target !== '' && link.target !== '_self')) return
		const target = new URL(link.href)
		if (target.origin !== location.origin || target.hash !== '' || target.pathname.startsWith('/api/')) return
		event.preventDefault()
		navigate(target)
	})

	window.addEventListener('popstate', () => handlePopState(context, deps))
}
