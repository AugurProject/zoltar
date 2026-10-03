import { decodeNetworkResponse } from './api-decoding.ts'
import type { ScannerContext } from './app-context.ts'
import { element, lookup } from './app-dom.ts'
import { exactTimestamp, setLiveRecord } from './app-presentation.ts'
import { loadRouteAfterNetworkChange, loadRouteAfterNetworkSelection, selectSystemRouteEntity } from './app-routing.ts'
import { abortActivityRequests, clearLiveTimers, invalidateStateRequestVersions } from './app-state.ts'
import { hideCanonicalDialogStatus, updateConnectionStatus, updateFreshness } from './app-status.ts'
import type { ScannerViews } from './app-views.ts'
import { exactNumber, utcDateTime } from './format.ts'
import { knownNetworkName, restoredNetworkSnapshotIsCurrent } from './network-freshness.ts'
import { availableSessionSnapshotStorage, createSessionSnapshotCache } from './session-snapshot-cache.ts'
import { createNetworkRenderer } from './network-render.ts'
import { createNetworkRoute } from './network-route.ts'

export const createNetworkSnapshotCache = () =>
	createSessionSnapshotCache(
		availableSessionSnapshotStorage(() => window.sessionStorage),
		'augurscan:network-status:v1',
		decodeNetworkResponse,
	)

type NetworkSnapshotCache = ReturnType<typeof createNetworkSnapshotCache>

/** Creates the network status cards and the selected-network URL, label, and status loaders. */
export const createNetworkControls = (context: ScannerContext, views: ScannerViews, snapshotCache: NetworkSnapshotCache) => {
	const { state, elements, links } = context
	const { liveState, networkRenderState } = state
	const renderNetworks = createNetworkRenderer({
		state: networkRenderState,
		networkCards: elements.networkCards,
		selectedChainId: context.selectedChainId,
		invalidateAddressIdentityCache: (chainId, missesOnly) => views.evidence.invalidateAddressIdentityCache(chainId, missesOnly),
		getActiveReorgRecovery: () => state.canonicalState.recovery,
		refreshCanonicalViews: (title, detail) => links.refreshCanonicalViews(title, detail),
		getClockOffset: () => liveState.serverClockOffsetMs,
		getAwaitingResumedStatus: () => liveState.awaitingResumedNetworkStatus,
		getLastRequestFailed: () => liveState.lastNetworkRequestFailed,
		updateConnectionStatus: () => updateConnectionStatus(context),
		updateFreshness: () => updateFreshness(context),
		setLiveRecord,
		element,
		number: exactNumber,
		isDemo: state.isDemo,
		time: utcDateTime,
		exactTimestamp,
		age: context.age,
		until: context.until,
	})
	const route = createNetworkRoute({
		lookup,
		globalNetworkFilter: elements.globalNetworkFilter,
		networkCards: elements.networkCards,
		selectedChainId: context.selectedChainId,
		isDemo: state.isDemo,
		setPageUrl: url => {
			state.pageUrl = url
		},
		liveState,
		canonicalState: state.canonicalState,
		api: context.api,
		writeSnapshot: snapshot => snapshotCache.write(snapshot),
		resetSelectedNetworkContext: () => links.resetSelectedNetworkContext(),
		renderNetworks,
		getLatestNetworks: () => networkRenderState.latestNetworks,
		updateFreshness: () => updateFreshness(context),
		updateConnectionStatus: () => updateConnectionStatus(context),
		loadRouteAfterNetworkChange: () => loadRouteAfterNetworkChange(context, views),
	})
	return { renderNetworks, ...route }
}

export type NetworkControls = ReturnType<typeof createNetworkControls>

/** Re-renders network-dependent chrome after the selected network changed. */
const presentSelectedNetwork = (context: ScannerContext, network: NetworkControls): void => {
	network.syncNetworkUrl()
	network.updateNetworkLabels()
	network.renderNetworks(context.state.networkRenderState.latestNetworks)
	updateFreshness(context)
}

/** Drops every cached view, request, and detail that belongs to the previously selected network. */
export const resetSelectedNetworkContext = (context: ScannerContext, views: ScannerViews): void => {
	const { state, elements } = context
	const { activityDetailState, canonicalState, systemRouteState, operationsState } = state
	const { contracts, richList, addressProfile, systemCatalog } = views.entity
	context.queryCache.clear()
	state.loadedRouteContexts.clear()
	operationsState.routeCache.clear()
	operationsState.renderedContext = undefined
	invalidateStateRequestVersions(state)
	contracts.invalidate()
	richList.invalidate()
	addressProfile.invalidate()
	systemCatalog.invalidate()
	systemRouteState.detailRequestVersion++
	canonicalState.recovery = undefined
	activityDetailState.activeLog = undefined
	views.detail.eventDetail.removeEventDrawers()
	activityDetailState.pendingCanonicalLog = undefined
	activityDetailState.pendingCanonicalActivityCount = undefined
	activityDetailState.pendingCanonicalAccount = undefined
	activityDetailState.pendingAccountDialogSnapshot = undefined
	canonicalState.refreshRequired = false
	hideCanonicalDialogStatus()
	clearLiveTimers(state)
	abortActivityRequests(state)
	elements.feed.replaceChildren()
	state.activityRoute.nextCursor = undefined
	lookup('#activity-summary').textContent = 'No logs shown'
	lookup('#more').hidden = true
	if (elements.dialog.open) views.detail.account.closeDetail({ preservePendingCanonicalAccount: true })
	const url = new URL(location.href)
	url.searchParams.delete('log')
	url.searchParams.delete('entity')
	url.searchParams.delete('account')
	url.searchParams.delete('contract')
	history.replaceState(null, '', url)
	systemRouteState.detailRequestVersion++
	systemRouteState.data = undefined
	systemRouteState.selectedKey = undefined
	systemRouteState.renderedDetailKey = undefined
	systemRouteState.historyOffset = 0
	lookup('#state-stats').replaceChildren()
	lookup('#entity-list').replaceChildren()
	lookup('#entity-count').textContent = '—'
	lookup('#state-detail').replaceChildren(element('div', 'state-placeholder', 'Loading system state…'))
	contracts.clear()
	lookup('#contract-list').replaceChildren()
	richList.clear()
	lookup('#richlist-rows').replaceChildren()
	lookup('#richlist-summary').textContent = '0 of 0 known addresses'
	lookup('#richlist-more').hidden = true
	addressProfile.clear()
	lookup('#address-profile-content').replaceChildren(element('div', 'state-placeholder', 'Loading address activity…'))
	operationsState.requestVersion++
	operationsState.loadState.promise = undefined
	operationsState.loadState.context = undefined
	operationsState.catalogState = undefined
	operationsState.riskCatalogState = undefined
	lookup('#operations-content').replaceChildren()
	lookup('#operations-content').setAttribute('aria-busy', 'true')
	if (location.pathname.startsWith('/question/') || location.pathname.startsWith('/universe/')) selectSystemRouteEntity(context, views)
}

export const bindNetworkFilter = (context: ScannerContext, views: ScannerViews, network: NetworkControls): void => {
	context.elements.globalNetworkFilter.addEventListener('change', async () => {
		document.querySelector('#network-notice')?.remove()
		resetSelectedNetworkContext(context, views)
		presentSelectedNetwork(context, network)
		await loadRouteAfterNetworkSelection(context, views)
	})
}

/** Applies the initial chain from the URL and paints the last session's network snapshot while status loads. */
export const restoreInitialNetwork = (context: ScannerContext, network: NetworkControls, snapshotCache: NetworkSnapshotCache): void => {
	const { state, elements } = context
	const { initialChainId, liveState } = state
	if (initialChainId) {
		elements.globalNetworkFilter.replaceChildren(new Option(knownNetworkName(initialChainId), initialChainId))
		elements.globalNetworkFilter.value = initialChainId
		elements.globalNetworkFilter.dataset['restored'] = 'true'
		network.syncNetworkUrl()
		network.updateNetworkLabels()
	}
	const cachedNetworkSnapshot = initialChainId === '' ? undefined : snapshotCache.read()
	if (cachedNetworkSnapshot?.items.some(item => String(item.chain_id) === initialChainId)) {
		if (cachedNetworkSnapshot.clientClockOffsetMs !== undefined) liveState.serverClockOffsetMs = cachedNetworkSnapshot.clientClockOffsetMs
		if (cachedNetworkSnapshot.freshnessThresholdMs !== undefined) liveState.networkFreshnessThresholdMs = cachedNetworkSnapshot.freshnessThresholdMs
		liveState.restoredCurrentNetworkSnapshot = restoredNetworkSnapshotIsCurrent(cachedNetworkSnapshot.writtenAt)
		// An old snapshot (restored session, discarded tab) must not be judged for freshness against the current clock.
		if (!liveState.restoredCurrentNetworkSnapshot) liveState.awaitingResumedNetworkStatus = true
		network.reconcileNetworkOptions(cachedNetworkSnapshot.items)
		network.renderNetworks(cachedNetworkSnapshot.items)
		updateFreshness(context)
	}
}

/** Adopts the chain named in a navigated URL when it differs from the selected network. */
export const reconcileRouteNetwork = (context: ScannerContext, views: ScannerViews, network: NetworkControls): void => {
	const { state, elements } = context
	const routeChainId = state.pageUrl.searchParams.get('chainId')
	if (routeChainId === null || routeChainId === context.selectedChainId() || ![...elements.globalNetworkFilter.options].some(option => option.value === routeChainId)) return
	const routeUrl = new URL(location.href)
	elements.globalNetworkFilter.value = routeChainId
	elements.globalNetworkFilter.dataset['restored'] = 'true'
	resetSelectedNetworkContext(context, views)
	history.replaceState(null, '', routeUrl)
	state.pageUrl = routeUrl
	presentSelectedNetwork(context, network)
}
