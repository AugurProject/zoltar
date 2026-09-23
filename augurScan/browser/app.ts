import { createOperationsComponents } from './operations-components.ts'
import { requiredElementRole } from './dom-elements.ts'

import {
	type AccountTransaction,
	type ActivityRecord,
	type EntityHistory,
	type LiveChangeOptions,
	type OperationsDetailRoute,
	type OperationsRenderContext,
	type OperationsRoutePosition,
	type PoolRecord,
	type QuestionRecord,
	type RichListRecord,
	type StateEntity,
	type StateTab,
	type UniverseRecord,
	type VaultRecord,
} from './browser-types.ts'

import { type OperationsResponse } from './api-validation.ts'

import {
	availableSessionSnapshotStorage,
	classifyLiveRecords,
	createForegroundRefreshGate,
	createSessionSnapshotCache,
	handleActivityDetailDrawerEscape,
	indexerHeadFreshness,
	isCurrentCanonicalGeneration,
	knownNetworkName,
	loadInitialNetworkStatus,
	refreshRouteAlongsideNetworkStatus,
	restoredNetworkSnapshotIsCurrent,
	shouldClearPendingDetailState,
} from './live-update.ts'

import { decodeNetworkResponse, requiredArrayItem } from './api-decoding.ts'

import { renderOperationsOverview } from './operations-overview.ts'
import { renderOperationsDetail } from './operations-detail.ts'
import { createOperationsRouteState } from './operations-state.ts'
import { createOperationsData, operationsRiskHistoryKeys, operationsHistoryOffset } from './operations-data.ts'
import { createOperationsLoader } from './operations-loader.ts'
import { createOperationsRouteView } from './operations-route-view.ts'
import { renderAddressProfilePage } from './address-profile-page.ts'
import { createStateComponents } from './state-components.ts'
import { renderPoolDetailPage, renderVaultDetailPage } from './state-risk-pages.ts'
import { renderQuestionDetailPage, renderUniverseDetailPage } from './state-entity-pages.ts'
import { createStateHistoryData } from './state-history-data.ts'
import { renderStateHistoryCoverage } from './state-history-coverage.ts'
import { createNetworkRenderState, createNetworkRenderer } from './network-render.ts'
import { renderActivityRow } from './activity-row.ts'
import { createActivityDetailState } from './activity-detail-state.ts'
import { createActivityRouteState } from './activity-route-state.ts'
import { createActivityRoute } from './activity-route.ts'
import { createCanonicalState } from './canonical-state.ts'
import { createSystemCatalogLoader } from './system-catalog-loader.ts'
import { createSystemRouteState } from './system-route-state.ts'
import { createSystemRoute } from './system-route.ts'
import { createScannerLiveState } from './scanner-live-state.ts'
import { createNetworkRoute } from './network-route.ts'
import { createEventDetailRoute } from './event-detail-route.ts'
import { createLiveCoordinator } from './live-coordinator.ts'
import { createAccountDetailRoute } from './account-detail-route.ts'
import { createEvidenceComponents } from './evidence-components.ts'
import { createContractsRoute } from './contracts-route.ts'
import { createRichListRoute } from './rich-list-route.ts'
import { createAddressProfileRoute } from './address-profile-route.ts'

import type { DemoFactory } from './demo-runtime.ts'

import { fetchApi } from './fetch-api.ts'
import { exactNumber, utcDateTime } from './format.ts'
import { renderExplorerPage } from './explorer-page.ts'
import { mountSearch } from './search-ui.ts'
import { networkIndicator } from './network-indicator.ts'
import { createQueryCache } from './query-cache.ts'
import { classifyRoute, routeTitle } from './routes.ts'

export async function startScanner(demoFactory?: DemoFactory) {
	function $(selector: '#detail-dialog'): HTMLDialogElement

	function $(selector: '#event-filter' | '#address-filter' | '#entity-search'): HTMLInputElement

	function $(selector: '#global-network-filter' | '#operations-route-select' | '#rich-sort'): HTMLSelectElement

	function $(selector: '#filters'): HTMLFormElement

	function $(selector: '#address-back' | '.skip-link'): HTMLAnchorElement

	function $(selector: '#more' | '#clear-filters' | '#close-detail' | '#richlist-more' | '#filters button[type="submit"]'): HTMLButtonElement

	function $(selector: string): HTMLElement

	function $(selector: string): HTMLElement {
		const found = document.querySelector<HTMLElement>(selector)
		if (!(found instanceof HTMLElement)) throw new Error(`Required AugurScan element ${selector} is missing or has the wrong type`)
		const expected = {
			anchor: HTMLAnchorElement,
			button: HTMLButtonElement,
			dialog: HTMLDialogElement,
			element: HTMLElement,
			form: HTMLFormElement,
			input: HTMLInputElement,
			select: HTMLSelectElement,
		}[requiredElementRole(selector)]
		if (expected !== undefined && !(found instanceof expected)) throw new Error(`Required AugurScan element ${selector} has the wrong type`)
		return found
	}

	const feed = $('#feed')

	const feedState = $('#feed-state')

	const networkCards = $('#network-cards')

	const globalNetworkFilter = $('#global-network-filter')

	const operationsRouteSelect = $('#operations-route-select')

	const dialog = $('#detail-dialog')

	const detailContent = $('#detail-content')

	const connection = $('.connection')

	let pageUrl = new URL(location.href)
	const isDemo = demoFactory !== undefined
	const connectionDemo = isDemo ? pageUrl.searchParams.get('connectionDemo') : null

	const usesDemoConnectionLabel = isDemo && connectionDemo !== 'indexer' && connectionDemo !== 'reconnecting'

	let isSystem = classifyRoute(location.pathname) === 'system'

	let isOperations = classifyRoute(location.pathname) === 'operations'

	let isContracts = classifyRoute(location.pathname) === 'contracts'

	let isRichList = classifyRoute(location.pathname) === 'richlist'

	let isAddress = classifyRoute(location.pathname) === 'address'
	let isExplorer = classifyRoute(location.pathname) === 'explorer'
	let isNotFound = classifyRoute(location.pathname) === 'not-found'

	let isActivity = classifyRoute(location.pathname) === 'activity'

	const initialChainId = pageUrl.searchParams.get('chainId') ?? ''

	const initialActivityFilters = {
		event: pageUrl.searchParams.get('event') ?? '',
		address: pageUrl.searchParams.get('address') ?? '',
	}

	const activityRoute = createActivityRouteState(initialActivityFilters)

	const operationsState = createOperationsRouteState()

	const activityDetailState = createActivityDetailState()
	const canonicalState = createCanonicalState()

	const systemRouteState = createSystemRouteState()

	const liveState = createScannerLiveState()
	const networkRenderState = createNetworkRenderState()

	let viewContextVersion = 0

	let requestRouteRefresh: (count?: number, force?: boolean) => Promise<boolean>
	let refreshCanonicalViews: (title: string, detail: string) => Promise<boolean>

	const loadedRouteContexts = new Set<string>()

	let navigationGeneration = 0

	const logRefreshGate = createForegroundRefreshGate()

	const contractRefreshGate = createForegroundRefreshGate()

	const richListRefreshGate = createForegroundRefreshGate()

	const addressProfileRefreshGate = createForegroundRefreshGate()

	const systemStateRefreshGate = createForegroundRefreshGate()

	const systemDetailRefreshGate = createForegroundRefreshGate()

	const detailRefreshGate = createForegroundRefreshGate()

	const accountPageRefreshGate = createForegroundRefreshGate()

	const canonicalIncompleteTitle = 'Chain update refresh incomplete'

	const canonicalIncompleteDetail = 'Showing the prior details. Retrying automatically.'

	const showCanonicalDialogStatus = (title: string, detail: string) => {
		if (dialog.open) {
			$('#detail-canonical-title').textContent = title
			$('#detail-canonical-detail').textContent = detail
			$('#detail-canonical-status').hidden = false
		}
		for (const drawerStatus of document.querySelectorAll<HTMLElement>('.event-detail-canonical-status')) {
			const message = element('div')
			message.append(element('strong', '', title), element('span', '', detail))
			drawerStatus.replaceChildren(message)
			drawerStatus.hidden = false
		}
	}

	const hideCanonicalDialogStatus = () => {
		$('#detail-canonical-status').hidden = true
		for (const status of document.querySelectorAll<HTMLElement>('.event-detail-canonical-status')) status.hidden = true
	}

	const syncCanonicalDialogStatus = () => {
		if (!dialog.open && !document.querySelector('.event-detail-drawer')) {
			hideCanonicalDialogStatus()
			return
		}
		if (canonicalState.recovery !== undefined) {
			showCanonicalDialogStatus(canonicalState.recovery.title, canonicalState.recovery.detail)
			return
		}
		if (canonicalState.refreshRequired) {
			showCanonicalDialogStatus(canonicalIncompleteTitle, canonicalIncompleteDetail)
			return
		}
		hideCanonicalDialogStatus()
	}

	const updateConnectionStatus = () => {
		const network = networkRenderState.latestNetworks.find(item => String(item.chain_id) === selectedChainId())
		const streamState = connectionDemo === 'reconnecting' ? 'closed' : eventStreamState(liveState.stream)
		const status = networkIndicator({
			network,
			demo: usesDemoConnectionLabel,
			streamState,
			failed: liveState.lastNetworkRequestFailed,
			streamHasOpened: liveState.streamHasOpened || connectionDemo === 'reconnecting',
			now: Date.now() + liveState.serverClockOffsetMs,
			freshnessThresholdMs: liveState.networkFreshnessThresholdMs,
		})
		connection.className = `connection ${status.tone}`
		$('#connection-label').textContent = status.label
		connection.title = status.title
	}

	const liveSnapshot = (container: ParentNode, selector = '[data-live-key]'): Map<string, string> =>
		new Map(
			[...container.querySelectorAll<HTMLElement>(selector)].flatMap(node => {
				const key = node.dataset['liveKey']
				return key === undefined ? [] : [[key, node.dataset['liveSignature'] ?? node.textContent ?? '']]
			}),
		)

	const setLiveRecord = <T extends HTMLElement>(node: T, key: string, value: unknown): T => {
		node.dataset['liveKey'] = key
		node.dataset['liveSignature'] = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'undefined')
		return node
	}

	const retryCanonicalViewOr = (fallback: () => Promise<boolean>): Promise<boolean> => (canonicalState.refreshRequired ? requestRouteRefresh(1, true) : fallback())

	const renderRetryStatus = (status: HTMLElement, message: string, retryAction: () => undefined | Promise<unknown>): void => {
		status.hidden = false
		status.className = 'system-status error'
		const retry = element('button', '', 'Retry')
		retry.type = 'button'
		retry.addEventListener('click', retryAction)
		status.replaceChildren(element('span', '', message), retry)
	}

	const animateLiveNode = (node: HTMLElement, className: string) => {
		node.classList.remove('live-added', 'live-changed', className)
		requestAnimationFrame(() => {
			node.classList.add(className)
			const clear = () => node.classList.remove(className)
			node.addEventListener('animationend', clear, { once: true })
			window.setTimeout(clear, 1_600)
		})
	}

	const applyLiveChanges = (container: ParentNode, previous: ReadonlyMap<string, string>, { live = false, selector = '[data-live-key]' }: LiveChangeOptions = {}) => {
		const changes = { added: 0, changed: 0 }
		if (!live) return changes
		const nodes = [...container.querySelectorAll<HTMLElement>(selector)]
		const classified = classifyLiveRecords(
			previous,
			nodes.flatMap(node => {
				const key = node.dataset.liveKey
				return key === undefined ? [] : [{ key, signature: node.dataset.liveSignature ?? '' }]
			}),
		)
		for (const [index, record] of classified.entries()) {
			const node = requiredArrayItem(nodes, index, 'Classified live node')
			if (record.state === 'added') {
				changes.added++
				animateLiveNode(node, 'live-added')
			} else if (record.state === 'changed') {
				changes.changed++
				animateLiveNode(node, 'live-changed')
			}
		}
		return changes
	}

	const eventStreamState = (eventSource: EventSource | undefined): 'closed' | 'connecting' | 'open' => {
		if (eventSource?.readyState === EventSource.OPEN) return 'open'
		return eventSource?.readyState === EventSource.CONNECTING || eventSource === undefined ? 'connecting' : 'closed'
	}

	const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
		const node = document.createElement(tag)
		if (className) node.className = className
		if (text !== undefined) node.textContent = text
		return node
	}

	const number = exactNumber

	const counted = (value: string | number | bigint | null | undefined, singular: string, plural = `${singular}s`): string => `${number(value)} ${Number(value) === 1 ? singular : plural}`

	const time = utcDateTime

	const age = (value: string | number | Date | null | undefined) => {
		if (!value) return 'unavailable'
		const seconds = Math.max(0, Math.floor((Date.now() + liveState.serverClockOffsetMs - new Date(value).getTime()) / 1000))
		if (seconds < 60) return `${seconds}s ago`
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
		return `${Math.floor(seconds / 86400)}d ago`
	}

	const exactTimestamp = (value: string | number | Date | null | undefined) => (value ? new Date(value).toISOString() : 'No timestamp')

	const until = (value: string | number | Date | null | undefined) => {
		if (!value) return 'time unknown'
		const seconds = Math.ceil((new Date(value).getTime() - (Date.now() + liveState.serverClockOffsetMs)) / 1000)
		if (seconds <= 0) return 'now'
		return seconds < 60 ? `in ${seconds}s` : `in ${Math.ceil(seconds / 60)}m`
	}

	const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

	const networkSnapshotCache = createSessionSnapshotCache(
		availableSessionSnapshotStorage(() => window.sessionStorage),
		'augurscan:network-status:v1',
		decodeNetworkResponse,
	)

	const demo = demoFactory?.({
		get pageUrl() {
			return pageUrl
		},
		get canonicalRefreshRequired() {
			return canonicalState.refreshRequired
		},
		selectedChainId: () => selectedChainId(),
	})
	const api = demo?.api ?? fetchApi
	const queryCache = createQueryCache(path => api(path), 5_000)
	mountSearch(
		path => queryCache.get(path),
		() => selectedChainId(),
	)

	const renderNetworks = createNetworkRenderer({
		state: networkRenderState,
		networkCards,
		selectedChainId: () => selectedChainId(),
		invalidateAddressIdentityCache: (chainId, missesOnly) => invalidateAddressIdentityCache(chainId, missesOnly),
		getActiveReorgRecovery: () => canonicalState.recovery,
		refreshCanonicalViews: (title, detail) => refreshCanonicalViews(title, detail),
		getClockOffset: () => liveState.serverClockOffsetMs,
		getAwaitingResumedStatus: () => liveState.awaitingResumedNetworkStatus,
		getLastRequestFailed: () => liveState.lastNetworkRequestFailed,
		updateConnectionStatus,
		updateFreshness: () => updateFreshness(),
		setLiveRecord,
		element,
		number,
		isDemo,
		time,
		exactTimestamp,
		age,
		until,
	})

	const updateFreshness = () => {
		if (canonicalState.recovery !== undefined) return
		delete $('#freshness-banner').dataset.status
		if (canonicalState.refreshRequired) {
			const banner = $('#freshness-banner')
			banner.hidden = false
			$('#freshness-title').textContent = 'Chain update refresh incomplete'
			$('#freshness-detail').textContent = 'A chain update was recorded, but the content refresh failed. Retrying automatically.'
			return
		}
		if (liveState.awaitingResumedNetworkStatus) {
			$('#freshness-banner').hidden = true
			return
		}
		if (liveState.lastNetworkRequestFailed) {
			$('#freshness-banner').hidden = true
			return
		}
		const staleHead = networkRenderState.latestNetworks.filter(network => String(network.chain_id) === selectedChainId()).find(network => indexerHeadFreshness(network, Date.now() + liveState.serverClockOffsetMs).stale)
		if (staleHead !== undefined) {
			const banner = $('#freshness-banner')
			banner.hidden = false
			$('#freshness-title').textContent = 'RPC chain head is stale'
			$('#freshness-detail').textContent = `Newest observed block is ${age(staleHead.indexed_timestamp)}; block-based catch-up status may be misleading.`
			return
		}
		const stale = networkRenderState.latestNetworks.filter(network => String(network.chain_id) === selectedChainId()).filter(network => !network.last_success_at || Date.now() + liveState.serverClockOffsetMs - new Date(network.last_success_at).getTime() > liveState.networkFreshnessThresholdMs)
		const banner = $('#freshness-banner')
		if (stale.length === 0) {
			banner.hidden = true
			return
		}
		banner.hidden = false
		$('#freshness-title').textContent = 'Selected network is not updating'
		$('#freshness-detail').textContent = 'Showing the last committed database state.'
	}

	const completeCanonicalRefresh = () => {
		canonicalState.refreshRequired = false
		activityDetailState.pendingCanonicalActivityCount = undefined
		if (isActivity) {
			$('#more').hidden = activityRoute.nextCursor === undefined
			$('#more').disabled = false
		}
		if (isRichList) {
			$('#richlist-more').hidden = richListRoute.items.length >= richListRoute.total
			$('#richlist-more').disabled = false
		}
		const accountMore = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
		if (accountMore !== null && activityDetailState.activeAccountTransactions !== undefined) {
			accountMore.hidden = activityDetailState.activeAccountTransactions.nextPageCursor === undefined || (activityDetailState.activeAccountTransactions.pageError !== undefined && activityDetailState.activeAccountTransactions.pageErrorAppend)
			accountMore.disabled = false
		}
		hideCanonicalDialogStatus()
		updateFreshness()
	}

	const selectedChainId = () => (globalNetworkFilter.dataset.restored === 'true' ? globalNetworkFilter.value : initialChainId)

	const requiredChainId = () => {
		const chainId = selectedChainId()
		if (chainId === '') throw new Error('Waiting for network status before loading this view')
		return chainId
	}

	const operationsData = createOperationsData(
		path => api(path),
		requiredChainId,
		() => pageUrl,
	)

	const { operationCard, operationRow, exactEvidenceRow, operationsPanel } = createOperationsComponents()
	const {
		operationsCatalogSection,
		approvalTransitionSummary,
		captureOperationsRenderContext,
		restoreOperationsRenderContext,
		operationNumber,
		operationCounted,
		operationRatio,
		operationsHref,
		operationsSectionFilters,
		operationsDetailRoute,
		historyBlockRangeLabel,
		operationsDetailRouteKey,
		rawEvidence,
		detailEvidenceRows,
		detailEvidenceRowsFor,
	} = createOperationsRouteView({
		lookup: $,
		getPageUrl: () => pageUrl,
		selectedChainId,
		requiredChainId,
		isDemo,
		element,
		number,
		counted,
		operationRow,
	})

	const renderOperations = (response: OperationsResponse, preservedContext?: OperationsRenderContext) =>
		renderOperationsOverview(
			{
				lookup: $,
				captureContext: captureOperationsRenderContext,
				restoreContext: restoreOperationsRenderContext,
				networks: networkRenderState.latestNetworks,
				requiredChainId,
				element,
				number,
				exactTimestamp,
				counted,
				operationNumber,
				operationCounted,
				operationsHref,
				approvalTransitionSummary,
				operationsCatalogSection,
				operationsSectionFilters,
				connection,
				setRiskCatalogState: state => {
					operationsState.riskCatalogState = state
				},
				setCatalogState: state => {
					operationsState.catalogState = state
				},
				loadOperations: options => loadOperations(options),
				components: { operationCard, operationRow, exactEvidenceRow, operationsPanel },
			},
			response,
			preservedContext,
		)

	const renderOperationsDetailPage = (response: OperationsResponse, route: OperationsDetailRoute, preservedContext?: OperationsRenderContext) =>
		renderOperationsDetail(
			{
				lookup: $,
				captureContext: captureOperationsRenderContext,
				restoreContext: restoreOperationsRenderContext,
				element,
				connection,
				operationsHref,
				approvalTransitionSummary,
				rawEvidence,
				operationCounted,
				operationRatio,
				operationNumber,
				operationsHistoryOffset,
				operationsRiskHistoryKeys,
				detailEvidenceRows,
				historyBlockRangeLabel,
				isDemo,
				pageUrl,
				demoRiskHistoryAutoLoadConsumed: operationsState.demoRiskHistoryAutoLoadConsumed,
				requiredChainId,
				operationsDetailRouteKey,
				detailEvidenceRowsFor,
				consumeDemoRiskHistoryAutoLoad: () => {
					operationsState.demoRiskHistoryAutoLoadConsumed = true
				},
				setDetailState: state => {
					operationsState.detailState = state
				},
				loadOperations: options => loadOperations(options),
				components: { operationCard, operationRow, exactEvidenceRow, operationsPanel },
			},
			response,
			route,
			preservedContext,
		)

	const loadOperations = createOperationsLoader({
		state: operationsState,
		requiredChainId,
		lookup: $,
		api,
		operationsDetailRoute,
		operationsCatalogSection,
		operationsDetailRouteKey,
		data: operationsData,
		renderOperations,
		renderOperationsDetailPage,
		renderRetryStatus,
	})

	const { syncNetworkUrl, updateNetworkLabels, reconcileNetworkOptions, loadNetworks } = createNetworkRoute({
		lookup: $,
		globalNetworkFilter,
		networkCards,
		selectedChainId,
		isDemo,
		setPageUrl: url => {
			pageUrl = url
		},
		liveState,
		canonicalState,
		api,
		writeSnapshot: snapshot => networkSnapshotCache.write(snapshot),
		resetSelectedNetworkContext: () => resetSelectedNetworkContext(),
		renderNetworks,
		getLatestNetworks: () => networkRenderState.latestNetworks,
		updateFreshness,
		updateConnectionStatus,
		loadRouteAfterNetworkChange: async () => {
			if (isActivity) await loadLogs()
			else if (isSystem) await loadSystemState()
			else if (isOperations) await loadOperations()
			else if (isContracts) await loadContracts()
			else if (isRichList) await loadRichList()
			else if (isAddress) await loadAddressProfile()
			else if (isExplorer) await renderExplorerPage(location.pathname, requiredChainId(), path => queryCache.get(path))
		},
	})

	const rowFor = (log: ActivityRecord) =>
		renderActivityRow(
			{
				setLiveRecord,
				element,
				number,
				isDemo,
				time,
				age,
				exactTimestamp,
				eventDrawerFor,
				closeEventDrawer: options => closeEventDrawer(options),
				openDetail: log => openDetail(log),
			},
			log,
		)

	const { activityFilterValues, syncActivityFilterUrl, validateAddressFilter, showInvalidAddressFilter, hasActivityFilters, setLogControlsBusy, loadLogs } = createActivityRoute({
		lookup: $,
		feed,
		feedState,
		activityRoute,
		activityDetailState,
		canonicalState,
		getViewContextVersion: () => viewContextVersion,
		requiredChainId,
		selectedChainId,
		api,
		rowFor,
		liveSnapshot,
		applyLiveChanges,
		eventDrawers: () => eventDrawers(),
		captureDetailContext: drawer => captureDetailContext(drawer),
		placeEventDrawer: (drawer, options) => placeEventDrawer(drawer, options),
		updateLogDisclosures: () => updateLogDisclosures(),
		restoreDetailContext: (snapshot, drawer) => restoreDetailContext(snapshot, drawer),
		clearDetailUrl: () => clearDetailUrl(),
		getRequestRouteRefresh: () => requestRouteRefresh,
		renderRetryStatus,
		errorMessage,
		element,
		logRefreshGate,
	})

	const { detailCard, evidenceDetailCard, addressDetailCard, internalEvidenceLink, invalidateAddressIdentityCache, protocolAddressLink, decodedArgumentsTable, clearAddressIdentityCache } = createEvidenceComponents({
		element,
		api,
		selectedChainId,
		isDemo,
		number,
	})

	const { eventDrawers, eventDrawerFor, drawerLogFor, updateLogDisclosures, removeEventDrawers, closeEventDrawer, captureDetailContext, restoreDetailContext, placeEventDrawer, openDetail, restorePendingCanonicalLog } = createEventDetailRoute({
		feed,
		activityDetailState,
		canonicalState,
		element,
		number,
		api,
		syncCanonicalDialogStatus,
		clearDetailUrl: () => clearDetailUrl(),
		errorMessage,
		detailCard,
		evidenceDetailCard,
		addressDetailCard,
		decodedArgumentsTable,
	})

	const { captureAccountDialogSnapshot, openAccountTransactions, restorePendingCanonicalAccount, closeDetail, clearDetailUrl } = createAccountDetailRoute({
		activityDetailState,
		canonicalState,
		detailContent,
		dialog,
		loaderDeps: {
			activityDetailState,
			canonicalState,
			accountPageRefreshGate,
			getIsRichList: () => isRichList,
			detailContent,
			dialog,
			lookup: $,
			syncCanonicalDialogStatus,
			removeEventDrawers,
			liveSnapshot,
			setLiveRecord,
			element,
			number,
			time,
			nativeSymbol: chainId => nativeSymbol(chainId),
			internalEvidenceLink,
			protocolAddressLink,
			decodedArgumentsTable,
			applyLiveChanges,
			api,
			selectedChainId,
			errorMessage,
			accountTransactionsError: (detail, hasLoaded, append) => accountTransactionsError(detail, hasLoaded, append),
		},
		detailRefreshGate,
		getIsRichList: () => isRichList,
		getIsAddress: () => isAddress,
		getRichListItems: () => richListRoute.items,
		getAddressProfile: () => addressProfileRoute.profile,
		removeEventDrawers,
		hideCanonicalDialogStatus,
	})

	const { staticField, staticAddressField, metricCard, chartNumericValue, chartCard, stateHeader } = createStateComponents(element, protocolAddressLink)

	const nativeSymbol = (chainId = selectedChainId()) => (String(chainId) === '1' ? 'ETH' : 'SepoliaETH')

	const contractsRoute = createContractsRoute({
		lookup: $,
		element,
		internalEvidenceLink,
		number,
		age,
		exactTimestamp,
		api,
		requiredChainId,
		getViewContextVersion: () => viewContextVersion,
		canonicalState,
		refreshGate: contractRefreshGate,
		errorMessage,
		renderRetryStatus,
		retryCanonicalViewOr,
	})
	const loadContracts = contractsRoute.loadContracts

	const richListRoute = createRichListRoute({
		lookup: $,
		getPageUrl: () => pageUrl,
		selectedChainId,
		requiredChainId,
		isDemo,
		setLiveRecord,
		element,
		protocolAddressLink,
		nativeSymbol,
		number,
		counted,
		openAccountTransactions: item => openAccountTransactions(item),
		canonicalState,
		getViewContextVersion: () => viewContextVersion,
		api,
		refreshGate: richListRefreshGate,
		renderRetryStatus,
		richListError: (detail, append, empty) => richListError(detail, append, empty),
		errorMessage,
		retryCanonicalViewOr,
	})
	const loadRichList = richListRoute.loadRichList

	const renderAddressProfile = (item: RichListRecord, transactions: AccountTransaction[], interactions: AccountTransaction[], options: { live?: boolean; portfolioFocusKind?: 'forks' | 'lp' | 'reports' } = {}) =>
		renderAddressProfilePage(
			{
				lookup: $,
				liveSnapshot,
				nativeSymbol,
				element,
				isDemo,
				setLiveRecord,
				number,
				protocolAddressLink,
				operationsPanel,
				operationRow,
				operationCounted,
				operationsHref,
				openAccountTransactions,
				internalEvidenceLink,
				time,
				decodedArgumentsTable,
				applyLiveChanges,
				loadAddressProfile: options => loadAddressProfile(options),
			},
			item,
			transactions,
			interactions,
			options,
		)

	const accountTransactionsError = (detail: string, hasLoaded: boolean, append: boolean) => {
		if (!hasLoaded) return `Could not load sent transactions: ${detail}`
		return append ? `Could not load more transactions; showing the last known activity: ${detail}` : `Could not refresh sent transactions; showing the last known activity: ${detail}`
	}

	const richListError = (detail: string, append: boolean, empty: boolean) => {
		if (append) return `Could not load more; showing known rankings: ${detail}`
		return empty ? `Rich list unavailable: ${detail}` : `Refresh failed; showing last known rankings: ${detail}`
	}

	const yesNoCheckpoint = (value: unknown) => {
		if (value === undefined) return 'No checkpoint'
		return value ? 'Yes' : 'No'
	}

	const nextTabIndex = (key: string, current: number, count: number) => {
		if (key === 'Home') return 0
		if (key === 'End') return count - 1
		return (current + (key === 'ArrowRight' ? 1 : -1) + count) % count
	}

	const addressProfileRoute = createAddressProfileRoute({
		renderAddressProfile,
		lookup: $,
		element,
		api,
		getPageUrl: () => pageUrl,
		getViewContextVersion: () => viewContextVersion,
		selectedChainId,
		requiredChainId,
		getNetworks: () => networkRenderState.latestNetworks,
		isDemo,
		canonicalState,
		refreshGate: addressProfileRefreshGate,
		errorMessage,
		retryCanonicalViewOr,
	})
	const loadAddressProfile = addressProfileRoute.loadAddressProfile

	const { fetchEntityHistory, entityHistoryCollections } = createStateHistoryData(
		path => api(path),
		() => pageUrl,
	)

	const historyCoverageNotice = (history: EntityHistory, type: StateTab, item: StateEntity): HTMLElement =>
		renderStateHistoryCoverage(
			{
				lookup: $,
				element,
				entityHistoryCollections,
				historyBlockRangeLabel,
				number,
				selectEntity: (item, options) => selectEntity(item, options),
				isDemo,
				pageUrl,
				demoAutoLoadConsumed: systemRouteState.demoHistoryAutoLoadConsumed,
				consumeDemoAutoLoad: () => {
					systemRouteState.demoHistoryAutoLoadConsumed = true
				},
			},
			history,
			type,
			item,
		)

	const stateRiskDeps = (requestVersion: number, canonicalGeneration: number) => ({
		lookup: $,
		fetchEntityHistory,
		isCurrent: () => requestVersion === systemRouteState.detailRequestVersion && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration),
		nativeSymbol,
		stateHeader,
		historyCoverageNotice,
		element,
		operationsHref,
		operationsPanel,
		operationRow,
		metricCard,
		number,
		chartCard,
		staticField,
		staticAddressField,
		chartNumericValue,
		yesNoCheckpoint,
	})

	const renderPoolDetail = (poolItem: PoolRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => renderPoolDetailPage(stateRiskDeps(requestVersion, canonicalGeneration), poolItem, suppliedHistory)

	const renderVaultDetail = (vaultItem: VaultRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => renderVaultDetailPage(stateRiskDeps(requestVersion, canonicalGeneration), vaultItem, suppliedHistory)

	const stateEntityDeps = (requestVersion: number, canonicalGeneration: number) => ({
		lookup: $,
		fetchEntityHistory,
		isCurrent: () => requestVersion === systemRouteState.detailRequestVersion && isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration),
		stateHeader,
		pageUrl,
		isDemo,
		historyCoverageNotice,
		element,
		metricCard,
		number,
		staticField,
		chartCard,
		stateData: systemRouteState.data,
		counted,
		staticAddressField,
	})

	const renderQuestionDetail = (question: QuestionRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => renderQuestionDetailPage(stateEntityDeps(requestVersion, canonicalGeneration), question, suppliedHistory)

	const renderUniverseDetail = (universe: UniverseRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => renderUniverseDetailPage(stateEntityDeps(requestVersion, canonicalGeneration), universe, suppliedHistory)

	const { entityKey, entityCopy, selectEntity, stateItems, renderEntityList, renderStateStats, setSystemControlsDisabled, setStateTab } = createSystemRoute({
		state: systemRouteState,
		canonicalState,
		lookup: $,
		element,
		number,
		counted,
		nativeSymbol,
		fetchEntityHistory,
		renderPoolDetail,
		renderVaultDetail,
		renderQuestionDetail,
		renderUniverseDetail,
		systemDetailRefreshGate,
		liveSnapshot,
		setLiveRecord,
		applyLiveChanges,
		errorMessage,
		retryCanonicalViewOr,
		navigateToCanonicalEntity: (type, item) => {
			const target = new URL(location.href)
			if (type === 'questions' && 'question_id' in item) target.pathname = `/question/${encodeURIComponent(item.question_id)}`
			else if (type === 'universes' && 'universe_id' in item) target.pathname = `/universe/${encodeURIComponent(item.universe_id)}`
			else return
			target.searchParams.delete('tab')
			target.searchParams.delete('entity')
			void navigateInPlace(target)
		},
	})

	const systemCatalog = createSystemCatalogLoader({
		lookup: $,
		element,
		api,
		canonicalState,
		getViewContextVersion: () => viewContextVersion,
		getStateData: () => systemRouteState.data,
		setStateData: catalog => {
			systemRouteState.data = catalog
		},
		getActiveStateType: () => systemRouteState.activeType,
		getSelectedEntityKey: () => systemRouteState.selectedKey,
		getSelectedEntityHistoryOffset: () => systemRouteState.historyOffset,
		getStateDetailContextVersion: () => systemRouteState.detailContextVersion,
		requiredChainId,
		stateItems,
		entityCopy,
		entityKey,
		fetchEntityHistory,
		systemDetailRefreshGate,
		systemStateRefreshGate,
		setSystemControlsDisabled,
		renderStateStats,
		renderEntityList,
		errorMessage,
		retryCanonicalViewOr,
	})
	const loadSystemState = systemCatalog.loadSystemState

	const resetActivityFilterContext = () => {
		if (document.querySelector('.event-detail-drawer')) closeEventDrawer()
		feed.replaceChildren()
		feed.setAttribute('aria-busy', 'true')
		activityRoute.nextCursor = undefined
		$('#activity-summary').textContent = ''
		feedState.hidden = false
		feedState.textContent = 'Loading activity…'
		$('#more').hidden = true
		$('#activity-more-status').hidden = true
		$('#activity-more-status').replaceChildren()
		setLogControlsBusy(true)
	}

	$('#filters').addEventListener('submit', event => {
		event.preventDefault()
		if (!validateAddressFilter(true)) return
		const nextFilters = activityFilterValues()
		if (nextFilters.event === activityRoute.appliedFilters.event && nextFilters.address === activityRoute.appliedFilters.address) return
		activityRoute.appliedFilters = nextFilters
		syncActivityFilterUrl()
		viewContextVersion++
		activityRoute.abortController?.abort()
		activityRoute.requestVersion++
		resetActivityFilterContext()
		void loadLogs()
	})

	$('#clear-filters').addEventListener('click', () => {
		$('#event-filter').value = ''
		$('#address-filter').value = ''
		validateAddressFilter()
		activityRoute.appliedFilters = activityFilterValues()
		syncActivityFilterUrl()
		viewContextVersion++
		activityRoute.abortController?.abort()
		activityRoute.requestVersion++
		resetActivityFilterContext()
		void loadLogs()
	})

	$('#address-filter').addEventListener('input', () => validateAddressFilter())

	$('#filters').addEventListener('input', () => {
		$('#clear-filters').disabled = !hasActivityFilters()
	})

	$('#more').addEventListener('click', () => loadLogs({ append: true }))

	$('#close-detail').addEventListener('click', () => closeDetail())

	dialog.addEventListener('click', event => {
		if (event.target === dialog) closeDetail()
	})

	dialog.addEventListener('cancel', event => {
		event.preventDefault()
		closeDetail()
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
		clearDetailUrl()
	})

	window.addEventListener('resize', () => {
		for (const drawer of eventDrawers()) placeEventDrawer(drawer)
	})

	document.addEventListener('keydown', event => {
		if (!document.querySelector('.event-detail-drawer')) return
		handleActivityDetailDrawerEscape(event, () => {
			const drawer = eventDrawers().find(item => item.contains(document.activeElement)) ?? eventDrawers().at(-1)
			closeEventDrawer({ restoreFocus: true, ...(drawer?.dataset.triggerKey === undefined ? {} : { key: drawer.dataset.triggerKey }) })
		})
	})

	const isStateTab = (value: string | undefined | null): value is StateTab => value === 'pools' || value === 'vaults' || value === 'questions' || value === 'universes'

	const historyRangeForm = document.querySelector<HTMLFormElement>('#history-range')

	const historyFromBlock = document.querySelector<HTMLInputElement>('#history-from-block')

	const historyToBlock = document.querySelector<HTMLInputElement>('#history-to-block')

	const historyRangeClear = document.querySelector<HTMLButtonElement>('#history-range-clear')

	if (historyRangeForm === null || historyFromBlock === null || historyToBlock === null || historyRangeClear === null) throw new Error('History range controls are missing')

	historyFromBlock.value = pageUrl.searchParams.get('fromBlock') ?? ''

	historyToBlock.value = pageUrl.searchParams.get('toBlock') ?? ''

	historyRangeForm.addEventListener('submit', event => {
		event.preventDefault()
		historyFromBlock.setCustomValidity('')
		historyToBlock.setCustomValidity('')
		for (const input of [historyFromBlock, historyToBlock]) {
			if (input.value !== '' && !/^\d+$/.test(input.value)) {
				input.setCustomValidity('Enter a whole non-negative block number')
				input.reportValidity()
				return
			}
		}
		if (historyFromBlock.value !== '' && historyToBlock.value !== '' && BigInt(historyFromBlock.value) > BigInt(historyToBlock.value)) {
			historyToBlock.setCustomValidity('To block must be at or after from block')
			historyToBlock.reportValidity()
			return
		}
		for (const [name, input] of [
			['fromBlock', historyFromBlock],
			['toBlock', historyToBlock],
		] as const) {
			if (input.value === '') pageUrl.searchParams.delete(name)
			else pageUrl.searchParams.set(name, input.value)
		}
		history.replaceState(null, '', pageUrl)
		systemRouteState.historyOffset = 0
		void loadSystemState()
	})

	historyRangeClear.addEventListener('click', () => {
		historyFromBlock.value = ''
		historyToBlock.value = ''
		historyFromBlock.setCustomValidity('')
		historyToBlock.setCustomValidity('')
		pageUrl.searchParams.delete('fromBlock')
		pageUrl.searchParams.delete('toBlock')
		history.replaceState(null, '', pageUrl)
		systemRouteState.historyOffset = 0
		void loadSystemState()
	})

	const stateTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-state-tab]')]

	for (const tab of stateTabs) {
		tab.addEventListener('click', () => {
			if (isStateTab(tab.dataset.stateTab)) setStateTab(tab.dataset.stateTab)
		})
		tab.addEventListener('keydown', event => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
			event.preventDefault()
			const current = stateTabs.indexOf(tab)
			const next = nextTabIndex(event.key, current, stateTabs.length)
			const nextTab = stateTabs[next]
			if (nextTab === undefined) return
			nextTab.focus()
			if (isStateTab(nextTab.dataset.stateTab)) setStateTab(nextTab.dataset.stateTab)
		})
	}

	$('#entity-search').addEventListener('input', () => {
		systemRouteState.detailContextVersion++
		systemRouteState.detailRequestVersion++
		if (systemRouteState.data !== undefined) void renderEntityList()
	})

	$('#entity-search').addEventListener('keydown', event => {
		const input = event.currentTarget
		if (!(input instanceof HTMLInputElement) || event.key !== 'Escape' || input.value === '') return
		event.preventDefault()
		input.value = ''
		systemRouteState.detailContextVersion++
		systemRouteState.detailRequestVersion++
		if (systemRouteState.data !== undefined) void renderEntityList()
	})

	const resetSelectedNetworkContext = () => {
		queryCache.clear()
		loadedRouteContexts.clear()
		operationsState.routeCache.clear()
		operationsState.renderedContext = undefined
		viewContextVersion++
		activityDetailState.detailContextVersion++
		systemRouteState.detailContextVersion++
		contractsRoute.invalidate()
		richListRoute.invalidate()
		addressProfileRoute.invalidate()
		systemCatalog.invalidate()
		systemRouteState.detailRequestVersion++
		canonicalState.recovery = undefined
		activityDetailState.activeLog = undefined
		removeEventDrawers()
		activityDetailState.pendingCanonicalLog = undefined
		activityDetailState.pendingCanonicalActivityCount = undefined
		activityDetailState.pendingCanonicalAccount = undefined
		activityDetailState.pendingAccountDialogSnapshot = undefined
		canonicalState.refreshRequired = false
		hideCanonicalDialogStatus()
		if (liveState.blockRefreshTimer !== undefined) clearTimeout(liveState.blockRefreshTimer)
		liveState.blockRefreshTimer = undefined
		if (networkRenderState.headFreshnessTimer !== undefined) clearTimeout(networkRenderState.headFreshnessTimer)
		networkRenderState.headFreshnessTimer = undefined
		liveState.pendingBlockUpdates = 0
		activityRoute.abortController?.abort()
		activityRoute.abortController = undefined
		activityRoute.requestVersion++
		feed.replaceChildren()
		activityRoute.nextCursor = undefined
		$('#activity-summary').textContent = 'No logs shown'
		$('#more').hidden = true
		if (dialog.open) closeDetail({ preservePendingCanonicalAccount: true })
		const url = new URL(location.href)
		url.searchParams.delete('log')
		url.searchParams.delete('entity')
		url.searchParams.delete('account')
		url.searchParams.delete('contract')
		history.replaceState(null, '', url)
		systemRouteState.detailRequestVersion++
		systemRouteState.data = undefined
		systemRouteState.selectedKey = undefined
		systemRouteState.historyOffset = 0
		$('#state-stats').replaceChildren()
		$('#entity-list').replaceChildren()
		$('#entity-count').textContent = '—'
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', 'Loading system state…'))
		contractsRoute.clear()
		$('#contract-list').replaceChildren()
		richListRoute.clear()
		$('#richlist-rows').replaceChildren()
		$('#richlist-summary').textContent = '0 of 0 known addresses'
		$('#richlist-more').hidden = true
		addressProfileRoute.clear()
		$('#address-profile-content').replaceChildren(element('div', 'state-placeholder', 'Loading address activity…'))
		operationsState.requestVersion++
		operationsState.loadState.promise = undefined
		operationsState.loadState.context = undefined
		operationsState.catalogState = undefined
		operationsState.riskCatalogState = undefined
		$('#operations-content').replaceChildren()
		$('#operations-content').setAttribute('aria-busy', 'true')
		if (location.pathname.startsWith('/question/') || location.pathname.startsWith('/universe/')) {
			const selection = systemRouteSelection()
			setStateTab(selection.tab, selection.entity)
		}
	}

	globalNetworkFilter.addEventListener('change', async () => {
		resetSelectedNetworkContext()
		syncNetworkUrl()
		updateNetworkLabels()
		renderNetworks(networkRenderState.latestNetworks)
		updateFreshness()
		if (isSystem) {
			await loadSystemState()
		} else if (isOperations) {
			await loadOperations()
		} else if (isContracts) {
			await loadContracts()
		} else if (isRichList) {
			await loadRichList()
		} else if (isAddress) {
			await loadAddressProfile()
		} else if (isExplorer) {
			await renderExplorerPage(location.pathname, requiredChainId(), path => queryCache.get(path))
		} else {
			await loadLogs()
		}
	})

	$('#rich-sort').addEventListener('change', () => {
		const url = new URL(location.href)
		url.searchParams.set('sort', $('#rich-sort').value)
		history.pushState(null, '', url)
		pageUrl = url
		viewContextVersion++
		richListRoute.invalidate()
		richListRoute.clear()
		$('#richlist-rows').replaceChildren()
		$('#richlist-rows').setAttribute('aria-busy', 'true')
		$('#richlist-summary').textContent = ''
		$('#richlist-status').hidden = false
		$('#richlist-status').className = 'system-status'
		$('#richlist-status').textContent = 'Loading known addresses…'
		$('#rich-sort').disabled = true
		$('#richlist-more').hidden = true
		$('#richlist-more').disabled = true
		$('#richlist-more-status').hidden = true
		$('#richlist-more-status').replaceChildren()
		void loadRichList()
	})

	$('#rich-view-toggle').addEventListener('click', () => {
		const url = new URL(location.href)
		url.searchParams.set('view', $('#richlist-shell').hidden ? 'cards' : 'table')
		history.pushState(null, '', url)
		pageUrl = url
		richListRoute.renderRichList()
	})

	$('#richlist-more').addEventListener('click', () => loadRichList({ append: true }))

	const {
		requestRouteRefresh: routeRefresh,
		refreshCanonicalViews: refreshCanonical,
		connectStream,
	} = createLiveCoordinator({
		lookup: $,
		canonicalState,
		activityDetailState,
		liveState,
		feed,
		dialog,
		detailContent,
		isDemo,
		getPageUrl: () => pageUrl,
		selectedChainId,
		requiredChainId,
		loadSystemState,
		loadOperations,
		loadContracts,
		loadRichList,
		loadAddressProfile,
		loadLogs,
		openAccountTransactions,
		restorePendingCanonicalAccount,
		eventDrawers,
		drawerLogFor,
		openDetail,
		restorePendingCanonicalLog,
		captureAccountDialogSnapshot,
		completeCanonicalRefresh,
		showCanonicalDialogStatus,
		syncCanonicalDialogStatus,
		updateFreshness,
		updateConnectionStatus,
		queryCache,
		richListRoute,
		addressProfileRoute,
		applyDemoBlock: payload => demo?.applyBlock(payload),
		observeDemoReorg: address => demo?.observeReorg(address),
		invalidateAddressIdentityCache,
		clearAddressIdentityCache: () => clearAddressIdentityCache(),
	})
	requestRouteRefresh = routeRefresh
	refreshCanonicalViews = refreshCanonical

	if (initialChainId) {
		globalNetworkFilter.replaceChildren(new Option(knownNetworkName(initialChainId), initialChainId))
		globalNetworkFilter.value = initialChainId
		globalNetworkFilter.dataset.restored = 'true'
		syncNetworkUrl()
		updateNetworkLabels()
	}

	const cachedNetworkSnapshot = initialChainId === '' ? undefined : networkSnapshotCache.read()

	if (cachedNetworkSnapshot?.items.some(network => String(network.chain_id) === initialChainId)) {
		if (cachedNetworkSnapshot.clientClockOffsetMs !== undefined) liveState.serverClockOffsetMs = cachedNetworkSnapshot.clientClockOffsetMs
		if (cachedNetworkSnapshot.freshnessThresholdMs !== undefined) liveState.networkFreshnessThresholdMs = cachedNetworkSnapshot.freshnessThresholdMs
		liveState.restoredCurrentNetworkSnapshot = restoredNetworkSnapshotIsCurrent(cachedNetworkSnapshot.writtenAt)
		// An old snapshot (restored session, discarded tab) must not be judged for freshness against the current clock.
		if (!liveState.restoredCurrentNetworkSnapshot) liveState.awaitingResumedNetworkStatus = true
		reconcileNetworkOptions(cachedNetworkSnapshot.items)
		renderNetworks(cachedNetworkSnapshot.items)
		updateFreshness()
	}

	connectStream()

	addEventListener('pagehide', () => {
		liveState.stream?.close()
		liveState.stream = undefined
		liveState.streamHasOpened = false
		if (liveState.blockRefreshTimer !== undefined) clearTimeout(liveState.blockRefreshTimer)
		liveState.blockRefreshTimer = undefined
		if (networkRenderState.headFreshnessTimer !== undefined) clearTimeout(networkRenderState.headFreshnessTimer)
		networkRenderState.headFreshnessTimer = undefined
		liveState.pendingBlockUpdates = 0
	})

	const refreshResumedPage = (force = false): Promise<boolean> => {
		liveState.awaitingResumedNetworkStatus = true
		liveState.networkResumeGeneration++
		liveState.lastNetworkRequestFailed = false
		renderNetworks(networkRenderState.latestNetworks)
		updateFreshness()
		return refreshRouteAlongsideNetworkStatus(
			() => loadNetworks({ refreshAfterCurrent: true }),
			() => requestRouteRefresh(1, force),
		)
	}

	addEventListener('pageshow', async (event: PageTransitionEvent) => {
		if (!event.persisted) return
		connectStream()
		await refreshResumedPage(true)
	})

	const suspendedTimersThresholdMs = 10_000

	setInterval(() => {
		const now = Date.now()
		const tickGapMs = now - liveState.lastTimeTickAt
		liveState.lastTimeTickAt = now
		// A large gap between ticks means timers were suspended (system sleep with the tab visible); hidden tabs resume via visibilitychange instead.
		if (!document.hidden && tickGapMs > suspendedTimersThresholdMs) void refreshResumedPage()
		for (const node of document.querySelectorAll<HTMLElement>('[data-time]')) node.textContent = node.classList.contains('cell-time') ? `${time(node.dataset.time)} · ${age(node.dataset.time)}` : age(node.dataset.time)
	}, 1000)

	setInterval(() => {
		if (document.hidden) return
		void refreshRouteAlongsideNetworkStatus(loadNetworks, () => requestRouteRefresh(1))
	}, 12_000)

	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) void refreshResumedPage()
	})

	$('#event-filter').value = initialActivityFilters.event

	$('#address-filter').value = initialActivityFilters.address

	if (pageUrl.searchParams.has('decoded')) syncActivityFilterUrl()

	validateAddressFilter()

	$('#clear-filters').disabled = !hasActivityFilters()

	const initialAccountDeepLink = pageUrl.searchParams.get('account')

	if (!isRichList && initialAccountDeepLink !== null) {
		const url = new URL(location.href)
		url.searchParams.delete('account')
		history.replaceState(null, '', url)
	}

	const visibleRouteSkipTarget = () => {
		if (isExplorer) return '#explorer'
		if (isNotFound) return '#not-found'
		if (isSystem) return '#system'
		if (isOperations) return '#operations'
		if (isContracts) return '#contracts'
		if (isRichList) return '#richlist'
		return isAddress ? '#address-profile' : '#activity'
	}

	const systemRouteSelection = (): { tab: StateTab; entity?: string } => {
		const parts = location.pathname.split('/').filter(Boolean)
		const mapping: Record<string, StateTab> = { question: 'questions', universe: 'universes' }
		const tab = mapping[parts[0] ?? '']
		if (tab !== undefined && parts.length === 2) return { tab, entity: `${selectedChainId()}:${decodeURIComponent(parts[1] ?? '')}` }
		const requested = pageUrl.searchParams.get('tab')
		return { tab: isStateTab(requested) ? requested : 'pools', entity: pageUrl.searchParams.get('entity') ?? undefined }
	}

	const syncVisibleRoute = () => {
		if (location.pathname === '/address' && /^0x[0-9a-fA-F]{40}$/.test(pageUrl.searchParams.get('address') ?? '')) {
			const canonical = new URL(location.href)
			canonical.pathname = `/address/${pageUrl.searchParams.get('address')}`
			canonical.searchParams.delete('address')
			history.replaceState(null, '', canonical)
			pageUrl = canonical
		}
		const route = classifyRoute(location.pathname)
		isSystem = route === 'system'
		isOperations = route === 'operations'
		isContracts = route === 'contracts'
		isRichList = route === 'richlist'
		isAddress = route === 'address'
		isExplorer = route === 'explorer'
		isActivity = route === 'activity'
		isNotFound = route === 'not-found'
		document.body.classList.toggle('canonical-entity-route', isOperations && !location.pathname.startsWith('/operations'))
		document.body.classList.toggle('canonical-system-route', isSystem && location.pathname !== '/system')
		$('#activity').hidden = !isActivity
		$('#system').hidden = !isSystem
		$('#operations').hidden = !isOperations
		$('#contracts').hidden = !isContracts
		$('#richlist').hidden = !isRichList
		$('#address-profile').hidden = !isAddress
		$('#explorer').hidden = !isExplorer
		$('#not-found').hidden = !isNotFound
		document.title = routeTitle(location.pathname)
		$('.skip-link').href = visibleRouteSkipTarget()
		for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a')) {
			const current = new URL(link.href).pathname === location.pathname || (isOperations && new URL(link.href).pathname === '/operations')
			if (current) link.setAttribute('aria-current', 'page')
			else link.removeAttribute('aria-current')
		}
		for (const link of document.querySelectorAll<HTMLAnchorElement>('.operations-nav a')) {
			if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page')
			else link.removeAttribute('aria-current')
		}
		if ([...operationsRouteSelect.options].some(option => option.value === location.pathname)) operationsRouteSelect.value = location.pathname
	}

	syncVisibleRoute()
	const initialRichSort = pageUrl.searchParams.get('sort')
	if (initialRichSort !== null && [...$('#rich-sort').options].some(option => option.value === initialRichSort)) $('#rich-sort').value = initialRichSort

	if (isSystem) {
		const selection = systemRouteSelection()
		setStateTab(selection.tab, selection.entity)
	}

	const initialNetworkStatusLoad = loadInitialNetworkStatus(liveState.restoredCurrentNetworkSnapshot, () => loadNetworks({ synchronizeActivity: false }))

	const loadVisibleRoute = async () => {
		await initialNetworkStatusLoad
		const context = `${selectedChainId()}:${location.pathname}`
		const live = loadedRouteContexts.has(context) && (!isOperations || operationsState.renderedContext === context)
		let loaded: boolean | undefined
		if (isSystem) loaded = await loadSystemState({ live })
		else if (isOperations) loaded = await loadOperations({ live })
		else if (isContracts) loaded = await loadContracts({ live })
		else if (isRichList) loaded = await loadRichList({ live })
		else if (isAddress) loaded = await loadAddressProfile({ live })
		else if (isExplorer) {
			loaded = await renderExplorerPage(location.pathname, requiredChainId(), path => queryCache.get(path))
		} else if (isNotFound) loaded = true
		else {
			syncActivityFilterUrl()
			if (validateAddressFilter()) loaded = await loadLogs({ live })
			else {
				showInvalidAddressFilter()
				loaded = false
			}
		}
		if (loaded !== false) {
			loadedRouteContexts.add(context)
			if (isOperations) operationsState.renderedContext = context
		}
	}

	const stashOperationsRoute = () => {
		if (isOperations) operationsState.stash($('#operations-content'))
	}

	const restoreOperationsRoute = (): OperationsRoutePosition | undefined => (isOperations ? operationsState.restore(`${selectedChainId()}:${location.pathname}`, $('#operations-content')) : undefined)

	const hydrateVisibleRoute = () => {
		if (isActivity) {
			const restoredFilters = {
				event: pageUrl.searchParams.get('event') ?? '',
				address: pageUrl.searchParams.get('address') ?? '',
			}
			$('#event-filter').value = restoredFilters.event
			$('#address-filter').value = restoredFilters.address
			validateAddressFilter()
			$('#clear-filters').disabled = restoredFilters.event === '' && restoredFilters.address === ''
			if (restoredFilters.event !== activityRoute.appliedFilters.event || restoredFilters.address !== activityRoute.appliedFilters.address) {
				activityRoute.appliedFilters = restoredFilters
				viewContextVersion++
				activityRoute.abortController?.abort()
				activityRoute.requestVersion++
				resetActivityFilterContext()
				loadedRouteContexts.delete(`${selectedChainId()}:${location.pathname}`)
			}
		}
		if (isSystem) {
			const selection = systemRouteSelection()
			setStateTab(selection.tab, selection.entity)
			historyFromBlock.value = pageUrl.searchParams.get('fromBlock') ?? ''
			historyToBlock.value = pageUrl.searchParams.get('toBlock') ?? ''
		}
		if (isContracts) {
			if (contractsRoute.items.length > 0) contractsRoute.renderContracts()
		}
		if (isRichList) {
			const sort = pageUrl.searchParams.get('sort')
			if (sort !== null && [...$('#rich-sort').options].some(option => option.value === sort) && $('#rich-sort').value !== sort) {
				$('#rich-sort').value = sort
				richListRoute.clear()
			}
		}
	}

	const invalidateRouteRequests = () => {
		queryCache.clear()
		viewContextVersion++
		activityDetailState.detailContextVersion++
		systemRouteState.detailContextVersion++
		contractsRoute.invalidate()
		richListRoute.invalidate()
		addressProfileRoute.invalidate()
		systemCatalog.invalidate()
		systemRouteState.detailRequestVersion++
		operationsState.requestVersion++
		activityRoute.abortController?.abort()
		activityRoute.abortController = undefined
		activityRoute.requestVersion++
	}

	const focusNewRoute = () => {
		window.scrollTo({ top: 0 })
		const heading = document.querySelector<HTMLElement>('main > section:not([hidden]) h1, main > section:not([hidden]) h2')
		if (heading === null) return
		heading.tabIndex = -1
		heading.focus({ preventScroll: true })
	}

	const reconcileRouteNetwork = () => {
		const routeChainId = pageUrl.searchParams.get('chainId')
		if (routeChainId === null || routeChainId === selectedChainId() || ![...globalNetworkFilter.options].some(option => option.value === routeChainId)) return
		const routeUrl = new URL(location.href)
		globalNetworkFilter.value = routeChainId
		globalNetworkFilter.dataset.restored = 'true'
		resetSelectedNetworkContext()
		history.replaceState(null, '', routeUrl)
		pageUrl = routeUrl
		syncNetworkUrl()
		updateNetworkLabels()
		renderNetworks(networkRenderState.latestNetworks)
		updateFreshness()
	}

	const navigateInPlace = async (url: URL, replace = false) => {
		if (url.pathname === location.pathname && url.search === location.search) return
		const navigation = ++navigationGeneration
		stashOperationsRoute()
		closeEventDrawer()
		invalidateRouteRequests()
		if (replace) history.replaceState(null, '', url)
		else history.pushState(null, '', url)
		pageUrl = new URL(location.href)
		reconcileRouteNetwork()
		syncVisibleRoute()
		const restoredPosition = restoreOperationsRoute()
		hydrateVisibleRoute()
		await loadVisibleRoute()
		if (navigation !== navigationGeneration) return
		if (restoredPosition === undefined) focusNewRoute()
	}

	const restoreRouteDeepLink = async () => {
		const currentUrl = new URL(location.href)
		const deepLink = currentUrl.searchParams.get('log')
		const accountDeepLink = currentUrl.searchParams.get('account')
		if (isActivity && deepLink !== null) {
			const parts = deepLink.split(':')
			const [chainId, blockHash, transactionHash, logIndex] = parts
			const parsedLogIndex = logIndex === undefined || !/^\d+$/.test(logIndex) ? undefined : Number(logIndex)
			if (
				parts.length === 4 &&
				typeof chainId === 'string' &&
				chainId === selectedChainId() &&
				typeof blockHash === 'string' &&
				/^0x[0-9a-fA-F]{64}$/.test(blockHash) &&
				typeof transactionHash === 'string' &&
				/^0x[0-9a-fA-F]{64}$/.test(transactionHash) &&
				parsedLogIndex !== undefined &&
				Number.isSafeInteger(parsedLogIndex)
			) {
				await openDetail({ chain_id: chainId, block_hash: blockHash, tx_hash: transactionHash, log_index: parsedLogIndex })
				return
			}
			currentUrl.searchParams.delete('log')
			history.replaceState(null, '', currentUrl)
			pageUrl = currentUrl
		}
		if (isRichList && accountDeepLink !== null) {
			const parts = accountDeepLink.split(':')
			const [chainId, address] = parts
			if (parts.length === 2 && chainId === selectedChainId() && /^0x[0-9a-fA-F]{40}$/.test(address ?? '')) {
				if (chainId === undefined || address === undefined) throw new Error('Account deep link is malformed')
				const item = richListRoute.items.find(candidate => candidate.chain_id === chainId && candidate.address.toLowerCase() === address.toLowerCase())
				const network = networkRenderState.latestNetworks.find(candidate => String(candidate.chain_id) === chainId)
				await openAccountTransactions(item ?? { chain_id: chainId, address, explorer_base_url: network?.explorer_base_url })
				return
			}
			currentUrl.searchParams.delete('account')
			history.replaceState(null, '', currentUrl)
			pageUrl = currentUrl
		}
	}

	for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a, .operations-nav a, .brand-block')) {
		link.addEventListener('click', event => {
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
			const target = new URL(link.href)
			const activeProductTab = link.closest('.product-nav') !== null && link.getAttribute('aria-current') === 'page'
			if (activeProductTab || target.pathname === location.pathname) {
				event.preventDefault()
				return
			}
			event.preventDefault()
			for (const name of ['log', 'account', 'contract', 'entity', 'tab', 'fromBlock', 'toBlock']) target.searchParams.delete(name)
			for (const [name, value] of new URL(location.href).searchParams) {
				if (!target.searchParams.has(name) && !['log', 'account', 'contract', 'entity', 'tab', 'fromBlock', 'toBlock'].includes(name)) target.searchParams.set(name, value)
			}
			void navigateInPlace(target)
		})
	}

	operationsRouteSelect.addEventListener('change', () => {
		const target = new URL(operationsRouteSelect.value, location.href)
		for (const [name, value] of new URL(location.href).searchParams) {
			if (!['log', 'account', 'contract', 'entity', 'tab', 'fromBlock', 'toBlock'].includes(name)) target.searchParams.set(name, value)
		}
		void navigateInPlace(target)
	})

	document.addEventListener('click', event => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		const targetElement = event.target
		if (!(targetElement instanceof Element)) return
		const link = targetElement.closest<HTMLAnchorElement>('a[href]')
		if (link === null || link.hasAttribute('download') || (link.target !== '' && link.target !== '_self')) return
		const target = new URL(link.href)
		if (target.origin !== location.origin || target.hash !== '' || target.pathname.startsWith('/api/')) return
		event.preventDefault()
		void navigateInPlace(target)
	})

	window.addEventListener('popstate', () => {
		const navigation = ++navigationGeneration
		stashOperationsRoute()
		closeEventDrawer({ clearUrl: false })
		invalidateRouteRequests()
		pageUrl = new URL(location.href)
		if (dialog.open) {
			const restoredUrl = new URL(location.href)
			closeDetail()
			history.replaceState(null, '', restoredUrl)
			pageUrl = restoredUrl
		}
		reconcileRouteNetwork()
		syncVisibleRoute()
		const restoredPosition = restoreOperationsRoute()
		hydrateVisibleRoute()
		void loadVisibleRoute().then(async () => {
			if (navigation !== navigationGeneration) return
			if (restoredPosition === undefined) focusNewRoute()
			await restoreRouteDeepLink()
		})
	})

	const initialDashboardLoad = loadVisibleRoute()

	await initialDashboardLoad

	await restoreRouteDeepLink()

	if (isDemo && pageUrl.searchParams.get('queuedPaginationDemo') === '1') window.setTimeout(() => void requestRouteRefresh(1), 100)
}
