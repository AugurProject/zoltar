import type { ScannerContext } from './app-context.ts'
import { lookup } from './app-dom.ts'
import type { NetworkControls } from './app-network.ts'
import { clearLiveTimers } from './app-state.ts'
import { completeCanonicalRefresh, showCanonicalDialogStatus, syncCanonicalDialogStatus, updateConnectionStatus, updateFreshness } from './app-status.ts'
import type { ScannerViews } from './app-views.ts'
import type { DemoFactory } from './demo-runtime.ts'
import { eventStreamState, tickRelativeTimes } from './app-presentation.ts'
import { createLiveCoordinator } from './live-coordinator.ts'
import { shouldPollRouteRefresh } from './live-refresh.ts'
import { refreshRouteAlongsideNetworkStatus } from './network-freshness.ts'

type DemoRuntime = ReturnType<DemoFactory>

const suspendedTimersThresholdMs = 10_000
const routePollIntervalMs = 12_000

/** Connects the live event stream coordinator and publishes its refresh entry points through the context links. */
export const createLiveUpdates = (context: ScannerContext, views: ScannerViews, demo: DemoRuntime | undefined) => {
	const { state, elements } = context
	const { activity, eventDetail, account } = views.detail
	const { systemCatalog, contracts, richList, addressProfile } = views.entity
	const live = createLiveCoordinator({
		lookup,
		canonicalState: state.canonicalState,
		activityDetailState: state.activityDetailState,
		liveState: state.liveState,
		feed: elements.feed,
		dialog: elements.dialog,
		detailContent: elements.detailContent,
		isDemo: state.isDemo,
		getPageUrl: () => state.pageUrl,
		selectedChainId: context.selectedChainId,
		requiredChainId: context.requiredChainId,
		loadSystemState: systemCatalog.loadSystemState,
		loadOperations: views.operations.loadOperations,
		loadContracts: contracts.loadContracts,
		loadRichList: richList.loadRichList,
		loadAddressProfile: addressProfile.loadAddressProfile,
		loadLogs: activity.loadLogs,
		openAccountTransactions: account.openAccountTransactions,
		restorePendingCanonicalAccount: account.restorePendingCanonicalAccount,
		eventDrawers: eventDetail.eventDrawers,
		drawerLogFor: eventDetail.drawerLogFor,
		openDetail: eventDetail.openDetail,
		restorePendingCanonicalLog: eventDetail.restorePendingCanonicalLog,
		captureAccountDialogSnapshot: account.captureAccountDialogSnapshot,
		completeCanonicalRefresh: () => completeCanonicalRefresh(context, richList),
		showCanonicalDialogStatus: (title, detail) => showCanonicalDialogStatus(elements.dialog, title, detail),
		syncCanonicalDialogStatus: () => syncCanonicalDialogStatus(state, elements.dialog),
		updateFreshness: () => updateFreshness(context),
		updateConnectionStatus: () => updateConnectionStatus(context),
		queryCache: context.queryCache,
		richListRoute: richList,
		addressProfileRoute: addressProfile,
		applyDemoBlock: payload => demo?.applyBlock(payload),
		observeDemoReorg: address => demo?.observeReorg(address),
		invalidateAddressIdentityCache: views.evidence.invalidateAddressIdentityCache,
		clearAddressIdentityCache: () => views.evidence.clearAddressIdentityCache(),
	})
	context.links.requestRouteRefresh = live.requestRouteRefresh
	context.links.refreshCanonicalViews = live.refreshCanonicalViews
	return live
}

const refreshResumedPage = (context: ScannerContext, network: NetworkControls, force = false): Promise<boolean> => {
	const { liveState, networkRenderState } = context.state
	liveState.awaitingResumedNetworkStatus = true
	liveState.networkResumeGeneration++
	liveState.lastNetworkRequestFailed = false
	network.renderNetworks(networkRenderState.latestNetworks)
	updateFreshness(context)
	return refreshRouteAlongsideNetworkStatus(
		() => network.loadNetworks({ refreshAfterCurrent: true }),
		() => context.links.requestRouteRefresh(1, force),
	)
}

/** Keeps the page live across bfcache restores, sleep, tab visibility changes, and the relative-time clock. */
export const bindLiveLifecycle = (context: ScannerContext, network: NetworkControls, connectStream: () => void): void => {
	const { liveState } = context.state
	addEventListener('pagehide', () => {
		liveState.stream?.close()
		liveState.stream = undefined
		liveState.streamHasOpened = false
		if (liveState.streamReconnectTimer !== undefined) clearTimeout(liveState.streamReconnectTimer)
		liveState.streamReconnectTimer = undefined
		liveState.streamReconnectAttempts = 0
		clearLiveTimers(context.state)
	})

	addEventListener('pageshow', async (event: PageTransitionEvent) => {
		if (!event.persisted) return
		connectStream()
		await refreshResumedPage(context, network, true)
	})

	setInterval(() => {
		const now = Date.now()
		const tickGapMs = now - liveState.lastTimeTickAt
		liveState.lastTimeTickAt = now
		// A large gap between ticks means timers were suspended (system sleep with the tab visible); hidden tabs resume via visibilitychange instead.
		if (!document.hidden && tickGapMs > suspendedTimersThresholdMs) void refreshResumedPage(context, network)
		if (!document.hidden) tickRelativeTimes(document, context.age)
	}, 1000)

	setInterval(() => {
		if (document.hidden) return
		// Block notifications already refresh the route while the stream is delivering them; the poll then only keeps network status current.
		if (shouldPollRouteRefresh(eventStreamState(liveState.stream) === 'open', liveState.lastStreamRefreshAt, Date.now(), routePollIntervalMs)) void refreshRouteAlongsideNetworkStatus(network.loadNetworks, () => context.links.requestRouteRefresh(1))
		else void network.loadNetworks()
	}, routePollIntervalMs)

	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) void refreshResumedPage(context, network)
	})
}
