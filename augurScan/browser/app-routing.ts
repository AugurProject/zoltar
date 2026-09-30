import type { OperationsRoutePosition, StateTab } from './browser-types.ts'
import type { ScannerContext } from './app-context.ts'
import { lookup, type HistoryRangeElements } from './app-dom.ts'
import { invalidateStateRequestVersions, isStateTab, abortActivityRequests } from './app-state.ts'
import type { ScannerViews } from './app-views.ts'
import { renderExplorerPage } from './explorer-page.ts'
import { classifyRoute, routeTitle, type ScannerRoute } from './routes.ts'

const routeContextKey = (context: ScannerContext): string => `${context.selectedChainId()}:${location.pathname}`

const systemRouteSelection = (context: ScannerContext): { tab: StateTab; entity?: string | undefined } => {
	const parts = location.pathname.split('/').filter(Boolean)
	const mapping: Record<string, StateTab> = { question: 'questions', universe: 'universes' }
	const tab = mapping[parts[0] ?? '']
	if (tab !== undefined && parts.length === 2) return { tab, entity: `${context.selectedChainId()}:${decodeURIComponent(parts[1] ?? '')}` }
	const requested = context.state.pageUrl.searchParams.get('tab')
	return { tab: isStateTab(requested) ? requested : 'pools', entity: context.state.pageUrl.searchParams.get('entity') ?? undefined }
}

export const selectSystemRouteEntity = (context: ScannerContext, views: ScannerViews): void => {
	const selection = systemRouteSelection(context)
	views.entity.system.setStateTab(selection.tab, selection.entity)
}

const explorerPage = (context: ScannerContext) => renderExplorerPage(location.pathname, context.requiredChainId(), path => context.queryCache.get(path))

/** Reloads the visible route after the network status changed the selected chain. */
export const loadRouteAfterNetworkChange = async (context: ScannerContext, views: ScannerViews): Promise<void> => {
	const { route } = context.state
	if (route === 'activity') await views.detail.activity.loadLogs()
	else if (route === 'system') await views.entity.systemCatalog.loadSystemState()
	else if (route === 'operations') await views.operations.loadOperations()
	else if (route === 'contracts') await views.entity.contracts.loadContracts()
	else if (route === 'richlist') await views.entity.richList.loadRichList()
	else if (route === 'address') await views.entity.addressProfile.loadAddressProfile()
	else if (route === 'explorer') await explorerPage(context)
}

/** Reloads the visible route after the user picked another network; unknown routes fall back to the activity feed. */
export const loadRouteAfterNetworkSelection = async (context: ScannerContext, views: ScannerViews): Promise<void> => {
	const { route } = context.state
	if (route === 'system') await views.entity.systemCatalog.loadSystemState()
	else if (route === 'operations') await views.operations.loadOperations()
	else if (route === 'contracts') await views.entity.contracts.loadContracts()
	else if (route === 'richlist') await views.entity.richList.loadRichList()
	else if (route === 'address') await views.entity.addressProfile.loadAddressProfile()
	else if (route === 'explorer') await explorerPage(context)
	else await views.detail.activity.loadLogs()
}

const skipTargets: Record<ScannerRoute, string> = {
	explorer: '#explorer',
	'not-found': '#not-found',
	system: '#system',
	operations: '#operations',
	contracts: '#contracts',
	richlist: '#richlist',
	address: '#address-profile',
	activity: '#activity',
}

const routeSections: ReadonlyArray<readonly [ScannerRoute, string]> = [
	['activity', '#activity'],
	['system', '#system'],
	['operations', '#operations'],
	['contracts', '#contracts'],
	['richlist', '#richlist'],
	['address', '#address-profile'],
	['explorer', '#explorer'],
	['not-found', '#not-found'],
]

export const syncVisibleRoute = (context: ScannerContext): void => {
	const { state } = context
	if (location.pathname === '/address' && /^0x[0-9a-fA-F]{40}$/.test(state.pageUrl.searchParams.get('address') ?? '')) {
		const canonical = new URL(location.href)
		canonical.pathname = `/address/${state.pageUrl.searchParams.get('address')}`
		canonical.searchParams.delete('address')
		history.replaceState(null, '', canonical)
		state.pageUrl = canonical
	}
	state.route = classifyRoute(location.pathname)
	const isOperations = state.route === 'operations'
	document.body.classList.toggle('canonical-entity-route', isOperations && !location.pathname.startsWith('/operations'))
	document.body.classList.toggle('canonical-system-route', state.route === 'system' && location.pathname !== '/system')
	for (const [route, selector] of routeSections) lookup(selector).hidden = state.route !== route
	document.title = routeTitle(location.pathname)
	lookup('.skip-link').href = skipTargets[state.route]
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a')) {
		const current = new URL(link.href).pathname === location.pathname || (isOperations && new URL(link.href).pathname === '/operations')
		if (current) link.setAttribute('aria-current', 'page')
		else link.removeAttribute('aria-current')
	}
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.operations-nav a')) {
		if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page')
		else link.removeAttribute('aria-current')
	}
	const { operationsRouteSelect } = context.elements
	if ([...operationsRouteSelect.options].some(option => option.value === location.pathname)) operationsRouteSelect.value = location.pathname
}

export const loadVisibleRoute = async (context: ScannerContext, views: ScannerViews, initialNetworkStatusLoad: Promise<void>): Promise<void> => {
	await initialNetworkStatusLoad
	const { state } = context
	const routeContext = routeContextKey(context)
	const isOperations = state.route === 'operations'
	const live = state.loadedRouteContexts.has(routeContext) && (!isOperations || state.operationsState.renderedContext === routeContext)
	let loaded: boolean | undefined
	if (state.route === 'system') loaded = await views.entity.systemCatalog.loadSystemState({ live })
	else if (isOperations) loaded = await views.operations.loadOperations({ live })
	else if (state.route === 'contracts') loaded = await views.entity.contracts.loadContracts({ live })
	else if (state.route === 'richlist') loaded = await views.entity.richList.loadRichList({ live })
	else if (state.route === 'address') loaded = await views.entity.addressProfile.loadAddressProfile({ live })
	else if (state.route === 'explorer') {
		loaded = await explorerPage(context)
	} else if (state.route === 'not-found') loaded = true
	else {
		const { activity } = views.detail
		activity.syncActivityFilterUrl()
		if (activity.validateAddressFilter()) loaded = await activity.loadLogs({ live })
		else {
			activity.showInvalidAddressFilter()
			loaded = false
		}
	}
	if (loaded !== false) {
		state.loadedRouteContexts.add(routeContext)
		if (isOperations) state.operationsState.renderedContext = routeContext
	}
}

export const stashOperationsRoute = (context: ScannerContext): void => {
	if (context.state.route === 'operations') context.state.operationsState.stash(lookup('#operations-content'))
}

export const restoreOperationsRoute = (context: ScannerContext): OperationsRoutePosition | undefined => (context.state.route === 'operations' ? context.state.operationsState.restore(routeContextKey(context), lookup('#operations-content')) : undefined)

/** Clears the activity feed before reloading it with new filters. */
const resetActivityFilterContext = (context: ScannerContext, views: ScannerViews): void => {
	const { elements, state } = context
	if (document.querySelector('.event-detail-drawer')) views.detail.eventDetail.closeEventDrawer()
	elements.feed.replaceChildren()
	elements.feed.setAttribute('aria-busy', 'true')
	state.activityRoute.nextCursor = undefined
	lookup('#activity-summary').textContent = ''
	elements.feedState.hidden = false
	elements.feedState.textContent = 'Loading activity…'
	lookup('#more').hidden = true
	lookup('#activity-more-status').hidden = true
	lookup('#activity-more-status').replaceChildren()
	views.detail.activity.setLogControlsBusy(true)
}

/** Starts a fresh activity query after the applied filters changed. */
export const restartActivityQuery = (context: ScannerContext, views: ScannerViews): void => {
	context.state.viewContextVersion++
	context.state.activityRoute.abortController?.abort()
	context.state.activityRoute.requestVersion++
	resetActivityFilterContext(context, views)
}

/** Restores route controls from the URL after history navigation. */
export const hydrateVisibleRoute = (context: ScannerContext, views: ScannerViews, historyRange: HistoryRangeElements): void => {
	const { state } = context
	if (state.route === 'activity') {
		const restoredFilters = {
			event: state.pageUrl.searchParams.get('event') ?? '',
			address: state.pageUrl.searchParams.get('address') ?? '',
		}
		lookup('#event-filter').value = restoredFilters.event
		lookup('#address-filter').value = restoredFilters.address
		views.detail.activity.validateAddressFilter()
		lookup('#clear-filters').disabled = restoredFilters.event === '' && restoredFilters.address === ''
		if (restoredFilters.event !== state.activityRoute.appliedFilters.event || restoredFilters.address !== state.activityRoute.appliedFilters.address) {
			state.activityRoute.appliedFilters = restoredFilters
			restartActivityQuery(context, views)
			state.loadedRouteContexts.delete(routeContextKey(context))
		}
	}
	if (state.route === 'system') {
		selectSystemRouteEntity(context, views)
		historyRange.fromBlock.value = state.pageUrl.searchParams.get('fromBlock') ?? ''
		historyRange.toBlock.value = state.pageUrl.searchParams.get('toBlock') ?? ''
	}
	if (state.route === 'contracts') {
		if (views.entity.contracts.items.length > 0) views.entity.contracts.renderContracts()
	}
	if (state.route === 'richlist') {
		const sort = state.pageUrl.searchParams.get('sort')
		if (sort !== null && [...lookup('#rich-sort').options].some(option => option.value === sort) && lookup('#rich-sort').value !== sort) {
			lookup('#rich-sort').value = sort
			views.entity.richList.clear()
		}
	}
}

/** Discards in-flight requests for every route before the visible route changes. */
export const invalidateRouteRequests = (context: ScannerContext, views: ScannerViews): void => {
	const { state } = context
	context.queryCache.clear()
	invalidateStateRequestVersions(state)
	views.entity.contracts.invalidate()
	views.entity.richList.invalidate()
	views.entity.addressProfile.invalidate()
	views.entity.systemCatalog.invalidate()
	state.systemRouteState.detailRequestVersion++
	state.operationsState.requestVersion++
	abortActivityRequests(state)
}

export const focusNewRoute = (): void => {
	window.scrollTo({ top: 0 })
	const heading = document.querySelector<HTMLElement>('main > section:not([hidden]) h1, main > section:not([hidden]) h2')
	if (heading === null) return
	heading.tabIndex = -1
	heading.focus({ preventScroll: true })
}

/** Opens the log or account detail named by the current URL, or drops a stale deep link. */
export const restoreRouteDeepLink = async (context: ScannerContext, views: ScannerViews): Promise<void> => {
	const { state } = context
	const currentUrl = new URL(location.href)
	const deepLink = currentUrl.searchParams.get('log')
	const accountDeepLink = currentUrl.searchParams.get('account')
	if (state.route === 'activity' && deepLink !== null) {
		const parts = deepLink.split(':')
		const [chainId, blockHash, transactionHash, logIndex] = parts
		const parsedLogIndex = logIndex === undefined || !/^\d+$/.test(logIndex) ? undefined : Number(logIndex)
		if (
			parts.length === 4 &&
			typeof chainId === 'string' &&
			chainId === context.selectedChainId() &&
			typeof blockHash === 'string' &&
			/^0x[0-9a-fA-F]{64}$/.test(blockHash) &&
			typeof transactionHash === 'string' &&
			/^0x[0-9a-fA-F]{64}$/.test(transactionHash) &&
			parsedLogIndex !== undefined &&
			Number.isSafeInteger(parsedLogIndex)
		) {
			await views.detail.eventDetail.openDetail({ chain_id: chainId, block_hash: blockHash, tx_hash: transactionHash, log_index: parsedLogIndex })
			return
		}
		currentUrl.searchParams.delete('log')
		history.replaceState(null, '', currentUrl)
		state.pageUrl = currentUrl
	}
	if (state.route === 'richlist' && accountDeepLink !== null) {
		const parts = accountDeepLink.split(':')
		const [chainId, address] = parts
		if (parts.length === 2 && chainId === context.selectedChainId() && /^0x[0-9a-fA-F]{40}$/.test(address ?? '')) {
			if (chainId === undefined || address === undefined) throw new Error('Account deep link is malformed')
			const item = views.entity.richList.items.find(candidate => candidate.chain_id === chainId && candidate.address.toLowerCase() === address.toLowerCase())
			const network = state.networkRenderState.latestNetworks.find(candidate => String(candidate.chain_id) === chainId)
			await views.detail.account.openAccountTransactions(item ?? { chain_id: chainId, address, explorer_base_url: network?.explorer_base_url })
			return
		}
		currentUrl.searchParams.delete('account')
		history.replaceState(null, '', currentUrl)
		state.pageUrl = currentUrl
	}
}
