import type { ScannerContext } from './app-context.ts'
import { lookup, type HistoryRangeElements } from './app-dom.ts'
import { nextTabIndex } from './app-presentation.ts'
import { restartActivityQuery } from './app-routing.ts'
import { isStateTab } from './app-state.ts'
import type { ScannerViews } from './app-views.ts'
import { handleActivityDetailDrawerEscape, shouldClearPendingDetailState } from './live-update.ts'
import { bindSystemSearchControls } from './system-search-controls.ts'

export const bindActivityFilterControls = (context: ScannerContext, views: ScannerViews): void => {
	const { activityRoute } = context.state
	const { activity } = views.detail
	lookup('#filters').addEventListener('submit', event => {
		event.preventDefault()
		if (!activity.validateAddressFilter(true)) return
		const nextFilters = activity.activityFilterValues()
		if (nextFilters.event === activityRoute.appliedFilters.event && nextFilters.address === activityRoute.appliedFilters.address) return
		activityRoute.appliedFilters = nextFilters
		activity.syncActivityFilterUrl()
		restartActivityQuery(context, views)
		void activity.loadLogs()
	})

	lookup('#clear-filters').addEventListener('click', () => {
		lookup('#event-filter').value = ''
		lookup('#address-filter').value = ''
		activity.validateAddressFilter()
		activityRoute.appliedFilters = activity.activityFilterValues()
		activity.syncActivityFilterUrl()
		restartActivityQuery(context, views)
		void activity.loadLogs()
	})

	lookup('#address-filter').addEventListener('input', () => activity.validateAddressFilter())

	lookup('#filters').addEventListener('input', () => {
		lookup('#clear-filters').disabled = !activity.hasActivityFilters()
	})

	lookup('#more').addEventListener('click', () => activity.loadLogs({ append: true }))
}

export const bindDetailControls = (context: ScannerContext, views: ScannerViews): void => {
	const { dialog } = context.elements
	const { activityDetailState } = context.state
	const { account, eventDetail } = views.detail
	lookup('#close-detail').addEventListener('click', () => account.closeDetail())

	dialog.addEventListener('click', event => {
		if (event.target === dialog) account.closeDetail()
	})

	dialog.addEventListener('cancel', event => {
		event.preventDefault()
		account.closeDetail()
	})

	dialog.addEventListener('close', () => {
		if (shouldClearPendingDetailState(activityDetailState.preservePendingOnDialogClose)) {
			activityDetailState.activeLog = undefined
			activityDetailState.pendingCanonicalLog = undefined
			activityDetailState.pendingCanonicalAccount = undefined
			activityDetailState.pendingAccountDialogSnapshot = undefined
			activityDetailState.activeAccount = undefined
			activityDetailState.activeAccountTransactions = undefined
			activityDetailState.activeAccountLoadMore = undefined
			activityDetailState.detailRequestVersion++
		}
		activityDetailState.preservePendingOnDialogClose = false
		account.clearDetailUrl()
	})

	window.addEventListener('resize', () => {
		for (const drawer of eventDetail.eventDrawers()) eventDetail.placeEventDrawer(drawer)
	})

	document.addEventListener('keydown', event => {
		if (!document.querySelector('.event-detail-drawer')) return
		handleActivityDetailDrawerEscape(event, () => {
			const drawer = eventDetail.eventDrawers().find(item => item.contains(document.activeElement)) ?? eventDetail.eventDrawers().at(-1)
			eventDetail.closeEventDrawer({ restoreFocus: true, ...(drawer?.dataset['triggerKey'] === undefined ? {} : { key: drawer.dataset['triggerKey'] }) })
		})
	})
}

export const bindHistoryRangeControls = (context: ScannerContext, views: ScannerViews, historyRange: HistoryRangeElements): void => {
	const { state } = context
	const { form, fromBlock, toBlock, clear } = historyRange
	const { loadSystemState } = views.entity.systemCatalog
	fromBlock.value = state.pageUrl.searchParams.get('fromBlock') ?? ''
	toBlock.value = state.pageUrl.searchParams.get('toBlock') ?? ''

	form.addEventListener('submit', event => {
		event.preventDefault()
		fromBlock.setCustomValidity('')
		toBlock.setCustomValidity('')
		for (const input of [fromBlock, toBlock]) {
			if (input.value !== '' && !/^\d+$/.test(input.value)) {
				input.setCustomValidity('Enter a whole non-negative block number')
				input.reportValidity()
				return
			}
		}
		if (fromBlock.value !== '' && toBlock.value !== '' && BigInt(fromBlock.value) > BigInt(toBlock.value)) {
			toBlock.setCustomValidity('To block must be at or after from block')
			toBlock.reportValidity()
			return
		}
		for (const [name, input] of [
			['fromBlock', fromBlock],
			['toBlock', toBlock],
		] as const) {
			if (input.value === '') state.pageUrl.searchParams.delete(name)
			else state.pageUrl.searchParams.set(name, input.value)
		}
		history.replaceState(null, '', state.pageUrl)
		state.systemRouteState.historyOffset = 0
		void loadSystemState()
	})

	clear.addEventListener('click', () => {
		fromBlock.value = ''
		toBlock.value = ''
		fromBlock.setCustomValidity('')
		toBlock.setCustomValidity('')
		state.pageUrl.searchParams.delete('fromBlock')
		state.pageUrl.searchParams.delete('toBlock')
		history.replaceState(null, '', state.pageUrl)
		state.systemRouteState.historyOffset = 0
		void loadSystemState()
	})
}

export const bindSystemControls = (context: ScannerContext, views: ScannerViews): void => {
	const { systemRouteState } = context.state
	const { system, systemCatalog } = views.entity
	const stateTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-state-tab]')]

	for (const tab of stateTabs) {
		tab.addEventListener('click', () => {
			if (isStateTab(tab.dataset['stateTab'])) system.setStateTab(tab.dataset['stateTab'])
		})
		tab.addEventListener('keydown', event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			const current = stateTabs.indexOf(tab)
			const next = nextTabIndex(event.key, current, stateTabs.length)
			const nextTab = stateTabs[next]
			if (nextTab === undefined) return
			nextTab.focus()
			if (isStateTab(nextTab.dataset['stateTab'])) system.setStateTab(nextTab.dataset['stateTab'])
		})
	}

	bindSystemSearchControls({
		input: lookup('#entity-search'),
		list: lookup('#entity-list'),
		count: lookup('#entity-count'),
		loadMore: lookup('#entity-load-more'),
		invalidate: systemCatalog.invalidate,
		resetSelection: () => {
			systemRouteState.detailContextVersion++
			systemRouteState.detailRequestVersion++
			systemRouteState.selectedKey = undefined
			systemRouteState.historyOffset = 0
		},
		load: systemCatalog.loadSystemState,
	})
}

export const bindRichListControls = (context: ScannerContext, views: ScannerViews): void => {
	const { state } = context
	const { richList } = views.entity
	lookup('#rich-sort').addEventListener('change', () => {
		const url = new URL(location.href)
		url.searchParams.set('sort', lookup('#rich-sort').value)
		history.pushState(null, '', url)
		state.pageUrl = url
		state.viewContextVersion++
		richList.invalidate()
		richList.clear()
		lookup('#richlist-rows').replaceChildren()
		lookup('#richlist-rows').setAttribute('aria-busy', 'true')
		lookup('#richlist-summary').textContent = ''
		lookup('#richlist-status').hidden = false
		lookup('#richlist-status').className = 'system-status'
		lookup('#richlist-status').textContent = 'Loading known addresses…'
		lookup('#rich-sort').disabled = true
		lookup('#richlist-more').hidden = true
		lookup('#richlist-more').disabled = true
		lookup('#richlist-more-status').hidden = true
		lookup('#richlist-more-status').replaceChildren()
		void richList.loadRichList()
	})

	lookup('#rich-view-toggle').addEventListener('click', () => {
		const url = new URL(location.href)
		url.searchParams.set('view', lookup('#richlist-shell').hidden ? 'cards' : 'table')
		history.pushState(null, '', url)
		state.pageUrl = url
		richList.renderRichList()
	})

	lookup('#richlist-more').addEventListener('click', () => richList.loadRichList({ append: true }))
}
