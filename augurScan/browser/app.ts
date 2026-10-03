import type { ScannerContext } from './app-context.ts'
import { createScannerLinks } from './app-context.ts'
import { bindActivityFilterControls, bindDetailControls, bindHistoryRangeControls, bindRichListControls, bindSystemControls } from './app-controls.ts'
import { historyRangeElements, lookup, scannerElements } from './app-dom.ts'
import { bindLiveLifecycle, createLiveUpdates } from './app-live.ts'
import { bindNavigation, navigateInPlace, type NavigationDeps } from './app-navigation.ts'
import { bindNetworkFilter, createNetworkControls, createNetworkSnapshotCache, resetSelectedNetworkContext, restoreInitialNetwork } from './app-network.ts'
import { relativeAge, relativeUntil } from './app-presentation.ts'
import { loadVisibleRoute, restoreRouteDeepLink, selectSystemRouteEntity, syncVisibleRoute } from './app-routing.ts'
import { createScannerState, requireChainId, selectedChainId } from './app-state.ts'
import { createScannerViews } from './app-views.ts'
import type { DemoFactory } from './demo-runtime.ts'
import { fetchApi } from './fetch-api.ts'
import { loadInitialNetworkStatus, nativeSymbolFor } from './network-freshness.ts'
import { createQueryCache } from './query-cache.ts'
import { mountSearch } from './search-ui.ts'

/** Composes the AugurScan browser application: state, route views, live updates, and in-place navigation. */
export async function startScanner(demoFactory?: DemoFactory) {
	const elements = scannerElements()
	const state = createScannerState(new URL(location.href), demoFactory !== undefined)
	const links = createScannerLinks()
	const currentChainId = () => selectedChainId(state, elements.globalNetworkFilter)
	const networkSnapshotCache = createNetworkSnapshotCache()

	const demo = demoFactory?.({
		get pageUrl() {
			return state.pageUrl
		},
		get canonicalRefreshRequired() {
			return state.canonicalState.refreshRequired
		},
		selectedChainId: currentChainId,
	})
	const api = demo?.api ?? fetchApi
	const queryCache = createQueryCache(path => api(path), 5_000)
	mountSearch(path => queryCache.get(path), currentChainId)

	const context: ScannerContext = {
		state,
		elements,
		links,
		api,
		queryCache,
		selectedChainId: currentChainId,
		requiredChainId: () => requireChainId(currentChainId()),
		nativeSymbol: (chainId = currentChainId()) => nativeSymbolFor(chainId),
		age: value => relativeAge(state.liveState.serverClockOffsetMs, value),
		until: value => relativeUntil(state.liveState.serverClockOffsetMs, value),
		retryCanonicalViewOr: fallback => (state.canonicalState.refreshRequired ? links.requestRouteRefresh(1, true) : fallback()),
	}

	const views = createScannerViews(context)
	const network = createNetworkControls(context, views, networkSnapshotCache)
	links.resetSelectedNetworkContext = () => resetSelectedNetworkContext(context, views)

	bindActivityFilterControls(context, views)
	bindDetailControls(context, views)
	const historyRange = historyRangeElements()
	bindHistoryRangeControls(context, views, historyRange)
	bindSystemControls(context, views)
	bindNetworkFilter(context, views, network)
	bindRichListControls(context, views)

	const { connectStream } = createLiveUpdates(context, views, demo)
	restoreInitialNetwork(context, network, networkSnapshotCache)
	connectStream()
	bindLiveLifecycle(context, network, connectStream)

	const { activity } = views.detail
	lookup('#event-filter').value = state.initialActivityFilters.event
	lookup('#address-filter').value = state.initialActivityFilters.address
	if (state.pageUrl.searchParams.has('decoded')) activity.syncActivityFilterUrl()
	activity.validateAddressFilter()
	lookup('#clear-filters').disabled = !activity.hasActivityFilters()

	if (state.route !== 'richlist' && state.pageUrl.searchParams.get('account') !== null) {
		const url = new URL(location.href)
		url.searchParams.delete('account')
		history.replaceState(null, '', url)
	}

	syncVisibleRoute(context)
	const initialRichSort = state.pageUrl.searchParams.get('sort')
	if (initialRichSort !== null && [...lookup('#rich-sort').options].some(option => option.value === initialRichSort)) lookup('#rich-sort').value = initialRichSort
	if (state.route === 'system') selectSystemRouteEntity(context, views)

	const initialNetworkStatusLoad = loadInitialNetworkStatus(state.liveState.restoredCurrentNetworkSnapshot, () => network.loadNetworks({ synchronizeActivity: false }))
	const navigation: NavigationDeps = { views, network, historyRange, initialNetworkStatusLoad }
	links.navigateInPlace = (url, replace) => navigateInPlace(context, navigation, url, replace)
	bindNavigation(context, navigation)

	await loadVisibleRoute(context, views, initialNetworkStatusLoad)
	await restoreRouteDeepLink(context, views)

	if (state.isDemo && state.pageUrl.searchParams.get('queuedPaginationDemo') === '1') window.setTimeout(() => void links.requestRouteRefresh(1), 100)
}
