import type { ScannerContext } from './app-context.ts'
import { element, lookup } from './app-dom.ts'
import type { ScannerState } from './app-state.ts'
import { eventStreamState } from './app-presentation.ts'
import { indexerHeadFreshness } from './network-freshness.ts'
import { networkIndicator } from './network-indicator.ts'

const canonicalIncompleteTitle = 'Chain update refresh incomplete'
const canonicalIncompleteDetail = 'Showing the prior details. Retrying automatically.'

export const showCanonicalDialogStatus = (dialog: HTMLDialogElement, title: string, detail: string): void => {
	if (dialog.open) {
		lookup('#detail-canonical-title').textContent = title
		lookup('#detail-canonical-detail').textContent = detail
		lookup('#detail-canonical-status').hidden = false
	}
	for (const drawerStatus of document.querySelectorAll<HTMLElement>('.event-detail-canonical-status')) {
		const message = element('div')
		message.append(element('strong', '', title), element('span', '', detail))
		drawerStatus.replaceChildren(message)
		drawerStatus.hidden = false
	}
}

export const hideCanonicalDialogStatus = (): void => {
	lookup('#detail-canonical-status').hidden = true
	for (const status of document.querySelectorAll<HTMLElement>('.event-detail-canonical-status')) status.hidden = true
}

export const syncCanonicalDialogStatus = (state: ScannerState, dialog: HTMLDialogElement): void => {
	if (!dialog.open && !document.querySelector('.event-detail-drawer')) {
		hideCanonicalDialogStatus()
		return
	}
	if (state.canonicalState.recovery !== undefined) {
		showCanonicalDialogStatus(dialog, state.canonicalState.recovery.title, state.canonicalState.recovery.detail)
		return
	}
	if (state.canonicalState.refreshRequired) {
		showCanonicalDialogStatus(dialog, canonicalIncompleteTitle, canonicalIncompleteDetail)
		return
	}
	hideCanonicalDialogStatus()
}

export const updateConnectionStatus = (context: ScannerContext): void => {
	const { state, elements } = context
	const { liveState } = state
	const network = state.networkRenderState.latestNetworks.find(item => String(item.chain_id) === context.selectedChainId())
	const streamState = state.connectionDemo === 'reconnecting' ? 'closed' : eventStreamState(liveState.stream)
	const status = networkIndicator({
		network,
		demo: state.usesDemoConnectionLabel,
		streamState,
		failed: liveState.lastNetworkRequestFailed,
		streamHasOpened: liveState.streamHasOpened || state.connectionDemo === 'reconnecting',
		now: Date.now() + liveState.serverClockOffsetMs,
		freshnessThresholdMs: liveState.networkFreshnessThresholdMs,
	})
	elements.connection.className = `connection ${status.tone}`
	lookup('#connection-label').textContent = status.label
	elements.connection.title = status.title
}

export const updateFreshness = (context: ScannerContext): void => {
	const { canonicalState, liveState, networkRenderState } = context.state
	if (canonicalState.recovery !== undefined) return
	delete lookup('#freshness-banner').dataset['status']
	if (canonicalState.refreshRequired) {
		const banner = lookup('#freshness-banner')
		banner.hidden = false
		lookup('#freshness-title').textContent = 'Chain update refresh incomplete'
		lookup('#freshness-detail').textContent = 'A chain update was recorded, but the content refresh failed. Retrying automatically.'
		return
	}
	if (liveState.awaitingResumedNetworkStatus) {
		lookup('#freshness-banner').hidden = true
		return
	}
	if (liveState.lastNetworkRequestFailed) {
		lookup('#freshness-banner').hidden = true
		return
	}
	const staleHead = networkRenderState.latestNetworks.filter(network => String(network.chain_id) === context.selectedChainId()).find(network => indexerHeadFreshness(network, Date.now() + liveState.serverClockOffsetMs).stale)
	if (staleHead !== undefined) {
		const banner = lookup('#freshness-banner')
		banner.hidden = false
		lookup('#freshness-title').textContent = 'RPC chain head is stale'
		lookup('#freshness-detail').textContent = `Newest observed block is ${context.age(staleHead.indexed_timestamp)}; block-based catch-up status may be misleading.`
		return
	}
	const stale = networkRenderState.latestNetworks.filter(network => String(network.chain_id) === context.selectedChainId()).filter(network => !network.last_success_at || Date.now() + liveState.serverClockOffsetMs - new Date(network.last_success_at).getTime() > liveState.networkFreshnessThresholdMs)
	const banner = lookup('#freshness-banner')
	if (stale.length === 0) {
		banner.hidden = true
		return
	}
	banner.hidden = false
	lookup('#freshness-title').textContent = 'Selected network is not updating'
	lookup('#freshness-detail').textContent = 'Showing the last committed database state.'
}

export const completeCanonicalRefresh = (context: ScannerContext, richList: { readonly items: readonly unknown[]; readonly total: number }): void => {
	const { state, elements } = context
	const { activityDetailState } = state
	state.canonicalState.refreshRequired = false
	activityDetailState.pendingCanonicalActivityCount = undefined
	if (state.route === 'activity') {
		lookup('#more').hidden = state.activityRoute.nextCursor === undefined
		lookup('#more').disabled = false
	}
	if (state.route === 'richlist') {
		lookup('#richlist-more').hidden = richList.items.length >= richList.total
		lookup('#richlist-more').disabled = false
	}
	const accountMore = elements.detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
	if (accountMore !== null && activityDetailState.activeAccountTransactions !== undefined) {
		accountMore.hidden = activityDetailState.activeAccountTransactions.nextPageCursor === undefined || (activityDetailState.activeAccountTransactions.pageError !== undefined && activityDetailState.activeAccountTransactions.pageErrorAppend)
		accountMore.disabled = false
	}
	hideCanonicalDialogStatus()
	updateFreshness(context)
}
