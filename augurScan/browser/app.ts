import { short, shortIdentifier } from './identifier-format.ts'
import { requiredElementRole } from './dom-elements.ts'

import {
	type AccountDetailOptions,
	type AccountReference,
	type AccountTransaction,
	type AccountTransactionState,
	type ActivityRecord,
	type ArgumentDefinition,
	type CanonicalRecovery,
	type ChartDefinition,
	type ContractRecord,
	type DetailContextSnapshot,
	type DetailOptions,
	type DialogSnapshot,
	type EntityHistory,
	type LiveChangeOptions,
	type LiveEventPayload,
	type LoadOptions,
	type LogReference,
	type NetworkRecord,
	type OperationsCatalogSection,
	type OperationsDetailRoute,
	type OperationsRenderContext,
	type OperationsRoutePosition,
	type PagedOperationsCatalogSection,
	type PoolRecord,
	type PortfolioData,
	type ProtocolAddressLinkOptions,
	type QuestionRecord,
	type RenderEntityListOptions,
	type RichListRecord,
	type SelectEntityOptions,
	type StateCatalog,
	type StateEntity,
	type StateTab,
	type UniverseRecord,
	type VaultRecord,
} from './browser-types.ts'

import { decodeOperationsResponseValue, isJsonRecord, isRecord, operationRecords, operationsCatalogRecords, operationsRiskPagination, operationsRiskRecords, type EntityHistoryCoverageValue, type JsonRecord, type OperationsResponse } from './api-validation.ts'

import {
	accountStateDuringStagedRefresh,
	activityRefreshRetention,
	approvalTransitionFields,
	availableSessionSnapshotStorage,
	canReuseNetworkStatusPresentation,
	canonicalPageLimit,
	captureActivityDetailFocus,
	captureDisclosureState,
	classifyLiveRecords,
	collectCanonicalPages,
	collectCursorCollections,
	collectDualCursorCollections,
	compareCanonicalEventPosition,
	contractDeploymentStatus,
	contractRegistrySection,
	createForegroundRefreshGate,
	createLiveRouteRefreshCoordinator,
	createSessionSnapshotCache,
	decodedActionLabel,
	entityHistoryContinuationPresentation,
	evidenceStatusLabel,
	handleActivityDetailDrawerEscape,
	historyInvalidationEvidencePresentation,
	historyInvalidationNotice,
	historyInvalidationReasonLabel,
	indexerConnectionStatus,
	indexerHeadFreshness,
	indexerHeadFreshnessTransitionDelay,
	indexerLagLabel,
	indexerProgressEstimate,
	isCurrentCanonicalGeneration,
	isCurrentContextRequest,
	isCurrentLiveRequest,
	isHistoryInvalidationReason,
	isNoncanonicalDetailFailure,
	knownNetworkName,
	loadInitialNetworkStatus,
	mergeUniqueRecords,
	operationsCatalogRecordKey,
	operationsDetailEvidencePanelVisible,
	operationsDetailHeaderPresentation,
	operationsDetailRecordKey,
	operationsDetailSummaryPresentation,
	operationsForkChildCount,
	operationsRiskPresentation,
	operationsRouteFreshness,
	paginatedSnapshotWasReplaced,
	paginationRequestAllowed,
	placeActivityDetailDrawer,
	queuedPaginationPresentation,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	refreshPresentation,
	refreshRouteAlongsideNetworkStatus,
	resolveActivityRefreshDepth,
	restoreActivityDetailFocus,
	restoreDisclosureState,
	restoredNetworkSnapshotIsCurrent,
	retainedPaginationAvailable,
	riskPaginationForCollectedCursors,
	runSerializedOperationsLoad,
	runWithForegroundReservation,
	shouldClearPendingDetailState,
	shouldContinueTransactionRestore,
	showIndexerSyncDetails,
	summarizeHistoryCollections,
	timelineEntityTypeLabel,
	timelineOccurrenceFields,
	transactionRetryMode,
	type ContractRegistrySection,
	urlWithoutLogDetail,
	visibleActivityLogCount,
} from './live-update.ts'

import { decodeEntityHistory, decodeItemsPage, decodeNetworkResponse, decodeStateCatalog, decodeValue, isAccountTransaction, isActivityRecord, isAddressIdentity, isContractRecord, isLogDetail, isRichListRecord, requiredArrayItem } from './api-decoding.ts'

import { chartValueBounds, uniswapLiquidityChartModel, uniswapPriceChartModel, uniswapPriceProvenance } from './chart-values.ts'

import type { DemoFactory } from './demo-runtime.ts'

import { fetchApi } from './fetch-api.ts'

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

	let isSystem = location.pathname === '/system'

	let isOperations = location.pathname === '/operations' || location.pathname.startsWith('/operations/')

	let isContracts = location.pathname === '/contracts'

	let isRichList = location.pathname === '/richlist'

	let isAddress = location.pathname === '/address'

	let isActivity = !isSystem && !isOperations && !isContracts && !isRichList && !isAddress

	const initialChainId = pageUrl.searchParams.get('chainId') ?? ''

	const initialActivityFilters = {
		event: pageUrl.searchParams.get('event') ?? '',
		address: pageUrl.searchParams.get('address') ?? '',
	}

	let nextCursor: string | undefined

	let appliedActivityFilters = { ...initialActivityFilters }

	let operationsRequestVersion = 0

	const operationsLoadState: { promise?: Promise<boolean>; context?: string } = {}

	let operationsCatalogState:
		| {
				readonly chainId: string
				readonly section: PagedOperationsCatalogSection
				readonly items: readonly JsonRecord[]
		  }
		| undefined

	let operationsRiskCatalogState:
		| {
				readonly chainId: string
				readonly pools: readonly JsonRecord[]
				readonly vaults: readonly JsonRecord[]
		  }
		| undefined

	let operationsDetailState:
		| {
				readonly chainId: string
				readonly routeKey: string
				readonly items: readonly JsonRecord[]
				readonly decisionItems: readonly JsonRecord[]
				readonly riskHistoryOffset: number
		  }
		| undefined

	let demoRiskHistoryAutoLoadConsumed = false

	let demoStateHistoryAutoLoadConsumed = false

	let logsRequestVersion = 0

	let activityPaginationIntentVersion = 0

	let detailRequestVersion = 0

	let detailContextVersion = 0

	let pendingBlockUpdates = 0

	let blockRefreshTimer: number | undefined

	let headFreshnessTimer: number | undefined

	let streamHasOpened = false

	let stateData: StateCatalog | undefined

	let activeStateType: StateTab = 'pools'

	let selectedEntityKey: string | undefined

	let selectedEntityHistoryOffset = 0

	let catalogRequestVersion = 0

	let stateDetailRequestVersion = 0

	let stateDetailContextVersion = 0

	let stream: EventSource | undefined

	let networkLoadPromise: Promise<boolean> | undefined

	let networkFollowUpPromise: Promise<boolean> | undefined

	let latestNetworks: NetworkRecord[] = []

	const indexerProgressSamples = new Map<string, { indexedBlock: number; sampledAt: number; blocksPerSecond?: number }>()

	let logsAbortController: AbortController | undefined

	let serverClockOffsetMs = 0

	let networkFreshnessThresholdMs = 48_000

	let lastNetworkRequestFailed = false

	let awaitingResumedNetworkStatus = false

	let networkResumeGeneration = 0

	let activeReorgRecovery: CanonicalRecovery | undefined

	let canonicalRefreshRequired = false

	let canonicalDataGeneration = 0

	let richListItems: RichListRecord[] = []

	let richListTotal = 0

	let richListRequestVersion = 0

	let richListPaginationIntentVersion = 0

	let contractItems: ContractRecord[] = []

	let contractRequestVersion = 0

	let activeLog: ActivityRecord | undefined

	let pendingCanonicalLog: ActivityRecord | undefined

	let pendingCanonicalActivityCount: number | undefined

	let activeAccount: AccountReference | undefined

	let activeAccountTransactions: AccountTransactionState | undefined

	let activeAccountLoadMore: (() => Promise<boolean | undefined>) | undefined

	let pendingCanonicalAccount: AccountReference | undefined

	let pendingAccountDialogSnapshot: DialogSnapshot | undefined

	let preservePendingOnDialogClose = false

	let addressProfileRequestVersion = 0

	let viewContextVersion = 0

	let currentAddressProfile: RichListRecord | undefined

	let currentAddressPortfolioDepths: { readonly chainId: string; readonly address: string; readonly forks: number; readonly lp: number; readonly reports: number } | undefined

	const addressIdentityCache = new Map<string, string | false | Promise<string | undefined>>()

	let polledReorgRefreshTimer: number | undefined

	let requestRouteRefresh: (count?: number, force?: boolean) => Promise<boolean>

	const loadedRouteContexts = new Set<string>()

	const operationsRouteCache = new Map<
		string,
		{
			readonly fragment: DocumentFragment
			readonly catalogState: typeof operationsCatalogState
			readonly riskCatalogState: typeof operationsRiskCatalogState
			readonly detailState: typeof operationsDetailState
			readonly scrollY: number
			readonly focusedIndex?: number
		}
	>()

	let renderedOperationsContext: string | undefined

	let navigationGeneration = 0

	const operationsFocusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]'

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
		if (activeReorgRecovery !== undefined) {
			showCanonicalDialogStatus(activeReorgRecovery.title, activeReorgRecovery.detail)
			return
		}
		if (canonicalRefreshRequired) {
			showCanonicalDialogStatus(canonicalIncompleteTitle, canonicalIncompleteDetail)
			return
		}
		hideCanonicalDialogStatus()
	}

	const updateConnectionStatus = () => {
		if (usesDemoConnectionLabel) {
			connection.className = 'connection live'
			$('#connection-label').textContent = 'Demo fixture'
			return
		}
		const network = latestNetworks.find(item => String(item.chain_id) === selectedChainId())
		const streamState = connectionDemo === 'reconnecting' ? 'closed' : eventStreamState(stream)
		const status = indexerConnectionStatus(network, streamState, lastNetworkRequestFailed, streamHasOpened || connectionDemo === 'reconnecting')
		connection.className = `connection ${status.tone}`
		$('#connection-label').textContent = status.label
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

	const retryCanonicalViewOr = (fallback: () => Promise<boolean>): Promise<boolean> => (canonicalRefreshRequired ? requestRouteRefresh(1, true) : fallback())

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

	const eventStreamState = (stream: EventSource | undefined): 'closed' | 'connecting' | 'open' => {
		if (stream?.readyState === EventSource.OPEN) return 'open'
		return stream?.readyState === EventSource.CONNECTING || stream === undefined ? 'connecting' : 'closed'
	}

	const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
		const node = document.createElement(tag)
		if (className) node.className = className
		if (text !== undefined) node.textContent = text
		return node
	}

	const number = (value: string | number | bigint | null | undefined): string => (value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(Number(value)))

	const counted = (value: string | number | bigint | null | undefined, singular: string, plural = `${singular}s`): string => `${number(value)} ${Number(value) === 1 ? singular : plural}`

	const time = (value: string | number | Date | null | undefined) => (value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(value)) : '—')

	const age = (value: string | number | Date | null | undefined) => {
		if (!value) return 'unavailable'
		const seconds = Math.max(0, Math.floor((Date.now() + serverClockOffsetMs - new Date(value).getTime()) / 1000))
		if (seconds < 60) return `${seconds}s ago`
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
		return `${Math.floor(seconds / 86400)}d ago`
	}

	const exactTimestamp = (value: string | number | Date | null | undefined) => (value ? new Date(value).toISOString() : 'No timestamp')

	const until = (value: string | number | Date | null | undefined) => {
		if (!value) return 'time unknown'
		const seconds = Math.ceil((new Date(value).getTime() - Date.now()) / 1000)
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
			return canonicalRefreshRequired
		},
		selectedChainId: () => selectedChainId(),
	})
	const api = demo?.api ?? fetchApi

	const headFreshnessState = (stale: boolean) => (stale ? 'stale' : 'current')

	const networkBadgeLabel = (phase: string, stale: boolean, awaitingResumedNetworkStatus: boolean) => {
		if (awaitingResumedNetworkStatus) return lastNetworkRequestFailed ? 'status unavailable' : 'refreshing'
		return stale ? 'stale head' : phase
	}

	const progressCompletionLabel = (progress: { percentage: string | undefined; eta: string }) => (progress.percentage === undefined ? progress.eta : `${progress.percentage}% complete · ${progress.eta}`)

	const renderNetworks = (networks: NetworkRecord[]) => {
		const previouslySelectedNetwork = latestNetworks.find(network => String(network.chain_id) === selectedChainId())
		let selectedReorgAdvanced = false
		for (const network of networks) {
			const previous = latestNetworks.find(item => String(item.chain_id) === String(network.chain_id))
			const reorgAdvanced = previous && network.last_reorg_at && previous.last_reorg_at !== network.last_reorg_at
			if (reorgAdvanced) {
				invalidateAddressIdentityCache(network.chain_id)
				if (String(network.chain_id) === selectedChainId()) selectedReorgAdvanced = true
			} else if (previous && previous.indexed_hash !== network.indexed_hash) invalidateAddressIdentityCache(network.chain_id, true)
		}
		latestNetworks = networks
		const selectedNetwork = networks.find(item => String(item.chain_id) === selectedChainId())
		const currentTime = Date.now() + serverClockOffsetMs
		const selectedHeadFreshness = selectedNetwork === undefined ? undefined : indexerHeadFreshness(selectedNetwork, currentTime)
		const renderedNetworkCard = networkCards.querySelector<HTMLElement>('.network-card[data-live-key]')
		if (selectedReorgAdvanced && activeReorgRecovery !== undefined) activeReorgRecovery.pendingRefresh = true
		else if (selectedReorgAdvanced && polledReorgRefreshTimer === undefined) {
			const chainId = selectedChainId()
			polledReorgRefreshTimer = window.setTimeout(() => {
				polledReorgRefreshTimer = undefined
				if (selectedChainId() === chainId && activeReorgRecovery === undefined) void refreshCanonicalViews('Canonical history reset detected', 'Address identities and views are refreshing from the latest data.')
			}, 0)
		}
		if (
			!awaitingResumedNetworkStatus &&
			previouslySelectedNetwork !== undefined &&
			selectedNetwork !== undefined &&
			selectedHeadFreshness !== undefined &&
			canReuseNetworkStatusPresentation(previouslySelectedNetwork, selectedNetwork, renderedNetworkCard?.dataset.liveKey, renderedNetworkCard?.dataset.headFreshness, String(selectedNetwork.chain_id), selectedHeadFreshness.stale ? 'stale' : 'current')
		) {
			networkCards.setAttribute('aria-busy', 'false')
			updateConnectionStatus()
			return
		}
		networkCards.classList.remove('empty')
		networkCards.replaceChildren()
		for (const network of selectedNetwork === undefined ? [] : [selectedNetwork]) {
			const headFreshness = indexerHeadFreshness(network, currentTime)
			const progress = indexerProgressEstimate(network, indexerProgressSamples.get(String(network.chain_id)), currentTime)
			if (progress.sample !== undefined) indexerProgressSamples.set(String(network.chain_id), progress.sample)
			const card = setLiveRecord(element('article', 'network-card'), String(network.chain_id), {
				indexedBlock: network.indexed_block,
				indexedHash: network.indexed_hash,
				indexedTimestamp: network.indexed_timestamp,
				observedBlock: network.observed_block,
				phase: network.phase,
				failures: network.consecutive_failures,
			})
			card.dataset.phase = network.phase
			card.dataset.headFreshness = awaitingResumedNetworkStatus ? 'refreshing' : headFreshnessState(headFreshness.stale)
			const title = element('div', 'network-title')
			const badge = element('span', 'badge', networkBadgeLabel(network.phase, headFreshness.stale, awaitingResumedNetworkStatus))
			title.append(badge)
			const block = element(network.indexed_block && network.explorer_base_url ? 'a' : 'p', 'block-number', network.indexed_block ? `#${number(network.indexed_block)}` : 'Awaiting first block')
			if (block instanceof HTMLAnchorElement) {
				block.href = `${String(network.explorer_base_url).replace(/\/$/, '')}/block/${network.indexed_block}`
				block.target = '_blank'
				block.rel = 'noreferrer'
				block.title = `Open block ${network.indexed_block} in the network explorer`
			}
			const meta = element('div', 'block-meta')
			const indexedTime = element('time', '', network.indexed_timestamp ? `${exactTimestamp(network.indexed_timestamp).slice(0, 10)} · ${time(network.indexed_timestamp)} UTC` : 'No timestamp')
			if (network.indexed_timestamp) indexedTime.dateTime = exactTimestamp(network.indexed_timestamp)
			indexedTime.title = exactTimestamp(network.indexed_timestamp)
			const ageNode = element('span', 'age', age(network.indexed_timestamp))
			ageNode.dataset.time = network.indexed_timestamp ?? ''
			ageNode.title = exactTimestamp(network.indexed_timestamp)
			const lag = indexerLagLabel(network)
			const displaySyncDetails = showIndexerSyncDetails(network, currentTime)
			meta.append(indexedTime, ageNode)
			if (displaySyncDetails) meta.append(element('span', '', lag))
			const progressLabel = headFreshness.stale ? `${progress.percentage ?? '100.00'}% indexed · RPC head ${age(network.indexed_timestamp).replace(/ ago$/, '')} old (limit 1m)` : progressCompletionLabel(progress)
			title.prepend(block)
			card.append(title, meta)
			if (displaySyncDetails && !awaitingResumedNetworkStatus) card.append(element('p', 'network-progress', progressLabel))
			if (Number(network.consecutive_failures) > 0) {
				const retry = network.next_retry_at ? `next retry ${until(network.next_retry_at)}` : 'retry scheduled'
				card.append(element('p', 'network-retry', `${number(network.consecutive_failures)} consecutive failures · ${retry}`))
			}
			if (network.last_error) card.append(element('p', 'network-error', network.last_error))
			networkCards.append(card)
		}
		if (headFreshnessTimer !== undefined) clearTimeout(headFreshnessTimer)
		headFreshnessTimer = undefined
		if (selectedNetwork !== undefined) {
			const transitionDelay = indexerHeadFreshnessTransitionDelay(selectedNetwork, currentTime)
			if (transitionDelay !== undefined) {
				headFreshnessTimer = window.setTimeout(
					() => {
						headFreshnessTimer = undefined
						renderNetworks(latestNetworks)
						updateFreshness()
					},
					Math.min(transitionDelay, 2_147_483_647),
				)
			}
		}
		networkCards.setAttribute('aria-busy', String(awaitingResumedNetworkStatus && !lastNetworkRequestFailed))
		updateConnectionStatus()
	}

	const updateFreshness = () => {
		if (activeReorgRecovery !== undefined) return
		delete $('#freshness-banner').dataset.status
		if (canonicalRefreshRequired) {
			const banner = $('#freshness-banner')
			banner.hidden = false
			$('#freshness-title').textContent = 'Chain update refresh incomplete'
			$('#freshness-detail').textContent = 'A chain update was recorded, but the content refresh failed. Retrying automatically.'
			return
		}
		if (awaitingResumedNetworkStatus) {
			$('#freshness-banner').dataset.status = lastNetworkRequestFailed ? 'failed' : 'refreshing'
			$('#freshness-banner').hidden = false
			$('#freshness-title').textContent = lastNetworkRequestFailed ? 'Unable to refresh status' : 'Refreshing status…'
			$('#freshness-detail').textContent = lastNetworkRequestFailed ? 'Retrying automatically.' : ''
			return
		}
		if (lastNetworkRequestFailed) {
			$('#freshness-banner').hidden = true
			return
		}
		const staleHead = latestNetworks.filter(network => String(network.chain_id) === selectedChainId()).find(network => indexerHeadFreshness(network, Date.now() + serverClockOffsetMs).stale)
		if (staleHead !== undefined) {
			const banner = $('#freshness-banner')
			banner.hidden = false
			$('#freshness-title').textContent = 'RPC chain head is stale'
			$('#freshness-detail').textContent = `Newest observed block is ${age(staleHead.indexed_timestamp)}; block-based catch-up status may be misleading.`
			return
		}
		const stale = latestNetworks.filter(network => String(network.chain_id) === selectedChainId()).filter(network => !network.last_success_at || Date.now() + serverClockOffsetMs - new Date(network.last_success_at).getTime() > networkFreshnessThresholdMs)
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
		canonicalRefreshRequired = false
		pendingCanonicalActivityCount = undefined
		if (isActivity) {
			$('#more').hidden = nextCursor === undefined
			$('#more').disabled = false
		}
		if (isRichList) {
			$('#richlist-more').hidden = richListItems.length >= richListTotal
			$('#richlist-more').disabled = false
		}
		const accountMore = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
		if (accountMore !== null && activeAccountTransactions !== undefined) {
			accountMore.hidden = activeAccountTransactions.nextPageCursor === undefined || (activeAccountTransactions.pageError !== undefined && activeAccountTransactions.pageErrorAppend)
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

	const decodeOperationsResponse = decodeOperationsResponseValue

	const operationsCatalogSection = (): OperationsCatalogSection | undefined => {
		const section = location.pathname.split('/')[2]
		return section === 'reports' || section === 'escalations' || section === 'auctions' || section === 'forks' || section === 'trading' || section === 'timeline' || section === 'integrity' || section === 'risk' ? section : undefined
	}

	const operationsCatalogEndpoint = (section: PagedOperationsCatalogSection, cursor?: string, limit = 100): string => {
		const query = new URLSearchParams({ chainId: requiredChainId(), limit: String(limit) })
		if (section === 'timeline')
			for (const parameter of ['q', 'entityType', 'event', 'address', 'fromBlock', 'toBlock', 'canonical'] as const) {
				const value = pageUrl.searchParams.get(parameter)
				if (value !== null && value !== '') query.set(parameter, value)
			}
		if (cursor !== undefined) query.set('cursor', cursor)
		return `/api/v1/state/${section}?${query.toString()}`
	}

	const operationsRiskCatalogEndpoint = (poolCursor?: string, vaultCursor?: string, limit = 100): string => {
		const query = new URLSearchParams({ chainId: requiredChainId(), limit: String(limit) })
		const atBlock = pageUrl.searchParams.get('atBlock')
		if (atBlock !== null && atBlock !== '') query.set('atBlock', atBlock)
		if (poolCursor !== undefined) query.set('poolCursor', poolCursor)
		if (vaultCursor !== undefined) query.set('vaultCursor', vaultCursor)
		return `/api/v1/state/risk?${query.toString()}`
	}

	const catalogOperationsResponse = (response: OperationsResponse, section: PagedOperationsCatalogSection, items: readonly JsonRecord[]): OperationsResponse => ({
		...response,
		data: { ...response.data, [section]: items, _catalogPage: response.data },
	})

	const riskCatalogOperationsResponse = (response: OperationsResponse, pools: readonly JsonRecord[], vaults: readonly JsonRecord[]): OperationsResponse => ({
		...response,
		data: {
			risk: { ...response.data, pools, vaults },
			_riskCatalogPage: response.data,
			totals: {
				pools: isJsonRecord(response.data['pagination']) && typeof response.data['pagination']['poolTotal'] === 'number' ? response.data['pagination']['poolTotal'] : pools.length,
				vaults: isJsonRecord(response.data['pagination']) && typeof response.data['pagination']['vaultTotal'] === 'number' ? response.data['pagination']['vaultTotal'] : vaults.length,
			},
		},
	})

	const approvalTransitionSummary = (item: Readonly<Record<string, unknown>>): string => {
		const eventData = isRecord(item['event_data']) ? item['event_data'] : {}
		const receiver = String(item['receiver_vault'] ?? eventData['receiverVault'] ?? '')
		const operation = typeof eventData['operationId'] === 'string' ? `operation ${shortIdentifier(eventData['operationId'])}` : undefined
		const fields = approvalTransitionFields(eventData).map(field => `${field.label} ${operationNumber(field.value)}${field.unit === '' ? '' : ` ${field.unit}`}`)
		const details = [operation, ...fields, receiver === '' ? undefined : `receiver ${shortIdentifier(receiver, 10, 6)}`].filter((value): value is string => value !== undefined)
		return details.length === 0 ? 'Authorization lifecycle transition' : details.join(' · ')
	}

	const captureOperationsRenderContext = (): OperationsRenderContext => {
		const content = $('#operations-content')
		const active = document.activeElement
		return {
			...(active instanceof HTMLAnchorElement && content.contains(active) ? { focusHref: active.href } : {}),
			focusLoadMore: active instanceof HTMLElement && (active.classList.contains('operations-catalog-more') || active.classList.contains('operations-detail-more') || active.classList.contains('operations-pagination-complete')),
			...(active instanceof HTMLElement && (active.dataset['detailCollection'] === 'decisions' || active.dataset['detailCollection'] === 'evidence') ? { focusDetailCollection: active.dataset['detailCollection'] } : {}),
			...(active instanceof HTMLElement && (active.dataset['riskKind'] === 'pool' || active.dataset['riskKind'] === 'vault') ? { focusRiskKind: active.dataset['riskKind'] } : {}),
			focusHistoryMore: active instanceof HTMLElement && (active.classList.contains('operations-history-more') || active.classList.contains('operations-history-complete')),
			...(active instanceof HTMLElement && content.contains(active) ? { focusViewportTop: active.getBoundingClientRect().top } : {}),
			scrollY: window.scrollY,
		}
	}

	const restoreOperationsRenderContext = (snapshot: OperationsRenderContext) => {
		const content = $('#operations-content')
		const continuation = snapshot.focusDetailCollection === undefined ? content.querySelector<HTMLButtonElement>('.operations-catalog-more, .operations-detail-more') : content.querySelector<HTMLButtonElement>(`[data-detail-collection="${snapshot.focusDetailCollection}"]`)
		const completion = content.querySelector<HTMLElement>('.operations-pagination-complete')
		const historyContinuation = content.querySelector<HTMLButtonElement>('.operations-history-more')
		const historyCompletion = content.querySelector<HTMLElement>('.operations-history-complete')
		const catalogRows = [...content.querySelectorAll<HTMLAnchorElement>('a.operations-row')]
		const riskTarget = snapshot.focusRiskKind === undefined ? undefined : content.querySelector<HTMLElement>(`[data-risk-kind="${snapshot.focusRiskKind}"]`)
		const focusTarget = () => {
			if (snapshot.focusHref !== undefined) return catalogRows.find(candidate => candidate.href === snapshot.focusHref)
			if (snapshot.focusHistoryMore) return historyContinuation ?? historyCompletion
			return snapshot.focusLoadMore ? (continuation ?? completion ?? catalogRows.at(-1)) : undefined
		}
		const target = riskTarget ?? focusTarget()
		window.scrollTo({ top: snapshot.scrollY, behavior: 'auto' })
		if (target === undefined || target === null) return
		target.focus({ preventScroll: true })
		if (snapshot.focusViewportTop !== undefined) {
			window.scrollBy({ top: target.getBoundingClientRect().top - snapshot.focusViewportTop, behavior: 'auto' })
			target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		}
	}

	const operationNumber = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? number(value) : number(undefined))

	const operationCounted = (value: unknown, singular: string, plural?: string): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? counted(value, singular, plural) : counted(undefined, singular, plural))

	const operationRatio = (numerator: unknown, denominator: unknown, maximumFraction = 4): string => {
		if (typeof numerator !== 'string' || typeof denominator !== 'string' || !/^\d+$/.test(numerator) || !/^\d+$/.test(denominator) || denominator === '0') return 'Unavailable'
		const scale = 10n ** BigInt(maximumFraction)
		return exactUnit((BigInt(numerator) * scale) / BigInt(denominator), maximumFraction, '', maximumFraction)
	}

	const operationsHref = (pathname: string): string => {
		const destination = new URL(pathname, location.origin)
		const chainId = selectedChainId()
		if (chainId !== '') destination.searchParams.set('chainId', chainId)
		if (isDemo) destination.searchParams.set('demo', '1')
		const atBlock = pageUrl.searchParams.get('atBlock')
		if (atBlock !== null && destination.pathname.startsWith('/operations/risk')) destination.searchParams.set('atBlock', atBlock)
		return `${destination.pathname}${destination.search}`
	}

	const operationCard = (label: string, value: string, detail?: string) => {
		const card = element('div', 'operations-card')
		card.append(element('span', '', label), element('strong', '', value))
		if (detail !== undefined) card.append(element('small', '', detail))
		return card
	}

	const operationRow = (title: string, status: string, identity: string | undefined, block: unknown, href?: string) => {
		const row = href === undefined ? element('div', 'operations-row') : document.createElement('a')
		row.className = 'operations-row'
		if (row instanceof HTMLAnchorElement && href !== undefined) row.href = href
		const copy = element('div')
		copy.append(element('strong', '', title), element('span', '', status))
		if (identity !== undefined && identity !== '') copy.append(element('code', '', shortIdentifier(identity, 12, 8)))
		row.append(copy)
		if (typeof block === 'string' || typeof block === 'number') {
			const evidence = element('div', 'operations-evidence')
			evidence.append(element('small', '', `Block #${number(block)}`))
			row.append(evidence)
		}
		return row
	}

	const exactEvidenceRow = (title: string, status: string, fields: ReadonlyArray<readonly [label: string, value: unknown]>, block?: unknown): HTMLElement => {
		const row = operationRow(title, status, undefined, block)
		const evidence = element('dl', 'operations-exact-evidence')
		for (const [label, value] of fields) {
			const field = element('div')
			const rendered = value === undefined || value === null || value === '' ? 'Not recorded' : String(value)
			field.append(element('dt', '', label), element('dd', '', rendered))
			evidence.append(field)
		}
		row.append(evidence)
		return row
	}

	const operationsPanel = (title: string, rows: HTMLElement[], empty: string, scope?: { readonly label: string; readonly scannerWide?: boolean }) => {
		const panel = element('section', 'operations-panel')
		if (scope?.scannerWide === true) panel.classList.add('operations-panel-scanner-wide')
		panel.append(element('h3', '', title))
		if (scope !== undefined) panel.append(element('p', 'operations-panel-scope', scope.label))
		const list = element('div', 'operations-list')
		list.append(...(rows.length === 0 ? [element('div', 'state-placeholder', empty)] : rows))
		panel.append(list)
		return panel
	}

	const operationsTimelineFilters = (): HTMLFormElement => {
		const form = document.createElement('form')
		form.className = 'filters operations-filters'
		form.method = 'get'
		form.action = '/operations/timeline'
		form.setAttribute('role', 'search')
		const field = (label: string, name: string, placeholder: string, inputMode?: 'numeric') => {
			const wrapper = document.createElement('label')
			const input = document.createElement('input')
			input.type = 'search'
			input.name = name
			input.placeholder = placeholder
			input.value = pageUrl.searchParams.get(name) ?? ''
			if (inputMode !== undefined) input.inputMode = inputMode
			wrapper.append(element('span', '', label), input)
			return wrapper
		}
		const canonicalLabel = document.createElement('label')
		const canonical = document.createElement('select')
		canonical.name = 'canonical'
		canonical.append(new Option('Canonical only', 'canonical'), new Option('Canonical and superseded', 'all'))
		canonical.value = pageUrl.searchParams.get('canonical') === 'all' ? 'all' : 'canonical'
		canonicalLabel.append(element('span', '', 'Evidence'), canonical)
		for (const [name, value] of [['chainId', requiredChainId()], ...(isDemo ? [['demo', '1']] : [])] as const) {
			const input = document.createElement('input')
			input.type = 'hidden'
			input.name = name
			input.value = value
			form.append(input)
		}
		const submit = element('button', 'primary', 'Apply filters')
		submit.setAttribute('type', 'submit')
		const clear = document.createElement('a')
		clear.className = 'secondary button-link'
		clear.href = operationsHref('/operations/timeline')
		clear.textContent = 'Clear filters'
		const actions = element('div', 'operations-filter-actions')
		actions.append(submit, clear)
		form.append(
			field('Search', 'q', 'Event, entity, or evidence…'),
			field('Entity type', 'entityType', 'fork, vault, amm…'),
			field('Event', 'event', 'ReportDisputed…'),
			field('Address', 'address', '0x…'),
			field('From block', 'fromBlock', '0', 'numeric'),
			field('To block', 'toBlock', 'Latest', 'numeric'),
			canonicalLabel,
			actions,
		)
		return form
	}

	const operationsRiskSnapshotFilter = (): HTMLFormElement => {
		const form = document.createElement('form')
		form.className = 'filters operations-filters operations-as-of-filter'
		form.method = 'get'
		form.action = '/operations/risk'
		const label = document.createElement('label')
		const input = document.createElement('input')
		input.type = 'search'
		input.inputMode = 'numeric'
		input.name = 'atBlock'
		input.placeholder = 'Latest available block'
		input.value = pageUrl.searchParams.get('atBlock') ?? ''
		label.append(element('span', '', 'State at block'), input)
		for (const [name, value] of [['chainId', requiredChainId()], ...(isDemo ? [['demo', '1']] : [])] as const) {
			const hidden = document.createElement('input')
			hidden.type = 'hidden'
			hidden.name = name
			hidden.value = value
			form.append(hidden)
		}
		const submit = element('button', 'primary', 'View snapshot')
		submit.setAttribute('type', 'submit')
		const latest = document.createElement('a')
		latest.className = 'secondary button-link'
		const latestDestination = new URL(operationsHref('/operations/risk'), location.origin)
		latestDestination.searchParams.delete('atBlock')
		latest.href = `${latestDestination.pathname}${latestDestination.search}`
		latest.textContent = 'Latest state'
		form.append(label, submit, latest)
		return form
	}

	const renderOperations = (response: OperationsResponse, preservedContext?: OperationsRenderContext) => {
		const content = $('#operations-content')
		const renderContext = preservedContext ?? captureOperationsRenderContext()
		const { asOf, data } = response
		const selected = location.pathname.split('/')[2] ?? 'overview'
		const reports = operationsCatalogRecords('reports', data['reports'])
		const escalations = operationsCatalogRecords('escalations', data['escalations'])
		const auctions = operationsCatalogRecords('auctions', data['auctions'])
		const forks = operationsCatalogRecords('forks', data['forks'])
		const changes = operationRecords(data['recentChanges'])
		const prices = operationRecords(data['prices'])
		const trading = operationsCatalogRecords('trading', data['trading'])
		const timeline = operationsCatalogRecords('timeline', data['timeline'])
		const integrity = operationsCatalogRecords('integrity', data['integrity'])
		const selectedCatalogPage = isRecord(data['_catalogPage']) ? data['_catalogPage'] : undefined
		const totals = isRecord(data['totals']) ? data['totals'] : {}
		const selectedNetwork = latestNetworks.find(network => String(network.chain_id) === requiredChainId())
		const selectedNetworkScope = `Selected network · ${selectedNetwork?.name ?? `chain ${requiredChainId()}`} · chain ${requiredChainId()}`
		const riskValue = data['risk']
		const historical = asOf['historical'] === true || asOf['phase'] === 'historical'
		if (riskValue !== undefined && !isRecord(riskValue)) throw new Error('Operations risk is malformed')
		const risk = isRecord(riskValue) ? riskValue : {}
		const riskPagination = operationsRiskPagination(risk['pagination'], riskValue !== undefined)
		const pools = operationsRiskRecords('pools', risk['pools'])
		const vaults = operationsRiskRecords('vaults', risk['vaults'])
		const approvals = operationRecords(risk['approvalEvents']).sort(compareCanonicalEventPosition)
		const recentLiquidations = operationRecords(risk['recentLiquidations'])
		const freshness = element('div', 'operations-freshness')
		freshness.append(
			operationCard('Latest block', `#${number(typeof asOf['blockNumber'] === 'string' ? asOf['blockNumber'] : undefined)}`, shortIdentifier(String(asOf['blockHash'] ?? 'Unavailable'))),
			operationCard('Observed head', `#${number(typeof asOf['observedHead'] === 'string' ? asOf['observedHead'] : undefined)}`),
			operationCard('Block lag', number(typeof asOf['lagBlocks'] === 'string' ? asOf['lagBlocks'] : undefined), String(asOf['phase'] ?? 'Unavailable')),
			operationCard('Block timestamp', asOf['blockTimestamp'] === undefined ? 'Unavailable' : exactTimestamp(Number(asOf['blockTimestamp']) * 1_000).replace('.000Z', 'Z')),
		)
		const metrics = element('div', 'operations-metrics')
		metrics.append(
			operationCard('OpenOracle reports', operationNumber(totals['reports'] ?? reports.length), counted(reports.filter(item => isRecord(item['lifecycle']) && item['lifecycle']['state'] === 'Settleable').length, 'settleable')),
			operationCard('Escalation games', operationNumber(totals['escalations'] ?? escalations.length), 'Canonical event projections'),
			operationCard('Truth auctions', operationNumber(totals['auctions'] ?? auctions.length), counted(auctions.filter(item => item['status'] === 'Open').length, 'open')),
			operationCard('Pool / vault snapshots', `${operationNumber(totals['pools'] ?? pools.length)} / ${operationNumber(totals['vaults'] ?? vaults.length)}`, 'Latest canonical accounting'),
		)
		const reportRows = reports.map(item => {
			const lifecycle = isRecord(item['lifecycle']) ? item['lifecycle'] : {}
			const reportData = isRecord(item['report_data']) ? item['report_data'] : {}
			return operationRow(
				`Report ${String(item['report_id'] ?? '—')}`,
				`${String(lifecycle['state'] ?? 'Awaiting indexed evidence')} · ${operationCounted(item['observed_rounds'], 'round')} · ${String(reportData['token1'] ?? 'token 1')} / ${String(reportData['token2'] ?? 'token 2')}`,
				`${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`,
				item['block_number'],
				operationsHref(`/operations/report/${encodeURIComponent(String(item['open_oracle_address'] ?? ''))}/${encodeURIComponent(String(item['report_id'] ?? ''))}`),
			)
		})
		const escalationRows = escalations.map(item =>
			operationRow(
				'Escalation game',
				`${String(item['event_name'] ?? 'Active')} · INVALID ${operationNumber(item['invalid_stake_atto_rep'])} · NO ${operationNumber(item['no_stake_atto_rep'])} · YES ${operationNumber(item['yes_stake_atto_rep'])} attoREP`,
				String(item['game_address'] ?? ''),
				item['block_number'],
				operationsHref(`/operations/escalation/${encodeURIComponent(String(item['game_address'] ?? ''))}`),
			),
		)
		const auctionRows = auctions.map(item =>
			operationRow(
				'Truth auction',
				`${String(item['status'] ?? 'Awaiting indexed evidence')} · ${operationCounted(item['bid_count'], 'bid')} · ${operationCounted(item['bidder_count'], 'bidder')}`,
				String(item['auction_address'] ?? ''),
				item['block_number'],
				operationsHref(`/operations/auction/${encodeURIComponent(String(item['auction_address'] ?? ''))}`),
			),
		)
		const poolRiskRows = pools.map(item => {
			const capacity = isRecord(item['capacity']) ? item['capacity'] : {}
			const riskPresentation = operationsRiskPresentation('pool', item['protocol_state'], item['scanner_severity'])
			return operationRow(
				'Pool accounting',
				`${riskPresentation.scannerAssessment} · ${operationNumber(capacity['utilizationBps'])} bps utilized · ${String(item['scanner_reason'] ?? '')}`,
				String(item['pool_address'] ?? ''),
				item['block_number'],
				operationsHref(`/operations/risk/pool/${encodeURIComponent(String(item['pool_address'] ?? ''))}`),
			)
		})
		const vaultRiskRows = vaults.map(item => {
			const itemRisk = isRecord(item['risk']) ? item['risk'] : {}
			const riskPresentation = operationsRiskPresentation('vault', item['protocol_state'], item['scanner_severity'])
			return operationRow(
				'Vault position',
				`${riskPresentation.scannerAssessment} · health ${operationNumber(itemRisk['healthFactorBps'])} bps · ${String(item['scanner_reason'] ?? '')}`,
				String(item['vault_address'] ?? ''),
				item['block_number'],
				operationsHref(`/operations/risk/vault/${encodeURIComponent(String(item['pool_address'] ?? ''))}/${encodeURIComponent(String(item['vault_address'] ?? ''))}`),
			)
		})
		const riskRows = [...poolRiskRows, ...vaultRiskRows]
		const approvalRows = approvals.map(item => operationRow(String(item['event_name'] ?? 'Liquidation approval'), approvalTransitionSummary(item), String(item['approval_identity'] ?? item['receiver_vault'] ?? ''), item['block_number']))
		const liquidationRows = recentLiquidations.map(item => operationRow('Vault liquidation', 'Canonical liquidation route and resulting debt evidence', String(item['entity_identity'] ?? item['source_contract'] ?? ''), item['block_number']))
		const tradingRows = trading.map(item =>
			operationRow(
				String(item['question_title'] ?? 'Augur AMM market'),
				`${item['conditional_yes_bps'] === null || item['conditional_yes_bps'] === undefined ? 'No reserve price' : `${exactUnit(String(item['conditional_yes_bps']), 2, '%', 2)} YES`} · ${operationCounted(item['swap_count'], 'swap')} · ${operationCounted(item['lp_holder_count'], 'LP participant')}`,
				String(item['pair_address'] ?? ''),
				item['price_block_number'],
				operationsHref(`/operations/trading/${encodeURIComponent(String(item['pair_address'] ?? ''))}`),
			),
		)
		const timelineRows = timeline.map(item => {
			const rawEvidenceStatus = item['evidence_status'] ?? (item['canonical'] === false ? 'noncanonical' : 'canonical')
			const invalidation = item['invalidation_reason'] === undefined ? '' : ` · ${historyInvalidationReasonLabel(item['invalidation_reason'])}`
			return exactEvidenceRow(String(item['semantic_event_kind'] ?? 'Protocol transition'), `${timelineEntityTypeLabel(item['entity_type'])} · ${evidenceStatusLabel(rawEvidenceStatus)}${invalidation}`, [
				...timelineOccurrenceFields(item),
				['Evidence status code', rawEvidenceStatus],
				['Invalidation reason code', item['invalidation_reason']],
			])
		})
		const integrityRows = integrity.map(item => {
			const evidence = historyInvalidationEvidencePresentation(item['causes'], item['occurrence_counts'])
			const primaryReason = String(item['reason'] ?? '')
			const primaryReasonLabel = historyInvalidationReasonLabel(primaryReason)
			const causeSummary = evidence.causeCodes.length === 1 && evidence.causeCodes[0] === primaryReason ? '' : ` · ${evidence.causeLabel}`
			return exactEvidenceRow(
				primaryReasonLabel,
				`${operationCounted(item['depth'], 'replaced block')} · ${operationCounted(evidence.occurrenceTotal, 'affected occurrence')}${causeSummary}`,
				[
					['Primary invalidation reason code', item['reason']],
					['Complete cause set', evidence.causeCodes.join(', ')],
					...evidence.occurrenceFields,
					['Invalidating indexer run', item['indexer_run_id']],
					['Invalidating ABI source hash', item['abi_source_hash']],
					['Invalidating application source hash', item['application_source_hash']],
					['Invalidating projection source hash', item['projection_source_hash']],
					['Previous block hash', item['previous_hash']],
					['Ancestor block hash', item['ancestor_hash']],
					['Detected at', item['detected_at']],
				],
				item['previous_block'],
			)
		})
		const forkRows = forks.map(item =>
			operationRow(
				`Universe ${String(item['universe_identity'] ?? '—')} fork`,
				`${operationsForkChildCount(operationNumber(item['child_count']), item['child_count'])} · ${operationCounted(item['migrator_count'], 'migrator')} · ${exactUnit(String(item['migrated_atto_rep'] ?? '0'), 18, 'REP', 3)} migrated · ${operationCounted(item['obligation_events'], 'escalation obligation')}`,
				undefined,
				item['block_number'],
				operationsHref(`/operations/fork/${encodeURIComponent(String(item['universe_identity'] ?? ''))}`),
			),
		)
		const changeRows = changes.map(item => operationRow(String(item['semantic_event_kind'] ?? 'Protocol transition'), 'Canonical semantic evidence', String(item['entity_identity'] ?? ''), item['block_number']))
		const priceRows = prices.map(item => operationRow('Coordinator REP / ETH', `${operationNumber(item['value'])} scaled 1e18 · ${String(item['source_event'] ?? 'Unavailable')}`, String(item['source_contract'] ?? ''), item['block_number']))
		const attentionReportRows: HTMLElement[] = []
		for (const [index, item] of reports.entries()) {
			const lifecycle = isRecord(item['lifecycle']) ? item['lifecycle'] : {}
			const row = reportRows[index]
			if ((lifecycle['state'] === 'Dispute window open' || lifecycle['state'] === 'Settleable') && row !== undefined) attentionReportRows.push(row)
		}
		const concludedEscalationEvents = new Set(['NonDecisionReached', 'GameContinuedFromFork', 'InheritedThresholdTie'])
		const activeEscalationRows: HTMLElement[] = []
		for (const [index, item] of escalations.entries()) {
			const row = escalationRows[index]
			if (!concludedEscalationEvents.has(String(item['event_name'] ?? '')) && row !== undefined) activeEscalationRows.push(row)
		}
		const activeAuctionRows: HTMLElement[] = []
		for (const [index, item] of auctions.entries()) {
			const row = auctionRows[index]
			if (['Open', 'Awaiting finalization', 'Bid settlements outstanding'].includes(String(item['status'] ?? '')) && row !== undefined) activeAuctionRows.push(row)
		}
		const riskPoolPanel = operationsPanel('Pool risk evidence', poolRiskRows, 'No pool accounting snapshots match this view.', {
			label: `${operationCounted(pools.length, 'pool')} shown · ${operationCounted(riskPagination['poolTotal'], 'pool')} total`,
		})
		const riskVaultPanel = operationsPanel('Vault risk evidence', vaultRiskRows, 'No vault accounting snapshots match this view.', {
			label: `${operationCounted(vaults.length, 'vault')} shown · ${operationCounted(riskPagination['vaultTotal'], 'vault')} total`,
		})
		const sectionPanels = new Map<string, () => HTMLElement[]>([
			['reports', () => [operationsPanel('OpenOracle reports', reportRows, 'No reports match this view.')]],
			['escalations', () => [operationsPanel('Escalation games', escalationRows, 'No escalation games match this view.')]],
			['auctions', () => [operationsPanel('Truth auctions', auctionRows, 'No auctions match this view.')]],
			['risk', () => [riskPoolPanel, riskVaultPanel, operationsPanel('Liquidation approval lifecycle', approvalRows, 'No liquidation approvals match this view.'), operationsPanel('Recent liquidations', liquidationRows, 'No vault liquidations match this view.')]],
			['trading', () => [operationsPanel('Augur AMM markets', tradingRows, 'No Augur AMM markets match this view.')]],
			[
				'timeline',
				() => [
					operationsPanel('Cross-protocol historical timeline', timelineRows, 'No semantic evidence matches these filters.', {
						label: `${operationCounted(selectedCatalogPage?.['total'], 'matching transition')} · canonical status and invalidation provenance included`,
					}),
				],
			],
			[
				'forks',
				() => [
					operationsPanel('Zoltar forks and migration progress', forkRows, 'No universe forks match this view.', {
						label: `${operationCounted(forkRows.length, 'fork')} shown · ${operationCounted(selectedCatalogPage?.['total'], 'fork')} total`,
					}),
				],
			],
			[
				'integrity',
				() => [
					operationsPanel('Selected-chain replacements', integrityRows, 'No chain reorganizations have been recorded.', {
						label: selectedNetworkScope,
					}),
					operationsPanel(
						'Scanner-wide schema migration history',
						operationRecords(data['migrations']).map(item => exactEvidenceRow(`Schema ${String(item['schema_version'] ?? '')}`, String(item['description'] ?? ''), [['Applied at', item['applied_at']]])),
						'No migration records are available.',
						{ label: 'Scanner-wide · all configured networks', scannerWide: true },
					),
					operationsPanel(
						'Scanner-wide indexer provenance',
						operationRecords(data['runs']).map(item =>
							exactEvidenceRow(`augurScan ${String(item['app_version'] ?? '')}`, `Schema ${String(item['schema_version'] ?? '')} · process run ${String(item['id'] ?? 'not recorded')}`, [
								['ABI source hash', item['abi_source_hash']],
								['Application source hash', item['application_source_hash']],
								['Projection source hash', item['projection_source_hash']],
								['Indexer enabled', item['indexer_enabled']],
								['Started at', item['started_at']],
								['Stopped at', item['stopped_at']],
							]),
						),
						'No indexer-run provenance is available.',
						{ label: 'Scanner-wide · latest 25 process runs across all networks', scannerWide: true },
					),
					operationsPanel(
						'Selected-chain historical exports',
						[
							operationRow('Export semantic timeline', 'Snapshot-bound canonical NDJSON with exact event data; response headers identify an opaque continuation cursor.', undefined, undefined, operationsHref('/api/v1/export?dataset=timeline&canonical=canonical&limit=50000')),
							operationRow('Export canonical and orphan logs', 'Occurrence-level NDJSON including decoded arguments and canonical flags.', undefined, undefined, operationsHref('/api/v1/export?dataset=logs&canonical=all&limit=50000')),
						],
						'',
						{ label: selectedNetworkScope },
					),
				],
			],
		])
		const panels = sectionPanels.get(selected)?.() ?? [
			operationsPanel('Needs attention · reports', attentionReportRows.slice(0, 5), 'No reports need attention.'),
			operationsPanel('Active escalations', activeEscalationRows, 'No escalation games are active.'),
			operationsPanel('Active auctions', activeAuctionRows, 'No auctions are active.'),
			operationsPanel('Pool and vault risk', riskRows, 'No risk snapshots are available.'),
			operationsPanel('Fork and migration progress', forkRows, 'No forks or migrations match this view.'),
			operationsPanel('Price provenance', priceRows, 'No accepted coordinator price is available.'),
			operationsPanel('Recent semantic changes', changeRows, 'No changes match this view.'),
		]
		const grid = element('div', panels.length === 1 ? 'operations-grid operations-grid-single' : 'operations-grid')
		grid.append(...panels)
		const riskCatalogPage = isRecord(data['_riskCatalogPage']) ? data['_riskCatalogPage'] : undefined
		if (selected === 'risk' && riskCatalogPage !== undefined) {
			operationsRiskCatalogState = { chainId: requiredChainId(), pools, vaults }
			const appendRiskPagination = (kind: 'pool' | 'vault', panel: HTMLElement, loadedCount: number, hasMore: boolean, nextCursor: unknown) => {
				if (hasMore && typeof nextCursor === 'string') {
					const button = element('button', 'secondary operations-catalog-more', `Show more ${kind === 'pool' ? 'pools' : 'vaults'}`)
					button.type = 'button'
					button.dataset['riskKind'] = kind
					button.setAttribute('aria-label', `Show more ${kind} risk records`)
					const status = element('p', 'activity-summary')
					status.setAttribute('role', 'status')
					status.setAttribute('aria-live', 'polite')
					button.addEventListener('click', async () => {
						const paginationContext = captureOperationsRenderContext()
						button.disabled = true
						button.setAttribute('aria-busy', 'true')
						button.textContent = `Showing more ${kind === 'pool' ? 'pools' : 'vaults'}…`
						status.textContent = `Loading older ${kind} risk records…`
						status.classList.add('sr-only')
						const loaded = await loadOperations({
							live: true,
							...(kind === 'pool' ? { riskPoolTargetCount: loadedCount + 100 } : { riskVaultTargetCount: loadedCount + 100 }),
							preservedContext: paginationContext,
						})
						if (!loaded && button.isConnected) {
							button.disabled = false
							button.removeAttribute('aria-busy')
							button.textContent = `Retry more ${kind === 'pool' ? 'pools' : 'vaults'}`
							status.textContent = `Additional ${kind} risk records could not be loaded.`
							status.classList.remove('sr-only')
							button.focus({ preventScroll: true })
						}
					})
					panel.append(button, status)
				} else if (renderContext.focusRiskKind === kind) {
					const complete = element('p', 'activity-summary operations-pagination-complete', `All available ${kind} records are shown.`)
					complete.dataset['riskKind'] = kind
					complete.tabIndex = -1
					complete.setAttribute('role', 'status')
					complete.setAttribute('aria-live', 'polite')
					panel.append(complete)
				}
			}
			appendRiskPagination('pool', riskPoolPanel, pools.length, riskPagination['poolHasMore'] === true, riskPagination['poolNextCursor'])
			appendRiskPagination('vault', riskVaultPanel, vaults.length, riskPagination['vaultHasMore'] === true, riskPagination['vaultNextCursor'])
		}
		const catalogPage = selectedCatalogPage
		const catalogSection = operationsCatalogSection()
		if (catalogPage !== undefined && catalogSection !== undefined && catalogSection !== 'risk') operationsCatalogState = { chainId: requiredChainId(), section: catalogSection, items: operationsCatalogRecords(catalogSection, data[catalogSection]) }
		if (catalogPage?.['hasMore'] === true && typeof catalogPage['nextCursor'] === 'string' && selected !== 'overview') {
			const loadMore = document.createElement('button')
			loadMore.type = 'button'
			loadMore.className = 'secondary operations-catalog-more'
			loadMore.textContent = 'Show more records'
			loadMore.setAttribute('aria-label', `Show more ${selected} from older canonical blocks`)
			const loadMoreStatus = element('p', 'activity-summary')
			loadMoreStatus.setAttribute('role', 'status')
			loadMoreStatus.setAttribute('aria-live', 'polite')
			loadMore.addEventListener('click', async () => {
				const paginationContext = captureOperationsRenderContext()
				loadMore.disabled = true
				loadMore.setAttribute('aria-busy', 'true')
				loadMoreStatus.textContent = 'Loading older canonical records…'
				const section = operationsCatalogSection()
				if (section === undefined || section === 'risk') return
				const loaded = await loadOperations({
					live: true,
					catalogTargetCount: operationsCatalogRecords(section, data[section]).length + 100,
					preservedContext: paginationContext,
				})
				if (!loaded && loadMore.isConnected) {
					loadMore.disabled = false
					loadMore.removeAttribute('aria-busy')
					loadMore.textContent = 'Retry older records'
					loadMoreStatus.textContent = 'Older canonical records could not be loaded.'
					loadMore.focus({ preventScroll: true })
				}
			})
			grid.append(loadMore, loadMoreStatus)
		} else if (catalogPage !== undefined && selected !== 'overview' && renderContext.focusLoadMore) {
			const completeStatus = element('p', 'activity-summary', 'All available records are shown.')
			completeStatus.setAttribute('role', 'status')
			completeStatus.setAttribute('aria-live', 'polite')
			grid.append(completeStatus)
		}
		if (selected === 'overview') content.replaceChildren(...(historical ? [freshness] : []), metrics, grid)
		else {
			content.replaceChildren(...(asOf['historical'] === true || asOf['phase'] === 'historical' ? [element('p', 'operations-route-freshness', operationsRouteFreshness(asOf, connection.classList.contains('live')))] : []), ...operationsSectionFilters(selected), grid)
		}
		content.setAttribute('aria-busy', 'false')
		$('#operations-status').hidden = true
		restoreOperationsRenderContext(renderContext)
	}

	const operationsDetailRoute = (): OperationsDetailRoute | undefined => {
		const parts = location.pathname.split('/').filter(Boolean)
		if (parts[0] !== 'operations') return undefined
		const kind = parts[1]
		if (kind === 'report' && parts.length === 4) return { kind, identity: [decodeURIComponent(parts[2] ?? ''), decodeURIComponent(parts[3] ?? '')] }
		if ((kind === 'auction' || kind === 'escalation' || kind === 'fork') && parts.length === 3) return { kind, identity: [decodeURIComponent(parts[2] ?? '')] }
		if (kind === 'trading' && parts.length === 3) return { kind, identity: [decodeURIComponent(parts[2] ?? '')] }
		if (kind === 'risk' && parts[2] === 'pool' && parts.length === 4) return { kind: 'pool', identity: [decodeURIComponent(parts[3] ?? '')] }
		if (kind === 'risk' && parts[2] === 'vault' && parts.length === 5) return { kind: 'vault', identity: [decodeURIComponent(parts[3] ?? ''), decodeURIComponent(parts[4] ?? '')] }
		return undefined
	}

	const operationsSectionFilters = (selected: string): HTMLElement[] => {
		if (selected === 'timeline') return [operationsTimelineFilters()]
		return selected === 'risk' ? [operationsRiskSnapshotFilter()] : []
	}

	const OPERATIONS_DETAIL_RESOURCES: Record<OperationsDetailRoute['kind'], string> = {
		auction: 'auctions',
		escalation: 'escalations',
		fork: 'forks',
		pool: 'risk/pools',
		report: 'reports',
		trading: 'trading',
		vault: 'risk/vaults',
	}

	const historyBlockRangeLabel = (oldestBlock: bigint | undefined, newestBlock: bigint | undefined, emptyLabel = 'No block-numbered evidence is loaded') => {
		if (oldestBlock === undefined || newestBlock === undefined) return emptyLabel
		if (oldestBlock === newestBlock) return `Loaded block #${oldestBlock.toLocaleString('en-US')}`
		return `Loaded blocks #${oldestBlock.toLocaleString('en-US')}–#${newestBlock.toLocaleString('en-US')}`
	}

	const operationsDetailEndpoint = (route: OperationsDetailRoute, cursor?: string, limit = 100, decisionCursor?: string, decisionLimit = 100): string => {
		const chainId = encodeURIComponent(requiredChainId())
		const identity = route.identity.map(encodeURIComponent).join('/')
		const resource = OPERATIONS_DETAIL_RESOURCES[route.kind]
		const query = new URLSearchParams({ limit: String(limit) })
		const atBlock = pageUrl.searchParams.get('atBlock')
		if ((route.kind === 'pool' || route.kind === 'vault') && atBlock !== null && atBlock !== '') query.set('atBlock', atBlock)
		if (cursor !== undefined) query.set('cursor', cursor)
		if (route.kind === 'report') {
			query.set('decisionLimit', String(decisionLimit))
			if (decisionCursor !== undefined) query.set('decisionCursor', decisionCursor)
		}
		return `/api/v1/state/${resource}/${chainId}/${identity}?${query.toString()}`
	}

	const operationsDetailRouteKey = (route: OperationsDetailRoute): string => `${route.kind}:${route.identity.join(':').toLowerCase()}`

	const operationsRiskHistoryKeys = ['stateSnapshots', 'accountingSnapshots', 'lifecycleEvents', 'liquidations'] as const

	const operationsHistoryOffset = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)

	const rawEvidence = (value: unknown) => {
		const disclosure = document.createElement('details')
		disclosure.className = 'operations-raw-evidence'
		disclosure.append(element('summary', '', 'Raw chain evidence'))
		const raw = document.createElement('pre')
		raw.textContent = JSON.stringify(value, null, 2) ?? 'Unavailable'
		disclosure.append(raw)
		return disclosure
	}

	const detailEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const eventName = String(item['event_name'] ?? item['semantic_event_kind'] ?? 'Protocol evidence')
			const block = item['block_number']
			const row = operationRow(eventName, `Canonical event · log ${String(item['log_index'] ?? '—')}`, String(item['tx_hash'] ?? ''), block)
			row.append(rawEvidence(item))
			return row
		})

	const tradingEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const eventName = String(item['event_name'] ?? 'AMM event')
			const data = isRecord(item['event_data']) ? item['event_data'] : {}
			const analytics = isRecord(item['analytics']) ? item['analytics'] : {}
			let summary = 'Canonical AMM lifecycle evidence'
			if (eventName === 'Swap')
				summary = `${String(analytics['direction'] ?? 'Swap')} · ${exactUnit(String(analytics['amountIn'] ?? '0'), 18, String(analytics['baseAsset'] ?? 'shares'), 4)} in → ${exactUnit(String(analytics['amountOut'] ?? '0'), 18, String(analytics['quoteAsset'] ?? 'shares'), 4)} out · ${exactUnit(String(analytics['feeAmount'] ?? '0'), 18, 'shares', 6)} fee${isRecord(analytics['priceImpact']) && analytics['priceImpact']['bps'] !== undefined ? ` · ${exactUnit(String(analytics['priceImpact']['bps']), 2, '%', 2)} impact` : ''}`
			else if (eventName === 'Sync') summary = `${exactUnit(String(data['yesReserve'] ?? '0'), 18, 'YES', 4)} · ${exactUnit(String(data['noReserve'] ?? '0'), 18, 'NO', 4)} reserves`
			else if (eventName === 'Transfer') summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares', 4)} · ${shortIdentifier(String(data['from'] ?? ''))} → ${shortIdentifier(String(data['to'] ?? ''))}`
			else if (eventName === 'Approval') summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares', 4)} · ${shortIdentifier(String(data['owner'] ?? ''))} approved ${shortIdentifier(String(data['spender'] ?? ''))}`
			else if (eventName.startsWith('Liquidity')) summary = `${exactUnit(String(data['yesAmount'] ?? '0'), 18, 'YES', 4)} · ${exactUnit(String(data['noAmount'] ?? '0'), 18, 'NO', 4)} · ${exactUnit(String(data['liquidity'] ?? '0'), 18, 'LP shares', 4)}`
			const row = operationRow(eventName, summary, String(data['provider'] ?? data['sender'] ?? item['tx_hash'] ?? ''), item['block_number'])
			row.append(rawEvidence(item))
			return row
		})

	const reportEvidenceRows = (items: readonly JsonRecord[]) =>
		items.map(item => {
			const data = isRecord(item['report_data']) ? item['report_data'] : {}
			const token1 = String(data['token1'] ?? 'token 1')
			const token2 = String(data['token2'] ?? 'token 2')
			const values = data['currentAmount1'] === undefined && data['currentAmount2'] === undefined ? 'No round amounts' : `${operationNumber(data['currentAmount1'])} ${shortIdentifier(token1)} · ${operationNumber(data['currentAmount2'])} ${shortIdentifier(token2)}`
			const comparison = isRecord(item['comparison']) ? item['comparison'] : {}
			const changes = operationRecords(comparison['changes'])
			const row = operationRow(`${String(item['event_name'] ?? 'Report round')} · round ${String(item['round_number'] ?? '—')}`, `${values} · reporter ${shortIdentifier(String(data['currentReporter'] ?? 'unknown'))}`, String(item['tx_hash'] ?? ''), item['block_number'])
			const changeDetails = document.createElement('details')
			changeDetails.className = 'operations-round-changes'
			changeDetails.append(element('summary', '', comparison['state'] === 'initial' ? `Initial values (${changes.length})` : `Changes from round ${String(comparison['previousRoundNumber'] ?? '—')} (${changes.length})`))
			const changeList = document.createElement('ul')
			for (const change of changes) {
				const before = change['before'] === undefined ? 'not set' : JSON.stringify(change['before'])
				const after = change['after'] === undefined ? 'not set' : JSON.stringify(change['after'])
				changeList.append(element('li', '', `${String(change['field'] ?? 'field')}: ${before ?? 'unavailable'} → ${after ?? 'unavailable'}`))
			}
			if (changes.length === 0) changeList.append(element('li', '', 'No report fields changed.'))
			changeDetails.append(changeList)
			row.append(changeDetails)
			row.append(rawEvidence(item))
			return row
		})

	const detailEvidenceRowsFor = (kind: OperationsDetailRoute['kind'], items: readonly JsonRecord[]) => {
		if (kind === 'trading') return tradingEvidenceRows(items)
		return kind === 'report' ? reportEvidenceRows(items) : detailEvidenceRows(items)
	}

	const detailPageRecord = (data: JsonRecord, key: string): JsonRecord => (isJsonRecord(data[key]) ? data[key] : {})

	const renderOperationsDetail = (response: OperationsResponse, route: OperationsDetailRoute, preservedContext?: OperationsRenderContext) => {
		const content = $('#operations-content')
		const renderContext = preservedContext ?? captureOperationsRenderContext()
		const data = response.data
		const asOf = response.asOf
		const header = element('section', 'operations-detail-header')
		const back = document.createElement('a')
		const headerPresentation = operationsDetailHeaderPresentation(route.kind, asOf, connection.classList.contains('live'))
		const historical = asOf['historical'] === true || asOf['phase'] === 'historical'
		const catalogPath = headerPresentation.catalogPath
		back.href = operationsHref(catalogPath)
		back.textContent = headerPresentation.backLabel
		const titleIdentity = route.kind === 'vault' ? route.identity[1] : route.identity[0]
		const title = element('h2', '', route.kind === 'report' ? `OpenOracle report ${route.identity[1]}` : `${route.kind[0]?.toUpperCase()}${route.kind.slice(1)} ${shortIdentifier(titleIdentity ?? '')}`)
		header.append(back, title)
		if (historical) header.append(element('p', 'operations-route-freshness', headerPresentation.freshness))

		const summary = element('div', 'operations-metrics')
		const snapshot = isRecord(data['snapshot']) ? data['snapshot'] : undefined
		const taggedEvidence = snapshot !== undefined || typeof data['source_method'] === 'string'
		const current = isRecord(data['current']) ? data['current'] : undefined
		const lifecycle = current !== undefined && isRecord(current['lifecycle']) ? current['lifecycle'] : undefined
		const summaryPresentation = operationsDetailSummaryPresentation(route.kind, {
			currentEvent: current?.['event_name'],
			lifecycleState: lifecycle?.['state'],
			protocolState: data['protocol_state'],
			scannerSeverity: data['scanner_severity'],
			snapshotReadStatus: snapshot?.['read_status'],
		})
		summary.append(operationCard(summaryPresentation.label, summaryPresentation.value), operationCard('Evidence source', taggedEvidence ? 'Tagged contract read' : 'Canonical events'), operationCard('Entity identity', route.identity.join(' · ')))

		const panels: HTMLElement[] = []
		let loadedRiskHistoryOffset = 0
		const decisionPage = route.kind === 'report' ? detailPageRecord(data, 'coordinatorDecisions') : {}
		const decisionItems = operationRecords(decisionPage['items'])
		const approvalEvents = operationRecords(data['approvalEvents']).sort(compareCanonicalEventPosition)
		if (approvalEvents.length > 0)
			panels.push(
				operationsPanel(
					'Liquidation approval lifecycle',
					approvalEvents.map(item => operationRow(String(item['event_name'] ?? 'Liquidation approval'), approvalTransitionSummary(item), String(item['approval_identity'] ?? ''), item['block_number'])),
					'No approval transitions are related to this risk entity.',
				),
			)
		if (snapshot !== undefined) panels.push(operationsPanel('Current-state snapshot', [operationRow('Tagged block read', String(snapshot['read_status']), String(snapshot['entity_identity'] ?? ''), snapshot['block_number']), rawEvidence(snapshot)], 'Snapshot unavailable'))
		if (current !== undefined) panels.push(operationsPanel('Current report', [operationRow(String(lifecycle?.['state'] ?? current['event_name'] ?? 'Report'), 'Latest canonical report evidence', route.identity.join(':'), current['block_number']), rawEvidence(current)], 'Current report unavailable'))
		if (route.kind === 'pool' || route.kind === 'vault') {
			const riskPresentation = operationsRiskPresentation(route.kind, data['protocol_state'], data['scanner_severity'])
			const protocolStateRow = operationRow('Protocol state', riskPresentation.protocolState, route.identity.join(':'), data['block_number'])
			protocolStateRow.classList.add('operations-risk-protocol')
			const scannerAssessmentRow = operationRow('Scanner assessment', `${riskPresentation.scannerAssessment} · ${String(data['scanner_reason'] ?? 'Current-state evidence unavailable')}`, undefined, data['block_number'])
			scannerAssessmentRow.classList.add('operations-risk-assessment', `operations-risk-${riskPresentation.scannerTone}`)
			panels.push(operationsPanel(headerPresentation.riskPanelTitle, [protocolStateRow, scannerAssessmentRow, rawEvidence(data)], 'Risk state unavailable'))
		}
		if (route.kind === 'trading') {
			const tradingSummary = isRecord(data['summary']) ? data['summary'] : {}
			const twap24h = isRecord(data['twap24h']) ? data['twap24h'] : {}
			const twap7d = isRecord(data['twap7d']) ? data['twap7d'] : {}
			panels.push(
				operationsPanel(
					'Trading summary',
					[
						operationRow('24-hour activity', `${operationCounted(tradingSummary['swaps_24h'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_24h'] ?? '0'), 18, 'input shares', 4)} · ${exactUnit(String(tradingSummary['fees_24h'] ?? '0'), 18, 'fee shares', 6)}`, route.identity[0] ?? '', undefined),
						operationRow('Seven-day activity', `${operationCounted(tradingSummary['swaps_7d'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_7d'] ?? '0'), 18, 'input shares', 4)} · ${exactUnit(String(tradingSummary['fees_7d'] ?? '0'), 18, 'fee shares', 6)}`, route.identity[0] ?? '', undefined),
						operationRow('24-hour TWAP', `${String(twap24h['state'] ?? 'Unavailable')} · ${operationRatio(twap24h['numerator'], twap24h['denominator'])} NO per YES · ${operationNumber(twap24h['coverageSeconds'])} covered seconds`, 'NO per YES', undefined),
						operationRow('Seven-day TWAP', `${String(twap7d['state'] ?? 'Unavailable')} · ${operationRatio(twap7d['numerator'], twap7d['denominator'])} NO per YES · ${operationNumber(twap7d['coverageSeconds'])} covered seconds`, 'NO per YES', undefined),
					],
					'No trading observations are available.',
				),
			)
			const lpPositions = operationRecords(data['lpPositions'])
			panels.push(
				operationsPanel(
					'Current LP-share ownership',
					lpPositions.map(position =>
						operationRow('LP holder', `${exactUnit(String(position['balance'] ?? '0'), 18, 'LP shares', 5)} current · ${exactUnit(String(position['received_liquidity'] ?? '0'), 18, '', 5)} received · ${exactUnit(String(position['sent_liquidity'] ?? '0'), 18, '', 5)} sent`, String(position['address'] ?? ''), undefined),
					),
					'No LP-share ownership records match this view. Transfer history begins when this scanner started indexing the pair.',
				),
			)
			const candles = operationRecords(data['candles'])
			panels.push(
				operationsPanel(
					'Hourly NO-per-YES candles',
					candles.map(candle => {
						const open = isRecord(candle['open']) ? candle['open'] : {}
						const high = isRecord(candle['high']) ? candle['high'] : {}
						const low = isRecord(candle['low']) ? candle['low'] : {}
						const close = isRecord(candle['close']) ? candle['close'] : {}
						return operationRow(
							new Date(Number(candle['bucketStart'] ?? 0) * 1_000).toLocaleString(),
							`O ${operationRatio(open['numerator'], open['denominator'])} · H ${operationRatio(high['numerator'], high['denominator'])} · L ${operationRatio(low['numerator'], low['denominator'])} · C ${operationRatio(close['numerator'], close['denominator'])}`,
							`${String(candle['observations'] ?? '0')} observations`,
							undefined,
						)
					}),
					'No reserve observations are available for candles.',
				),
			)
		}
		if (route.kind === 'report') {
			const decisionPanel = operationsPanel(
				'Coordinator decisions',
				decisionItems.map(decision => {
					const argumentsValue = isRecord(decision['arguments']) ? decision['arguments'] : {}
					return operationRow(String(decision['event_name'] ?? 'Coordinator decision'), String(argumentsValue['reason'] ?? decision['summary'] ?? 'Linked coordinator evidence'), String(decision['emitter_address'] ?? ''), decision['block_number'])
				}),
				'No coordinator decision could be linked to this report.',
			)
			const decisionsHaveMore = decisionPage['hasMore'] === true && typeof decisionPage['nextCursor'] === 'string'
			if (decisionsHaveMore) {
				const loadMore = document.createElement('button')
				loadMore.type = 'button'
				loadMore.className = 'secondary compact operations-detail-more'
				loadMore.dataset['detailCollection'] = 'decisions'
				loadMore.textContent = 'Show older decisions'
				loadMore.setAttribute('aria-label', 'Show older coordinator decisions')
				const loadMoreStatus = element('p', 'activity-summary')
				loadMoreStatus.setAttribute('role', 'status')
				loadMoreStatus.setAttribute('aria-live', 'polite')
				loadMore.addEventListener('click', async () => {
					const paginationContext = captureOperationsRenderContext()
					loadMore.disabled = true
					loadMore.setAttribute('aria-busy', 'true')
					loadMoreStatus.textContent = 'Loading older coordinator decisions…'
					const loaded = await loadOperations({
						live: true,
						decisionTargetCount: decisionItems.length + 100,
						preservedContext: paginationContext,
					})
					if (!loaded && loadMore.isConnected) {
						loadMore.disabled = false
						loadMore.removeAttribute('aria-busy')
						loadMore.textContent = 'Retry older decisions'
						loadMoreStatus.textContent = 'Older coordinator decisions could not be loaded.'
						loadMore.focus({ preventScroll: true })
					}
				})
				decisionPanel.append(loadMore, loadMoreStatus)
			} else if (renderContext.focusDetailCollection === 'decisions') {
				const completeStatus = element('p', 'activity-summary operations-pagination-complete', 'All available coordinator decisions are shown.')
				completeStatus.dataset['detailCollection'] = 'decisions'
				completeStatus.setAttribute('role', 'status')
				completeStatus.setAttribute('aria-live', 'polite')
				completeStatus.tabIndex = -1
				decisionPanel.append(completeStatus)
			}
			panels.push(decisionPanel)
		}
		if (route.kind === 'pool' || route.kind === 'vault') {
			const history = isRecord(data['history']) ? data['history'] : {}
			loadedRiskHistoryOffset = operationsHistoryOffset(history['loadedOffset']) ?? operationsHistoryOffset(history['offset']) ?? 0
			const historyCollections = Object.fromEntries(operationsRiskHistoryKeys.map(key => [key, operationRecords(history[key])]))
			for (const [key, label] of [
				['stateSnapshots', 'Tagged risk history'],
				['accountingSnapshots', 'Accounting checkpoint history'],
				['lifecycleEvents', 'Risk lifecycle events'],
				['liquidations', 'Liquidation history'],
			] as const) {
				const records = historyCollections[key] ?? []
				panels.push(operationsPanel(label, detailEvidenceRows(records), `No ${label.toLowerCase()} available in this view.`))
			}
			const historySummary = summarizeHistoryCollections(historyCollections, operationsRiskHistoryKeys)
			const historyBlockRange = historyBlockRangeLabel(historySummary.oldestBlock, historySummary.newestBlock)
			const historyCounts = [`tagged state ${historySummary.counts['stateSnapshots'] ?? 0}`, `accounting ${historySummary.counts['accountingSnapshots'] ?? 0}`, `lifecycle ${historySummary.counts['lifecycleEvents'] ?? 0}`, `liquidations ${historySummary.counts['liquidations'] ?? 0}`].join(' · ')
			const nextHistoryCursor = history['nextCursor']
			if (history['truncated'] === true && typeof nextHistoryCursor !== 'string') throw new Error('Risk history continuation is malformed')
			if (history['truncated'] === true && typeof nextHistoryCursor === 'string') {
				const nextHistoryOffset = loadedRiskHistoryOffset + (operationsHistoryOffset(history['limit']) ?? 100)
				const coveragePanel = operationsPanel('History coverage', [operationRow('Older evidence remains', `${historyBlockRange} · ${historyCounts}.`, undefined, undefined)], '')
				coveragePanel.id = 'operations-risk-history-coverage'
				const loadMore = document.createElement('button')
				loadMore.type = 'button'
				loadMore.className = 'secondary compact operations-history-more'
				loadMore.textContent = 'Show older evidence'
				loadMore.setAttribute('aria-label', 'Show older pool or vault risk history')
				const loadMoreStatus = element('p', 'operations-history-status')
				loadMoreStatus.setAttribute('role', 'status')
				loadMoreStatus.setAttribute('aria-live', 'polite')
				const pagination = element('div', 'operations-history-pagination')
				const recordPaginationLayout = () => {
					window.requestAnimationFrame(() => {
						if (!pagination.isConnected) return
						const buttonBounds = loadMore.getBoundingClientRect()
						const statusBounds = loadMoreStatus.getBoundingClientRect()
						const separated = buttonBounds.bottom <= statusBounds.top || statusBounds.bottom <= buttonBounds.top
						pagination.dataset['layout'] = separated ? 'separated' : 'overlap'
					})
				}
				loadMore.addEventListener('click', async () => {
					const paginationContext = captureOperationsRenderContext()
					loadMore.disabled = true
					loadMore.setAttribute('aria-busy', 'true')
					loadMoreStatus.textContent = 'Loading older pool and vault evidence…'
					recordPaginationLayout()
					const loaded = await loadOperations({
						live: true,
						historyTargetOffset: nextHistoryOffset,
						preservedContext: paginationContext,
					})
					if (!loaded && loadMore.isConnected) {
						loadMore.disabled = false
						loadMore.removeAttribute('aria-busy')
						loadMore.textContent = 'Retry older evidence'
						loadMoreStatus.textContent = 'Older pool and vault evidence could not be loaded.'
						loadMore.focus({ preventScroll: true })
						recordPaginationLayout()
					}
				})
				pagination.append(loadMore, loadMoreStatus)
				coveragePanel.append(pagination)
				recordPaginationLayout()
				panels.push(coveragePanel)
				if (isDemo && pageUrl.searchParams.get('riskHistoryAutoLoad') === '1' && !demoRiskHistoryAutoLoadConsumed) {
					demoRiskHistoryAutoLoadConsumed = true
					window.setTimeout(() => {
						if (loadMore.isConnected) {
							loadMore.focus({ preventScroll: true })
							loadMore.click()
						}
					}, 0)
				}
			} else if (renderContext.focusHistoryMore) {
				const complete = operationsPanel('History coverage', [operationRow('All available risk history is shown', `${historyBlockRange} · ${historyCounts}.`, undefined, undefined)], '')
				complete.id = 'operations-risk-history-coverage'
				complete.classList.add('operations-history-complete')
				complete.tabIndex = -1
				complete.setAttribute('role', 'status')
				complete.setAttribute('aria-live', 'polite')
				panels.push(complete)
			}
		}

		const demand = operationRecords(data['demandCurve'])
		if (demand.length > 0) {
			const demandRows = demand.map(point => operationRow(`Tick ${String(point['tick'])}`, `${operationNumber(point['amountAttoEth'])} attoETH · cumulative ${operationNumber(point['cumulativeDemandAttoEth'])}`, String(point['tick']), undefined))
			panels.push(operationsPanel('Demand curve data', demandRows, 'No bids match this view.'))
		}
		const branches = operationRecords(data['branches'])
		if (route.kind === 'fork') {
			const forkSummary = isRecord(data['summary']) ? data['summary'] : {}
			panels.push(
				operationsPanel(
					'Fork migration totals',
					[
						operationRow(
							'Reputation movement',
							`${exactUnit(String(forkSummary['migrated_atto_rep'] ?? '0'), 18, 'REP', 4)} migrated · ${exactUnit(String(forkSummary['burned_atto_rep'] ?? '0'), 18, 'REP', 4)} burned`,
							`${operationCounted(forkSummary['migrator_count'], 'migrator')} · ${operationCounted(forkSummary['child_count'], 'child universe')}`,
							undefined,
						),
						operationRow(
							'Statoblast migration',
							`${operationCounted(forkSummary['pool_migration_events'], 'pool migration event')} · ${operationNumber(forkSummary['obligations_materialized'])}/${operationNumber(forkSummary['obligations_initialized'])} escalation obligations materialized`,
							route.identity[0] ?? '',
							undefined,
						),
					],
					'No fork summary evidence is available.',
				),
			)
		}
		if (branches.length > 0)
			panels.push(
				operationsPanel(
					'Child universe branches',
					branches.map(branch => operationRow(`Child ${String(branch['child_universe_id'])}`, `Outcome ${String(branch['outcome_index'] ?? '—')} · ${operationNumber(branch['migrated_atto_rep'])} attoREP · ${operationCounted(branch['migrator_count'], 'migrator')}`, String(branch['child_universe_id']), undefined)),
					'No child branches match this view.',
				),
			)
		const evidencePage = detailPageRecord(data, route.kind === 'report' ? 'rounds' : 'events')
		const evidenceItems = operationRecords(evidencePage['items'])
		operationsDetailState = {
			chainId: requiredChainId(),
			routeKey: operationsDetailRouteKey(route),
			items: evidenceItems,
			decisionItems,
			riskHistoryOffset: loadedRiskHistoryOffset,
		}
		const evidenceHasMore = evidencePage['hasMore'] === true && typeof evidencePage['nextCursor'] === 'string'
		if (operationsDetailEvidencePanelVisible(route.kind, evidenceItems.length, evidenceHasMore, renderContext.focusLoadMore)) {
			const evidencePanel = operationsPanel(route.kind === 'report' ? 'Report rounds' : 'Lifecycle timeline', detailEvidenceRowsFor(route.kind, evidenceItems), 'No canonical evidence is available.')
			if (evidenceHasMore) {
				const loadMore = document.createElement('button')
				loadMore.type = 'button'
				loadMore.className = 'secondary compact operations-detail-more'
				loadMore.dataset['detailCollection'] = 'evidence'
				loadMore.textContent = 'Show older evidence'
				loadMore.setAttribute('aria-label', 'Show older canonical evidence')
				const loadMoreStatus = element('p', 'activity-summary')
				loadMoreStatus.setAttribute('role', 'status')
				loadMoreStatus.setAttribute('aria-live', 'polite')
				loadMore.addEventListener('click', async () => {
					const paginationContext = captureOperationsRenderContext()
					loadMore.disabled = true
					loadMore.setAttribute('aria-busy', 'true')
					loadMoreStatus.textContent = 'Loading older canonical evidence…'
					const loaded = await loadOperations({
						live: true,
						detailTargetCount: evidenceItems.length + 100,
						preservedContext: paginationContext,
					})
					if (!loaded && loadMore.isConnected) {
						loadMore.disabled = false
						loadMore.removeAttribute('aria-busy')
						loadMore.textContent = 'Retry older evidence'
						loadMoreStatus.textContent = 'Older canonical evidence could not be loaded.'
						loadMore.focus({ preventScroll: true })
					}
				})
				evidencePanel.append(loadMore, loadMoreStatus)
			} else if (renderContext.focusDetailCollection === 'evidence') {
				const completeStatus = element('p', 'activity-summary operations-pagination-complete', 'All available evidence is shown.')
				completeStatus.dataset['detailCollection'] = 'evidence'
				completeStatus.setAttribute('role', 'status')
				completeStatus.setAttribute('aria-live', 'polite')
				completeStatus.tabIndex = -1
				evidencePanel.append(completeStatus)
			}
			panels.push(evidencePanel)
		}
		const grid = element('div', 'operations-grid operations-grid-single')
		grid.append(...panels)
		content.replaceChildren(header, summary, grid)
		content.setAttribute('aria-busy', 'false')
		$('#operations-status').hidden = true
		restoreOperationsRenderContext(renderContext)
	}

	const loadOperationsCatalog = async (section: PagedOperationsCatalogSection, retainedCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsCatalogEndpoint(section, cursor, limit)))
				first ??= response
				last = response
				return {
					items: operationsCatalogRecords(section, response.data['items'], true),
					...(response.data['hasMore'] === true && typeof response.data['nextCursor'] === 'string' ? { nextCursor: response.data['nextCursor'] } : {}),
				}
			},
			retainedCount,
			item => operationsCatalogRecordKey(section, item),
		)
		if (first === undefined || last === undefined) throw new Error('Operations catalog returned no page')
		return catalogOperationsResponse(
			{
				...first,
				data: { ...last.data, hasMore: snapshot.nextCursor !== undefined, ...(snapshot.nextCursor === undefined ? {} : { nextCursor: snapshot.nextCursor }) },
			},
			section,
			snapshot.items,
		)
	}

	const loadOperationsRiskCatalog = async (poolTargetCount: number, vaultTargetCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		let snapshotIdentity: string | undefined
		const collected = await collectDualCursorCollections(
			async ({ leftCursor, rightCursor, limit }) => {
				const response = decodeOperationsResponse(await api(operationsRiskCatalogEndpoint(leftCursor, rightCursor, limit)))
				const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
				if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Risk catalog changed while older evidence was loading; retry from the latest available block')
				snapshotIdentity ??= responseIdentity
				first ??= response
				last = response
				const pagination = operationsRiskPagination(response.data['pagination'], true)
				return {
					left: operationsRiskRecords('pools', response.data['pools'], true),
					right: operationsRiskRecords('vaults', response.data['vaults'], true),
					...(pagination['poolHasMore'] === true && typeof pagination['poolNextCursor'] === 'string' ? { leftNextCursor: pagination['poolNextCursor'] } : {}),
					...(pagination['vaultHasMore'] === true && typeof pagination['vaultNextCursor'] === 'string' ? { rightNextCursor: pagination['vaultNextCursor'] } : {}),
				}
			},
			poolTargetCount,
			vaultTargetCount,
			item => String(item['pool_address'] ?? ''),
			item => `${String(item['pool_address'] ?? '')}:${String(item['vault_address'] ?? '')}`,
		)
		if (first === undefined || last === undefined) throw new Error('Risk catalog returned no page')
		const pagination = isJsonRecord(last.data['pagination']) ? last.data['pagination'] : {}
		return riskCatalogOperationsResponse(
			{
				...first,
				data: {
					...last.data,
					pagination: riskPaginationForCollectedCursors(pagination, collected.leftNextCursor, collected.rightNextCursor),
				},
			},
			collected.left,
			collected.right,
		)
	}

	const loadOperationsRiskDetail = async (route: OperationsDetailRoute, throughOffset: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		let snapshotIdentity: string | undefined
		const collected = await collectCursorCollections(
			async cursor => {
				const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, 100)))
				const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
				if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Risk history changed while older evidence was loading; retry from the latest available block')
				snapshotIdentity ??= responseIdentity
				first ??= response
				last = response
				const history = detailPageRecord(response.data, 'history')
				const offset = operationsHistoryOffset(history['offset'])
				const nextCursor = history['nextCursor']
				if (offset === undefined) throw new Error('Risk history page offset is malformed')
				if (history['truncated'] === true && typeof nextCursor !== 'string') throw new Error('Risk history continuation is malformed')
				if (history['truncated'] !== true && nextCursor !== undefined) throw new Error('Risk history completion is malformed')
				return {
					collections: {
						stateSnapshots: operationRecords(history['stateSnapshots']),
						accountingSnapshots: operationRecords(history['accountingSnapshots']),
						lifecycleEvents: operationRecords(history['lifecycleEvents']),
						liquidations: operationRecords(history['liquidations']),
					},
					offset,
					...(history['truncated'] === true && typeof nextCursor === 'string' ? { nextCursor } : {}),
				}
			},
			operationsRiskHistoryKeys,
			throughOffset,
		)
		if (first === undefined || last === undefined) throw new Error('Risk detail returned no page')
		const lastHistory = detailPageRecord(last.data, 'history')
		return {
			...first,
			data: {
				...first.data,
				history: {
					...lastHistory,
					...collected.collections,
					offset: 0,
					loadedOffset: collected.loadedOffset,
					truncated: collected.nextCursor !== undefined,
					...(collected.nextCursor === undefined ? {} : { nextCursor: collected.nextCursor }),
				},
			},
		}
	}

	const loadOperationsReportDetail = async (route: OperationsDetailRoute, roundTargetCount: number, decisionTargetCount: number): Promise<OperationsResponse> => {
		let first: OperationsResponse | undefined
		let lastRoundPage: Record<string, unknown> = {}
		let lastDecisionPage: Record<string, unknown> = {}
		let snapshotIdentity: string | undefined
		const fetchPage = async (cursor: string | undefined, limit: number, collection: 'decisions' | 'rounds') => {
			const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, collection === 'rounds' ? cursor : undefined, collection === 'rounds' ? limit : 1, collection === 'decisions' ? cursor : undefined, collection === 'decisions' ? limit : 1)))
			const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
			if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity) throw new Error('Report evidence changed while older evidence was loading; retry from the latest available block')
			snapshotIdentity ??= responseIdentity
			first ??= response
			const page = detailPageRecord(response.data, collection === 'rounds' ? 'rounds' : 'coordinatorDecisions')
			if (collection === 'rounds') lastRoundPage = page
			else lastDecisionPage = page
			return {
				items: operationRecords(page['items']),
				...(page['hasMore'] === true && typeof page['nextCursor'] === 'string' ? { nextCursor: page['nextCursor'] } : {}),
			}
		}
		const [rounds, decisions] = await Promise.all([collectCanonicalPages((cursor, limit = 100) => fetchPage(cursor, limit, 'rounds'), roundTargetCount, operationsDetailRecordKey), collectCanonicalPages((cursor, limit = 100) => fetchPage(cursor, limit, 'decisions'), decisionTargetCount, operationsDetailRecordKey)])
		if (first === undefined) throw new Error('Report detail returned no page')
		return {
			...first,
			data: {
				...first.data,
				rounds: {
					...lastRoundPage,
					items: rounds.items,
					hasMore: rounds.nextCursor !== undefined,
					...(rounds.nextCursor === undefined ? {} : { nextCursor: rounds.nextCursor }),
				},
				coordinatorDecisions: {
					...lastDecisionPage,
					items: decisions.items,
					hasMore: decisions.nextCursor !== undefined,
					...(decisions.nextCursor === undefined ? {} : { nextCursor: decisions.nextCursor }),
				},
			},
		}
	}

	const loadOperationsDetail = async (route: OperationsDetailRoute, retainedCount: number, riskHistoryThroughOffset = 0, decisionTargetCount = 0): Promise<OperationsResponse> => {
		if (route.kind === 'pool' || route.kind === 'vault') return await loadOperationsRiskDetail(route, riskHistoryThroughOffset)
		if (route.kind === 'report') return await loadOperationsReportDetail(route, retainedCount, decisionTargetCount)
		const pageKey = 'events'
		let first: OperationsResponse | undefined
		let last: OperationsResponse | undefined
		const snapshot = await collectCanonicalPages(
			async (cursor?: string, limit = 100) => {
				const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, limit)))
				first ??= response
				last = response
				const page = detailPageRecord(response.data, pageKey)
				return {
					items: operationRecords(page['items']),
					...(page['hasMore'] === true && typeof page['nextCursor'] === 'string' ? { nextCursor: page['nextCursor'] } : {}),
				}
			},
			retainedCount,
			operationsDetailRecordKey,
		)
		if (first === undefined || last === undefined) throw new Error('Operations detail returned no page')
		const lastPage = detailPageRecord(last.data, pageKey)
		return {
			...first,
			data: {
				...first.data,
				[pageKey]: {
					...lastPage,
					items: snapshot.items,
					hasMore: snapshot.nextCursor !== undefined,
					...(snapshot.nextCursor === undefined ? {} : { nextCursor: snapshot.nextCursor }),
				},
			},
		}
	}

	const loadOperations = async ({
		live = false,
		catalogTargetCount,
		riskPoolTargetCount,
		riskVaultTargetCount,
		detailTargetCount,
		decisionTargetCount,
		historyTargetOffset,
		preservedContext,
	}: {
		live?: boolean
		catalogTargetCount?: number
		riskPoolTargetCount?: number
		riskVaultTargetCount?: number
		detailTargetCount?: number
		decisionTargetCount?: number
		historyTargetOffset?: number
		preservedContext?: OperationsRenderContext
	} = {}): Promise<boolean> => {
		const requestedContext = `${requiredChainId()}:${location.pathname}`
		return await runSerializedOperationsLoad(
			operationsLoadState,
			requestedContext,
			live,
			catalogTargetCount !== undefined || riskPoolTargetCount !== undefined || riskVaultTargetCount !== undefined || detailTargetCount !== undefined || decisionTargetCount !== undefined || historyTargetOffset !== undefined,
			() => `${requiredChainId()}:${location.pathname}`,
			() => operationsRequestVersion++,
			async () => {
				const requestVersion = ++operationsRequestVersion
				const status = $('#operations-status')
				const content = $('#operations-content')
				const preserveRenderedContent = live && content.childElementCount > 0
				status.hidden = false
				status.className = preserveRenderedContent ? 'sr-only' : 'system-status'
				status.textContent = preserveRenderedContent ? 'Refreshing canonical protocol operations…' : 'Loading canonical protocol operations…'
				content.setAttribute('aria-busy', 'true')
				try {
					const detailRoute = operationsDetailRoute()
					const catalogSection = detailRoute === undefined ? operationsCatalogSection() : undefined
					const retainedCatalogCount = catalogSection !== undefined && catalogSection !== 'risk' && operationsCatalogState?.chainId === requiredChainId() && operationsCatalogState.section === catalogSection ? operationsCatalogState.items.length : 0
					const retainedRiskPoolCount = catalogSection === 'risk' && operationsRiskCatalogState?.chainId === requiredChainId() ? operationsRiskCatalogState.pools.length : 0
					const retainedRiskVaultCount = catalogSection === 'risk' && operationsRiskCatalogState?.chainId === requiredChainId() ? operationsRiskCatalogState.vaults.length : 0
					const retainedDetailCount = detailRoute !== undefined && operationsDetailState?.chainId === requiredChainId() && operationsDetailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsDetailState.items.length : 0
					const retainedRiskHistoryOffset = detailRoute !== undefined && (detailRoute.kind === 'pool' || detailRoute.kind === 'vault') && operationsDetailState?.chainId === requiredChainId() && operationsDetailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsDetailState.riskHistoryOffset : 0
					const retainedDecisionCount = detailRoute?.kind === 'report' && operationsDetailState?.chainId === requiredChainId() && operationsDetailState.routeKey === operationsDetailRouteKey(detailRoute) ? operationsDetailState.decisionItems.length : 0
					const loadResponse = async () => {
						if (detailRoute !== undefined) return await loadOperationsDetail(detailRoute, detailTargetCount ?? retainedDetailCount, historyTargetOffset ?? retainedRiskHistoryOffset, decisionTargetCount ?? retainedDecisionCount)
						if (catalogSection === undefined) return decodeOperationsResponse(await api(`/api/v1/operations?chainId=${encodeURIComponent(requiredChainId())}`))
						if (catalogSection === 'risk') return await loadOperationsRiskCatalog(riskPoolTargetCount ?? retainedRiskPoolCount, riskVaultTargetCount ?? retainedRiskVaultCount)
						return await loadOperationsCatalog(catalogSection, catalogTargetCount ?? retainedCatalogCount)
					}
					const response = await loadResponse()
					if (requestVersion !== operationsRequestVersion) return false
					if (detailRoute === undefined) renderOperations(response, preservedContext)
					else renderOperationsDetail(response, detailRoute, preservedContext)
					return true
				} catch (error) {
					if (requestVersion !== operationsRequestVersion) return false
					if (preserveRenderedContent) {
						status.className = 'system-status'
						status.dataset.errorDetail = error instanceof Error ? error.message : 'Unknown operations refresh failure'
						renderRetryStatus(status, 'Could not refresh protocol operations. Existing evidence remains visible.', () => loadOperations({ live: true }))
						content.setAttribute('aria-busy', 'false')
						return false
					}
					status.dataset.errorDetail = error instanceof Error ? error.message : 'Unknown operations request failure'
					renderRetryStatus(status, 'Could not load protocol operations.', loadOperations)
					content.replaceChildren()
					content.setAttribute('aria-busy', 'false')
					return false
				}
			},
		)
	}

	const syncNetworkUrl = () => {
		const url = new URL(location.href)
		const chainId = selectedChainId()
		if (chainId) url.searchParams.set('chainId', chainId)
		else url.searchParams.delete('chainId')
		history.replaceState(null, '', url)
		pageUrl = url
		for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a, .operations-nav a')) {
			const destination = new URL(link.href)
			if (chainId) destination.searchParams.set('chainId', chainId)
			else destination.searchParams.delete('chainId')
			if (isDemo) destination.searchParams.set('demo', '1')
			link.href = destination.href
		}
	}

	const updateNetworkLabels = () => {
		const symbol = selectedChainId() === '1' ? 'ETH' : 'SepoliaETH'
		$('#rich-native-sort-option').textContent = symbol
		$('#rich-native-heading').textContent = `${symbol} / WETH`
	}

	const reconcileNetworkOptions = (items: NetworkRecord[]) => {
		const selected = selectedChainId()
		globalNetworkFilter.replaceChildren(...items.map((network: { name: string; chain_id: string }) => new Option(network.name, network.chain_id)))
		globalNetworkFilter.value = [...globalNetworkFilter.options].some(option => option.value === selected) ? selected : String(items[0]?.chain_id ?? '')
		globalNetworkFilter.dataset.restored = 'true'
		syncNetworkUrl()
		updateNetworkLabels()
	}

	const loadNetworks = async ({ synchronizeActivity = true, refreshAfterCurrent = false } = {}): Promise<boolean> => {
		if (networkLoadPromise !== undefined) {
			if (!refreshAfterCurrent) return await networkLoadPromise
			if (refreshAfterCurrent && networkFollowUpPromise !== undefined) return await networkFollowUpPromise
			const activeLoad = networkLoadPromise
			const followUp: Promise<boolean> = activeLoad
				.then(async () => {
					if (networkLoadPromise === activeLoad) networkLoadPromise = undefined
					return await loadNetworks({ synchronizeActivity })
				})
				.finally(() => {
					if (networkFollowUpPromise === followUp) networkFollowUpPromise = undefined
				})
			if (refreshAfterCurrent) networkFollowUpPromise = followUp
			return await followUp
		}
		const resumeGeneration = networkResumeGeneration
		if (awaitingResumedNetworkStatus) {
			lastNetworkRequestFailed = false
			renderNetworks(latestNetworks)
			updateFreshness()
		}
		const canonicalGeneration = canonicalDataGeneration
		const run = (async () => {
			try {
				const { items, serverTime, freshnessThresholdMs } = decodeNetworkResponse(await api('/api/v1/networks'))
				if (!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
				if (serverTime) serverClockOffsetMs = new Date(serverTime).getTime() - Date.now()
				networkSnapshotCache.write({ items, ...(freshnessThresholdMs === undefined ? {} : { freshnessThresholdMs }), clientClockOffsetMs: serverClockOffsetMs, writtenAt: Date.now() })
				if (freshnessThresholdMs !== undefined && Number.isFinite(freshnessThresholdMs) && freshnessThresholdMs > 0) networkFreshnessThresholdMs = freshnessThresholdMs
				const previousNetwork = selectedChainId()
				reconcileNetworkOptions(items)
				if (previousNetwork !== selectedChainId()) resetSelectedNetworkContext()
				if (resumeGeneration === networkResumeGeneration) awaitingResumedNetworkStatus = false
				lastNetworkRequestFailed = false
				renderNetworks(items)
				updateFreshness()
				updateConnectionStatus()
				if (isActivity && synchronizeActivity && previousNetwork !== selectedChainId()) {
					await loadLogs()
				}
				if (isSystem && synchronizeActivity && previousNetwork !== selectedChainId()) await loadSystemState()
				if (isOperations && synchronizeActivity && previousNetwork !== selectedChainId()) await loadOperations()
				if (isContracts && synchronizeActivity && previousNetwork !== selectedChainId()) await loadContracts()
				if (isRichList && synchronizeActivity && previousNetwork !== selectedChainId()) await loadRichList()
				if (isAddress && synchronizeActivity && previousNetwork !== selectedChainId()) await loadAddressProfile()
				return true
			} catch (error) {
				if (!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
				console.error(`Network status refresh failed (${error instanceof Error ? error.name : typeof error})`)
				lastNetworkRequestFailed = true
				if (awaitingResumedNetworkStatus) renderNetworks(latestNetworks)
				updateConnectionStatus()
				networkCards.setAttribute('aria-busy', 'false')
				if (networkCards.childElementCount === 0) networkCards.classList.add('empty')
				updateFreshness()
				return false
			}
		})()
		const tracked = run.finally(() => {
			if (networkLoadPromise === tracked) networkLoadPromise = undefined
		})
		networkLoadPromise = tracked
		return await tracked
	}

	const logKeyFor = (log: LogReference) => `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`

	const rowFor = (log: ActivityRecord) => {
		const key = logKeyFor(log)
		const row = setLiveRecord(element('article', 'log-row'), key, {
			contractLabel: log.contract_label,
			eventName: log.event_name,
			summary: log.summary,
			origin: log.origin_address,
			functionName: log.function_name,
			actionSummary: log.action_summary,
		})
		const chain = element('span', 'cell chain-block')
		const openCue = element('span', 'row-open-cue', '›')
		openCue.setAttribute('aria-hidden', 'true')
		const blockLink = element('span', '', `#${number(log.block_number)}`)
		blockLink.className = 'address-link activity-target'
		chain.append(blockLink, openCue)
		const timestamp = element('time', 'cell cell-time', `${time(log.block_timestamp)} · ${age(log.block_timestamp)}`)
		timestamp.dataset.time = log.block_timestamp
		timestamp.dateTime = exactTimestamp(log.block_timestamp)
		timestamp.title = exactTimestamp(log.block_timestamp)
		const contractLink = element('span')
		contractLink.className = 'cell address-link activity-target activity-contract-link'
		contractLink.title = log.contract_label ? `${log.contract_label} · ${log.emitter_address}` : log.emitter_address
		contractLink.replaceChildren(element('span', 'contract-name', log.contract_label || short(log.emitter_address, 10, 8)))
		const event = element('button', 'cell event-name', log.event_name ?? 'Unknown event')
		event.type = 'button'
		event.setAttribute('aria-label', `Toggle ${log.event_name ?? 'unknown event'} log details from block ${log.block_number}`)
		event.setAttribute('aria-expanded', String(eventDrawerFor(key) !== undefined))
		const tx = element('span', '', `${short(log.tx_hash, 7, 5)} · ${log.log_index}`)
		tx.className = 'cell cell-tx activity-target'
		const origin = element('span', 'cell cell-origin activity-target', log.origin_address ? short(log.origin_address, 6, 4) : '—')
		const action = element('span', 'cell cell-function', log.function_name === 'deploy' ? (log.action_summary ?? 'Deploy contract') : (log.function_name ?? (log.to_address === null ? 'Deploy contract' : 'Unknown call')))
		action.title = `Transaction action: ${log.function_signature ?? log.action_summary ?? action.textContent ?? ''}`
		row.append(chain, timestamp, contractLink, event, action, tx, origin)
		row.addEventListener('click', () => {
			if (eventDrawerFor(key)) closeEventDrawer({ restoreFocus: true, key })
			else void openDetail(log)
		})
		return row
	}

	const queryPath = (cursor: string, limit = 100) => {
		const params = new URLSearchParams({ limit: String(limit) })
		params.set('chainId', requiredChainId())
		if (appliedActivityFilters.event) params.set('event', appliedActivityFilters.event)
		if (appliedActivityFilters.address) params.set('address', appliedActivityFilters.address)
		if (cursor) params.set('cursor', cursor)
		return `/api/v1/logs?${params}`
	}

	const activityFilterValues = () => ({
		event: $('#event-filter').value.trim(),
		address: $('#address-filter').value.trim(),
	})

	const syncActivityFilterUrl = () => {
		const url = new URL(location.href)
		url.searchParams.delete('decoded')
		for (const [name, value] of Object.entries(appliedActivityFilters)) {
			if (typeof value === 'string' && value !== '') url.searchParams.set(name, value)
			else url.searchParams.delete(name)
		}
		const chainId = selectedChainId()
		if (chainId) url.searchParams.set('chainId', chainId)
		else url.searchParams.delete('chainId')
		history.replaceState(null, '', url)
	}

	const validateAddressFilter = (report = false) => {
		const input = $('#address-filter')
		const value = input.value.trim()
		input.setCustomValidity(value === '' || /^0x[0-9a-fA-F]{40}$/.test(value) ? '' : 'Enter a complete 20-byte EVM address (0x plus 40 hexadecimal characters).')
		return report ? input.reportValidity() : input.validity.valid
	}

	const showInvalidAddressFilter = () => {
		feed.replaceChildren()
		feed.setAttribute('aria-busy', 'false')
		feedState.hidden = false
		feedState.textContent = $('#address-filter').validationMessage
		$('#activity-summary').textContent = 'Invalid address filter'
		$('#more').hidden = true
		setLogControlsBusy(false)
	}

	const hasActivityFilters = () => Object.values(activityFilterValues()).some(Boolean)

	const setLogControlsBusy = (busy: boolean) => {
		for (const control of [$('#filters button[type="submit"]'), $('#more')]) control.disabled = busy
		$('#clear-filters').disabled = busy || !hasActivityFilters()
	}

	const performLoadLogs = async ({ append = false, live = false, replaceDepth, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== viewContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		if (!paginationRequestAllowed(append, canonicalRefreshRequired)) {
			$('#more').hidden = true
			$('#more').disabled = true
			return false
		}
		logsAbortController?.abort()
		logsAbortController = new AbortController()
		const requestSignal = logsAbortController?.signal
		const requestVersion = ++logsRequestVersion
		const moreButton = $('#more')
		const paginationStatus = $('#activity-more-status')
		const hadRows = feed.querySelector<HTMLElement>('.log-row') !== null
		const previousRows = liveSnapshot(feed, '.log-row[data-live-key]')
		const presentation = refreshPresentation({ live, append })
		feed.setAttribute('aria-busy', String(presentation.busy))
		setLogControlsBusy(presentation.busy)
		if (append) {
			paginationStatus.hidden = true
			paginationStatus.replaceChildren()
			moreButton.hidden = false
			moreButton.setAttribute('aria-busy', 'true')
			moreButton.textContent = 'Loading more…'
		}
		if (!append && !hadRows) $('#more').hidden = true
		if (presentation.loadingState && !append) {
			feedState.hidden = false
			feedState.textContent = hadRows ? 'Refreshing activity…' : 'Loading activity…'
		}
		if (presentation.loadingState && !append && !hadRows) feed.replaceChildren(...Array.from({ length: 6 }, () => element('div', 'loading-line')))
		try {
			const payload =
				!append && replaceDepth !== undefined
					? await collectCanonicalPages(async (cursor, limit) => decodeItemsPage(await api(queryPath(cursor ?? '', limit), { signal: requestSignal }), isActivityRecord, 'Activity'), replaceDepth, logKeyFor)
					: decodeItemsPage(await api(queryPath(append ? (nextCursor ?? '') : '')), isActivityRecord, 'Activity')
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			const anchor = live && window.scrollY >= 420 ? [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].find(row => row.getBoundingClientRect().bottom > 0) : undefined
			const anchorKey = anchor?.dataset.liveKey
			const anchorTop = anchor?.getBoundingClientRect().top
			const renderScrollY = window.scrollY
			const retainedDrawers = append ? [] : eventDrawers()
			const activeDrawer = retainedDrawers.find(drawer => drawer.contains(document.activeElement)) ?? retainedDrawers[0]
			const activeDrawerContext = activeDrawer ? captureDetailContext(activeDrawer) : undefined
			if (!append) {
				for (const drawer of retainedDrawers) drawer.remove()
				feed.replaceChildren()
			}
			const refreshedKeys = new Set(append ? [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].flatMap(row => (row.dataset.liveKey === undefined ? [] : [row.dataset.liveKey])) : [])
			for (const log of payload.items) {
				const row = rowFor(log)
				const rowKey = row.dataset.liveKey
				if (rowKey !== undefined && refreshedKeys.has(rowKey)) continue
				if (rowKey !== undefined) refreshedKeys.add(rowKey)
				feed.append(row)
			}
			applyLiveChanges(feed, previousRows, { live, selector: '.log-row[data-live-key]' })
			for (const drawer of retainedDrawers) placeEventDrawer(drawer, { allowOutsideShellFallback: false })
			const drawerReanchored = activeDrawer?.isConnected ?? false
			updateLogDisclosures()
			if (activeDrawer && !drawerReanchored) {
				detailContextVersion++
				detailRequestVersion++
				activeLog = undefined
				pendingCanonicalLog = undefined
				if (activeReorgRecovery !== undefined) activeReorgRecovery.logToRefresh = undefined
				clearDetailUrl()
			}
			if (live) window.scrollTo({ top: renderScrollY, behavior: 'instant' })
			if (anchorKey !== undefined && anchorTop !== undefined) {
				const currentAnchor = [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].find(row => row.dataset.liveKey === anchorKey)
				if (currentAnchor !== undefined) window.scrollBy(0, currentAnchor.getBoundingClientRect().top - anchorTop)
			}
			if (drawerReanchored && activeDrawerContext) restoreDetailContext(activeDrawerContext, activeDrawer)
			nextCursor = payload.nextCursor
			$('#more').hidden = !retainedPaginationAvailable(nextCursor !== undefined, canonicalRefreshRequired)
			paginationStatus.hidden = true
			paginationStatus.replaceChildren()
			const visibleCount = visibleActivityLogCount(feed)
			feedState.hidden = visibleCount > 0
			if (visibleCount === 0) feedState.textContent = 'No project logs match these filters yet.'
			$('#activity-summary').textContent = visibleCount === 0 ? '' : `${visibleCount} log${visibleCount === 1 ? '' : 's'} shown`
			return true
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') return false
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			if (!append && !hadRows) feed.replaceChildren()
			$('#more').hidden = !retainedPaginationAvailable(nextCursor !== undefined, canonicalRefreshRequired)
			const retryAction = () => (canonicalRefreshRequired ? requestRouteRefresh(1, true) : loadLogs({ append }))
			if (append) {
				const visibleCount = visibleActivityLogCount(feed)
				feedState.hidden = visibleCount > 0
				$('#activity-summary').textContent = `${visibleCount} logs shown · could not load more`
				renderRetryStatus(paginationStatus, `Could not load more activity; showing logs: ${errorMessage(error)}`, retryAction)
				moreButton.hidden = true
			} else {
				feedState.hidden = false
				const message = element('span', '', hadRows ? `Showing last known activity: ${errorMessage(error)}` : `Activity unavailable: ${errorMessage(error)}`)
				const visibleCount = visibleActivityLogCount(feed)
				$('#activity-summary').textContent = hadRows ? `${visibleCount} logs shown · refresh failed` : ''
				const retry = element('button', 'state-retry', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', retryAction)
				feedState.replaceChildren(message, retry)
			}
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion)) {
				feed.setAttribute('aria-busy', 'false')
				setLogControlsBusy(false)
				if (canonicalRefreshRequired) {
					moreButton.hidden = true
					moreButton.disabled = true
				}
				moreButton.removeAttribute('aria-busy')
				moreButton.textContent = 'Show more'
			}
		}
	}

	const loadLogs = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = viewContextVersion
		const paginationIntentVersion = options.append === true ? ++activityPaginationIntentVersion : undefined
		if (paginationIntentVersion !== undefined) {
			const more = $('#more')
			const presentation = queuedPaginationPresentation(canonicalRefreshRequired)
			more.hidden = presentation.hidden
			more.disabled = presentation.disabled
			more.textContent = presentation.label
			if (presentation.busy) more.setAttribute('aria-busy', 'true')
			else more.removeAttribute('aria-busy')
			$('#activity-more-status').hidden = true
			$('#activity-more-status').replaceChildren()
		}
		const operation = () => {
			const { retainVisibleDepth, ...loadOptions } = options
			const replaceDepth = retainVisibleDepth ? resolveActivityRefreshDepth(loadOptions.replaceDepth, pendingCanonicalActivityCount, feed.querySelectorAll<HTMLElement>('.log-row').length) : loadOptions.replaceDepth
			return performLoadLogs({ ...loadOptions, replaceDepth, contextVersion })
		}
		const request = options.live === true ? logRefreshGate.runBackground(operation) : logRefreshGate.runForeground(operation)
		if (paginationIntentVersion !== undefined) {
			const clearPending = () => {
				if (paginationIntentVersion !== activityPaginationIntentVersion || contextVersion !== viewContextVersion) return
				const more = $('#more')
				more.removeAttribute('aria-busy')
				more.textContent = 'Show more'
				more.disabled = canonicalRefreshRequired
				if (canonicalRefreshRequired) more.hidden = true
			}
			void request.then(clearPending, clearPending)
		}
		return request
	}

	const detailCard = (term: string, description: string, wide = false) => {
		const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
		card.append(element('dt', '', term), element('dd', '', description ?? '—'))
		return card
	}

	const explorerDetailCard = (term: string, base: string, type: string, value: string, label = value) => {
		const card = element('dl', 'detail-card')
		const description = element('dd')
		description.append(explorerLink(base, type, value, label))
		card.append(element('dt', '', term), description)
		return card
	}

	const addressDetailCard = (term: string, address: string | null | undefined, { knownLabel, chainId, wide = false }: { knownLabel?: string | null; chainId?: string; wide?: boolean } = {}) => {
		const card = element('dl', `detail-card${wide ? ' wide' : ''}`)
		const description = element('dd')
		if (address) description.append(protocolAddressLink(address, { knownLabel, chainId }))
		else description.textContent = '—'
		card.append(element('dt', '', term), description)
		return card
	}

	const explorerLink = (base: string, type: string, value: string | number, label: string) => {
		const link = element('a', 'explorer-link', label)
		link.href = `${String(base).replace(/\/$/, '')}/${type}/${value}`
		link.target = '_blank'
		link.rel = 'noreferrer'
		return link
	}

	const usableAddressLabel = (label: unknown): string | undefined => (typeof label === 'string' && label.length > 0 && !label.toLowerCase().startsWith('unknown') ? label : undefined)

	const addressIdentityKey = (chainId: string, address: string) => `${chainId}:${address.toLowerCase()}`

	const invalidateAddressIdentityCache = (chainId: string, missesOnly = false): void => {
		const prefix = `${chainId}:`
		for (const [key, value] of addressIdentityCache) {
			if (key.startsWith(prefix) && (!missesOnly || typeof value !== 'string')) addressIdentityCache.delete(key)
		}
	}

	const resolveAddressLabel = async (chainId: string, address: string): Promise<string | undefined> => {
		const key = addressIdentityKey(chainId, address)
		const cached = addressIdentityCache.get(key)
		if (typeof cached === 'string') return cached
		if (cached === false) return undefined
		if (cached) return await cached
		const pending = api(`/api/v1/address-identity?${new URLSearchParams({ chainId: String(chainId), address })}`)
			.then(value => decodeValue(value, isAddressIdentity, 'Address identity'))
			.then(identity => {
				const resolved = usableAddressLabel(identity.label)
				if (addressIdentityCache.get(key) !== pending) return undefined
				addressIdentityCache.set(key, resolved ?? false)
				return resolved
			})
			.catch(() => {
				if (addressIdentityCache.get(key) !== pending) return undefined
				addressIdentityCache.delete(key)
				return undefined
			})
		addressIdentityCache.set(key, pending)
		return await pending
	}

	const protocolAddressLink = (address: string | null, { knownLabel, chainId = selectedChainId(), className = 'address-link', compact = false }: ProtocolAddressLinkOptions = {}) => {
		const resolvedAddress = address ?? ''
		const key = addressIdentityKey(chainId, resolvedAddress)
		const suppliedLabel = usableAddressLabel(knownLabel)
		const cachedLabel = addressIdentityCache.get(key)
		const canonicalLabel = typeof cachedLabel === 'string' ? cachedLabel : undefined
		const displayLabel = canonicalLabel ?? suppliedLabel
		const link = element('a', className, displayLabel ?? (compact ? short(resolvedAddress, 10, 8) : resolvedAddress))
		const params = new URLSearchParams({ chainId: String(chainId), address: resolvedAddress })
		if (isDemo) params.set('demo', '1')
		link.href = `/address?${params}`
		link.title = displayLabel ? `${displayLabel} · ${resolvedAddress}` : resolvedAddress
		if (!canonicalLabel) {
			void resolveAddressLabel(chainId, resolvedAddress).then(resolvedLabel => {
				if (!resolvedLabel) return
				link.textContent = resolvedLabel
				link.title = `${resolvedLabel} · ${resolvedAddress}`
			})
		}
		return link
	}

	const decodedValueNode = (rawValue: unknown, displayValue: unknown, chainId: string) => {
		const node = element('span', 'decoded-value')
		if (typeof rawValue === 'string' && /^0x[0-9a-fA-F]{40}$/.test(rawValue)) {
			node.append(protocolAddressLink(rawValue, { chainId }))
			return node
		}
		if (Array.isArray(rawValue)) {
			node.append(document.createTextNode('['))
			rawValue.forEach((value, index) => {
				if (index > 0) node.append(document.createTextNode(', '))
				node.append(decodedValueNode(value, Array.isArray(displayValue) ? displayValue[index] : undefined, chainId))
			})
			node.append(document.createTextNode(']'))
			return node
		}
		if (isRecord(rawValue)) {
			node.append(document.createTextNode('{ '))
			Object.entries(rawValue).forEach(([key, value], index) => {
				if (index > 0) node.append(document.createTextNode(', '))
				node.append(document.createTextNode(`${key}: `), decodedValueNode(value, isRecord(displayValue) ? displayValue[key] : undefined, chainId))
			})
			node.append(document.createTextNode(' }'))
			return node
		}
		const rendered = displayValue !== undefined && displayValue !== null && typeof displayValue !== 'object' ? displayValue : rawValue
		node.textContent = rendered === undefined || rendered === null ? '—' : String(rendered)
		return node
	}

	const decodedArgumentsTable = (schema: ArgumentDefinition[] | null | undefined, rawArguments: Record<string, unknown> | null | undefined, displayArguments: Record<string, unknown> | null | undefined, chainId: string) => {
		const raw = rawArguments ?? {}
		const display = displayArguments ?? {}
		const entries: ArgumentDefinition[] = schema?.length ? schema.toSorted((left, right) => left.index - right.index) : Object.keys(raw).map((name, index) => ({ index, name, type: 'unknown' }))
		const table = element('table', 'arguments')
		const head = element('thead')
		const headRow = element('tr')
		for (const label of ['# / Name', 'Solidity type', 'Value']) headRow.append(element('th', '', label))
		head.append(headRow)
		const body = element('tbody')
		for (const entry of entries) {
			const rawValue = raw[entry.name]
			const row = element('tr')
			const nameCell = element('td', '', `#${number(entry.index)} · ${entry.name}`)
			nameCell.dataset.label = '# / Name'
			const typeCell = element('td', '', `${entry.type}${entry.indexed ? ' · indexed' : ''}`)
			typeCell.dataset.label = 'Solidity type'
			const displayCell = element('td')
			displayCell.dataset.label = 'Value'
			displayCell.append(decodedValueNode(rawValue, display[entry.name], chainId))
			row.append(nameCell, typeCell, displayCell)
			body.append(row)
		}
		table.append(head, body)
		return table
	}

	const eventDrawers = () => [...document.querySelectorAll<HTMLElement>('.event-detail-drawer')]

	const eventDrawerFor = (key: string) => eventDrawers().find(drawer => drawer.dataset.triggerKey === key)

	const drawerRequests = new WeakMap<HTMLElement, number>()

	const drawerLogs = new WeakMap<HTMLElement, ActivityRecord | LogReference>()

	const updateLogDisclosures = () => {
		for (const row of feed.querySelectorAll<HTMLElement>('.log-row')) row.querySelector('.event-name')?.setAttribute('aria-expanded', String(eventDrawerFor(row.dataset.liveKey ?? '') !== undefined))
	}

	const removeEventDrawers = () => {
		for (const drawer of eventDrawers()) drawer.remove()
		updateLogDisclosures()
	}

	const closeEventDrawer = ({ clearUrl = true, restoreFocus = false, key }: { clearUrl?: boolean; restoreFocus?: boolean; key?: string } = {}) => {
		const drawer = key === undefined ? eventDrawers().at(-1) : eventDrawerFor(key)
		const triggerKey = drawer?.dataset.triggerKey
		if (key === undefined) {
			detailContextVersion++
			detailRequestVersion++
			removeEventDrawers()
		} else {
			drawer?.remove()
		}
		if (activeLog && (key === undefined || logKeyFor(activeLog) === key)) {
			activeLog = undefined
			pendingCanonicalLog = undefined
			if (activeReorgRecovery !== undefined) activeReorgRecovery.logToRefresh = undefined
		}
		updateLogDisclosures()
		if (clearUrl && (key === undefined || new URL(location.href).searchParams.get('log') === key)) clearDetailUrl()
		if (restoreFocus && triggerKey)
			[...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')]
				.find(row => row.dataset.liveKey === triggerKey)
				?.querySelector<HTMLElement>('button')
				?.focus({ preventScroll: true })
	}

	const captureDetailContext = (drawer = eventDrawers().find(item => item.contains(document.activeElement)) ?? eventDrawers()[0]): DetailContextSnapshot => {
		if (!drawer) return { scrollTop: window.scrollY, drawerFocused: false, focusIndex: -1 }
		return { scrollTop: window.scrollY, ...captureActivityDetailFocus(drawer, document.activeElement) }
	}

	const restoreDetailContext = (snapshot: DetailContextSnapshot, drawer = eventDrawers()[0]) => {
		if (!drawer) return
		window.scrollTo({ top: snapshot.scrollTop })
		restoreActivityDetailFocus(drawer, snapshot, (nextFocus, previousTop) => window.scrollBy(0, nextFocus.getBoundingClientRect().top - previousTop))
	}

	const placeEventDrawer = (drawer: HTMLElement, { allowOutsideShellFallback = true } = {}): boolean => {
		const feedShell = feed.closest<HTMLElement>('.feed-shell')
		if (feedShell) drawer.style.width = `${feedShell.clientWidth}px`
		else drawer.style.removeProperty('width')
		if (placeActivityDetailDrawer(feed, drawer)) {
			updateLogDisclosures()
			return true
		}
		if (allowOutsideShellFallback && feedShell && drawer.previousElementSibling !== feedShell) {
			feedShell.after(drawer)
			return true
		}
		return false
	}

	const collapsibleDetailCard = (title: string, disclosureKey: string, ...content: Node[]): HTMLDetailsElement => {
		const card = element('details', 'detail-card detail-disclosure wide')
		card.dataset.disclosureKey = disclosureKey
		card.append(element('summary', '', title), ...content)
		return card
	}

	const detailContextIsUnchanged = (snapshot: DetailContextSnapshot, drawer: HTMLElement): boolean => {
		if (Math.abs(window.scrollY - snapshot.scrollTop) > 1) return false
		if (snapshot.drawerFocused) return document.activeElement === drawer
		if (snapshot.focusIndex < 0) return true
		const focusable = drawer ? [...drawer.querySelectorAll<HTMLElement>('a, button, summary')] : []
		return document.activeElement === focusable[snapshot.focusIndex]
	}

	const performOpenDetail = async (log: ActivityRecord | LogReference, { live = false, canonicalRecovery = false, contextVersion }: DetailOptions = {}): Promise<boolean> => {
		if (contextVersion !== detailContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		const existingDrawer = eventDrawerFor(logKeyFor(log))
		const drawer = existingDrawer ?? element('section', 'event-detail-drawer')
		const requestVersion = (drawerRequests.get(drawer) ?? 0) + 1
		drawerRequests.set(drawer, requestVersion)
		drawerLogs.set(drawer, log)
		const requestIsCurrent = () => drawer.isConnected && drawerRequests.get(drawer) === requestVersion && contextVersion === detailContextVersion && isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		const previousContext = live ? captureDetailContext(drawer) : undefined
		if (isActivityRecord(log)) activeLog = log
		if (!canonicalRecovery && isActivityRecord(log)) {
			pendingCanonicalLog = activeReorgRecovery === undefined && !canonicalRefreshRequired ? undefined : log
			if (activeReorgRecovery !== undefined) {
				activeReorgRecovery.logToRefresh = log
				activeReorgRecovery.accountToRefresh = undefined
			}
		}
		pendingCanonicalAccount = undefined
		pendingAccountDialogSnapshot = undefined
		activeAccount = undefined
		activeAccountTransactions = undefined
		activeAccountLoadMore = undefined
		drawer.setAttribute('aria-label', 'Event details')
		const drawerContent = existingDrawer?.querySelector<HTMLElement>('.event-detail-content') ?? element('div', 'event-detail-content')
		if (!existingDrawer) {
			const canonicalStatus = element('div', 'detail-canonical-status event-detail-canonical-status')
			canonicalStatus.hidden = true
			canonicalStatus.setAttribute('role', 'status')
			canonicalStatus.setAttribute('aria-live', 'polite')
			drawer.append(canonicalStatus, drawerContent)
		}
		drawer.dataset.triggerKey = logKeyFor(log)
		updateLogDisclosures()
		placeEventDrawer(drawer)
		syncCanonicalDialogStatus()
		drawerContent.setAttribute('aria-busy', String(refreshPresentation({ live }).busy))
		if (!live) {
			const loading = element('p', 'detail-status', 'Loading event details…')
			loading.setAttribute('role', 'status')
			drawerContent.replaceChildren(loading, element('div', 'loading-line'))
			drawer.tabIndex = -1
			drawer.focus({ preventScroll: true })
		}
		if (!live) {
			const url = new URL(location.href)
			url.searchParams.delete('account')
			url.searchParams.set('log', logKeyFor(log))
			history.replaceState(null, '', url)
		}
		try {
			const detail = decodeValue(await api(`/api/v1/logs/${log.chain_id}/${log.block_hash}/${log.tx_hash}/${log.log_index}`), isLogDetail, 'Log detail')
			if (!requestIsCurrent()) return false
			activeLog = detail
			const deployedContractAddress = typeof detail.receipt['contractAddress'] === 'string' ? detail.receipt['contractAddress'] : undefined
			const disclosureState = live ? captureDisclosureState(drawerContent) : {}
			const grid = element('div', 'detail-grid')
			grid.append(
				detailCard('Event signature', detail.event_signature ?? 'No matching ABI'),
				detailCard('Block hash', detail.block_hash),
				detailCard('Occurrence position', `transaction ${number(detail.transaction_index)} · log ${number(detail.log_index)}`),
				addressDetailCard('msg.origin', detail.origin_address, { chainId: detail.chain_id }),
				addressDetailCard('To', detail.to_address, { chainId: detail.chain_id }),
				detailCard('Gas used', number(detail.gas_used)),
				detailCard('Transaction action', decodedActionLabel(detail.action_summary, detail.to_address, detail.contract_label, detail.emitter_address, deployedContractAddress)),
			)
			const contractCard = explorerDetailCard('Contract', detail.explorer_base_url, 'address', detail.emitter_address)
			contractCard.querySelector('a')?.classList.add('event-contract-link')
			grid.prepend(contractCard, explorerDetailCard('Block', detail.explorer_base_url, 'block', detail.block_number, `#${number(detail.block_number)}`), explorerDetailCard('Transaction', detail.explorer_base_url, 'tx', detail.tx_hash))
			const argumentsCard = element('div', 'detail-card wide')
			argumentsCard.append(element('p', 'eyebrow', 'Decoded arguments'))
			argumentsCard.append(decodedArgumentsTable(detail.argument_schema, detail.arguments, detail.display_arguments, detail.chain_id))
			grid.append(argumentsCard)
			const actionContent: Node[] = []
			if (detail.action_arguments && Object.keys(detail.action_arguments).length > 0) actionContent.push(decodedArgumentsTable(detail.action_argument_schema, detail.action_arguments, detail.action_display_arguments, detail.chain_id))
			actionContent.push(element('pre', 'raw', JSON.stringify({ input: detail.input, function: detail.function_signature, arguments: detail.action_arguments }, null, 2)))
			grid.append(collapsibleDetailCard('Transaction calldata and decoded action', 'transaction-action', ...actionContent))
			grid.append(collapsibleDetailCard('Complete raw transaction receipt', 'transaction-receipt', element('pre', 'raw', JSON.stringify(detail.receipt, null, 2))))
			restoreDisclosureState(grid, disclosureState)
			const contextToRestore = captureDetailContext(drawer)
			if (!live || !drawerContent.firstElementChild?.isEqualNode(grid)) drawerContent.replaceChildren(grid)
			placeEventDrawer(drawer)
			if (contextToRestore) restoreDetailContext(contextToRestore, drawer)
			if (canonicalRecovery) pendingCanonicalLog = undefined
			return true
		} catch (error) {
			if (!requestIsCurrent()) return false
			const noncanonical = isNoncanonicalDetailFailure(canonicalRecovery, error instanceof Error ? error.status : undefined)
			if (canonicalRecovery && !noncanonical && canonicalRefreshRequired) {
				drawerContent.querySelector<HTMLElement>('.detail-refresh-error')?.remove()
				if (previousContext && detailContextIsUnchanged(previousContext, drawer)) restoreDetailContext(previousContext, drawer)
				return false
			}
			const alert = element('div', `detail-error${live ? ' detail-refresh-error' : ''}`)
			alert.setAttribute('role', 'alert')
			alert.append(element('p', '', noncanonical ? 'This log was replaced after the chain changed.' : `Could not open log: ${errorMessage(error)}`))
			const retry = element('button', 'state-retry', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', () => openDetail(log, { live: !noncanonical, canonicalRecovery }))
			if (!noncanonical) alert.append(retry)
			if (live && !noncanonical) {
				const contextToRestore = drawerContent.contains(document.activeElement) ? captureDetailContext(drawer) : undefined
				drawerContent.querySelector<HTMLElement>('.detail-refresh-error')?.remove()
				drawerContent.prepend(alert)
				if (contextToRestore) restoreDetailContext(contextToRestore, drawer)
			} else drawerContent.replaceChildren(alert)
			if (noncanonical) pendingCanonicalLog = undefined
			return noncanonical
		} finally {
			if (requestIsCurrent()) drawerContent.setAttribute('aria-busy', 'false')
		}
	}

	const openDetail = (log: ActivityRecord | LogReference, options: DetailOptions = {}): Promise<boolean> => {
		if (options.live === true && eventDrawerFor(logKeyFor(log)) === undefined) return Promise.resolve(true)
		if (options.live !== true) detailRequestVersion++
		return performOpenDetail(log, { ...options, contextVersion: detailContextVersion })
	}

	const restorePendingCanonicalLog = async () => {
		if (pendingCanonicalLog === undefined) return true
		return await openDetail(pendingCanonicalLog, { live: document.querySelector('.event-detail-drawer') !== null, canonicalRecovery: true })
	}

	const captureAccountDialogSnapshot = (): DialogSnapshot | undefined => {
		if (activeAccountTransactions === undefined) return undefined
		const cards = [...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')]
		const focusedCard = document.activeElement?.closest<HTMLElement>('.account-transaction[data-live-key]')
		const focusable = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
		const anchorCard = focusedCard ?? cards.find(card => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
		return {
			loadedCount: activeAccountTransactions.loaded.length,
			expandedKeys: [...detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].flatMap(action => {
				const key = action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey
				return key === undefined ? [] : [key]
			}),
			anchorKey: anchorCard?.dataset.liveKey,
			anchorTop: anchorCard?.getBoundingClientRect().top,
			focusKey: focusedCard?.dataset.liveKey,
			focusIndex: document.activeElement instanceof HTMLElement ? focusable.indexOf(document.activeElement) : -1,
			outsideFocus: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.liveFocus : undefined,
			scrollTop: dialog.scrollTop,
		}
	}

	const restoreAccountDialogSnapshot = (snapshot: DialogSnapshot) => {
		const availableKeys = new Set([...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')].flatMap(card => (card.dataset.liveKey === undefined ? [] : [card.dataset.liveKey])))
		const reconciled = reconcileTransactionDialogSnapshot(snapshot, availableKeys)
		for (const key of reconciled.expandedKeys) {
			if (key === undefined) continue
			const card = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(key)}"]`)
			const action = card?.querySelector<HTMLDetailsElement>('.account-transaction-action')
			if (action) action.open = true
		}
		dialog.scrollTop = reconciled.scrollTop ?? snapshot.scrollTop
		if (reconciled.anchorKey && reconciled.anchorTop !== undefined) {
			const anchor = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(reconciled.anchorKey)}"]`)
			if (anchor) dialog.scrollTop += anchor.getBoundingClientRect().top - reconciled.anchorTop
		}
		if (reconciled.focusKey && reconciled.focusIndex >= 0) {
			const focusedCard = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(reconciled.focusKey)}"]`)
			const focusable = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
			focusable[reconciled.focusIndex]?.focus({ preventScroll: true })
		} else if (reconciled.outsideFocus) {
			detailContent.querySelector<HTMLElement>(`[data-live-focus="${CSS.escape(reconciled.outsideFocus)}"]`)?.focus({ preventScroll: true })
		}
	}

	const stagedAccountDialogSnapshot = (canonicalRecovery: boolean, stagedLiveRefresh: boolean, restoreSnapshot: DialogSnapshot | undefined) => {
		if (canonicalRecovery) return restoreSnapshot
		return stagedLiveRefresh ? captureAccountDialogSnapshot() : undefined
	}

	const performOpenAccountTransactions = async (account: AccountReference, { live = false, restoreSnapshot, canonicalRecovery = false, contextVersion }: AccountDetailOptions = {}): Promise<boolean> => {
		if (contextVersion !== detailContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		const pageReservation = accountPageRefreshGate.reserve()
		await pageReservation.ready
		if (contextVersion !== detailContextVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
			pageReservation.release()
			await pageReservation.completed
			return false
		}
		const previousState = activeAccountTransactions
		const previousLoadMore = activeAccountLoadMore
		const stateKey = `${account.chain_id}:${account.address.toLowerCase()}`
		const previousMatches = previousState?.key === stateKey
		const requestVersion = live && previousMatches ? detailRequestVersion : ++detailRequestVersion
		const stagedLiveRefresh = !canonicalRecovery && live && previousMatches
		const stagedRefresh = canonicalRecovery || stagedLiveRefresh
		const stagedSnapshot = stagedAccountDialogSnapshot(canonicalRecovery, stagedLiveRefresh, restoreSnapshot)
		const refreshPrevious = stagedRefresh ? liveSnapshot(detailContent, '.account-transaction[data-live-key]') : undefined
		activeLog = undefined
		removeEventDrawers()
		pendingCanonicalLog = undefined
		if (restoreSnapshot === undefined && !live) {
			pendingCanonicalAccount = activeReorgRecovery === undefined && !canonicalRefreshRequired ? undefined : account
			pendingAccountDialogSnapshot = undefined
			if (activeReorgRecovery !== undefined) {
				activeReorgRecovery.logToRefresh = undefined
				activeReorgRecovery.accountToRefresh = account
			}
		}
		activeAccount = account
		if (!dialog.open) dialog.showModal()
		syncCanonicalDialogStatus()
		$('#detail-eyebrow').textContent = 'Account activity'
		$('#detail-title').textContent = 'Sent transactions'
		const url = new URL(location.href)
		url.searchParams.delete('log')
		if (isRichList) url.searchParams.set('account', `${account.chain_id}:${account.address}`)
		else url.searchParams.delete('account')
		history.replaceState(null, '', url)
		const state =
			!stagedRefresh && live && previousMatches
				? previousState
				: {
						key: stateKey,
						account,
						loaded: [],
						total: 0,
						nextPageCursor: undefined,
						pageLoading: false,
						pageError: undefined,
						pageErrorAppend: false,
					}
		state.account = account
		activeAccountTransactions = accountStateDuringStagedRefresh(previousState, state, stagedRefresh)
		interface AccountRenderOptions {
			previous?: ReadonlyMap<string, string>
			highlight?: boolean
		}

		const render = ({ previous = new Map<string, string>(), highlight = false }: AccountRenderOptions = {}) => {
			const focusedCard = document.activeElement?.closest<HTMLElement>('.account-transaction[data-live-key]')
			const focusedTransactionKey = focusedCard?.dataset.liveKey
			const focusedControls = focusedCard ? [...focusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
			const focusedControlIndex = document.activeElement instanceof HTMLElement ? focusedControls.indexOf(document.activeElement) : -1
			const outsideFocusKey = focusedCard || !(document.activeElement instanceof HTMLElement) ? undefined : document.activeElement.dataset.liveFocus
			const visibleCards = [...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')]
			const anchorCard = focusedCard ?? visibleCards.find(card => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
			const anchorKey = anchorCard?.dataset.liveKey
			const anchorTop = anchorCard?.getBoundingClientRect().top
			const openTransactionKeys = new Set([...detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].map(action => action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey))
			const header = element('div', 'account-transactions-header')
			header.append(element('p', 'eyebrow', 'Sent transactions'), element('h3', '', state.account.label ?? state.account.address), element('code', '', state.account.address), element('p', 'data-note', `${number(state.loaded.length)} of ${number(state.total)} sent transactions`))
			const list = element('div', 'account-transactions')
			for (const transaction of state.loaded) {
				const transactionKey = `${transaction.chain_id}:${transaction.tx_hash}`
				const card = setLiveRecord(element('article', 'account-transaction'), transactionKey, transaction)
				const cardHeader = element('div', 'account-transaction-header')
				cardHeader.append(explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 12, 8)), element('span', `badge${transaction.status === 'success' ? '' : ' transaction-failed'}`, transaction.status ?? 'unknown'))
				const destination = transaction.to_label ? `${transaction.to_label} · ${short(transaction.to_address, 8, 6)}` : (transaction.to_address ?? 'Contract creation')
				const detailGrid = element('dl', 'account-transaction-fields')
				for (const [term, value] of [
					['Block', `#${number(transaction.block_number)} · ${exactTimestamp(transaction.block_timestamp).slice(0, 10)} · ${time(transaction.block_timestamp)} UTC`],
					['To', destination],
					['Value', exactUnit(transaction.value, 18, nativeSymbol(transaction.chain_id), 2)],
					['Gas used', number(transaction.gas_used)],
					['Action', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'],
				]) {
					const field = element('div')
					const description = element('dd', '', term === 'To' && transaction.to_address ? undefined : value)
					if (term === 'To' && transaction.to_address)
						description.append(
							protocolAddressLink(transaction.to_address, {
								knownLabel: transaction.to_label,
								chainId: transaction.chain_id,
								className: 'address-link',
							}),
						)
					field.append(element('dt', '', term), description)
					detailGrid.append(field)
				}
				card.append(cardHeader, detailGrid)
				if (transaction.action_display_arguments && Object.keys(transaction.action_display_arguments).length > 0) {
					const action = element('details', 'account-transaction-action')
					action.open = openTransactionKeys.has(transactionKey)
					const argumentsContent = element('div', 'account-transaction-arguments')
					argumentsContent.append(decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id))
					const summary = element('summary', '', 'Decoded arguments')
					summary.dataset.liveFocus = 'decoded-arguments'
					action.append(summary, argumentsContent)
					card.append(action)
				}
				list.append(card)
			}
			if (state.loaded.length === 0) list.append(element('p', 'state-placeholder', 'No sent transactions were found.'))
			const more = element('button', 'secondary account-transactions-more', state.pageLoading ? 'Loading more transactions…' : 'Show more transactions')
			more.type = 'button'
			more.dataset.liveFocus = 'show-more-transactions'
			more.hidden = canonicalRefreshRequired || state.nextPageCursor === undefined || (state.pageError !== undefined && state.pageErrorAppend)
			more.disabled = canonicalRefreshRequired || state.pageLoading
			more.addEventListener('click', () => activeAccountLoadMore?.())
			const content: Node[] = [header]
			let transactionError: HTMLDivElement | undefined
			if (state.pageError) {
				transactionError = element('div', `detail-error account-transactions-error${state.pageErrorAppend ? ' append-error' : ''}`)
				transactionError.setAttribute('role', 'alert')
				transactionError.append(element('p', '', state.pageError))
				const retry = element('button', 'state-retry', 'Retry loading transactions')
				retry.type = 'button'
				retry.addEventListener('click', () => {
					if (pendingCanonicalAccount && pendingAccountDialogSnapshot) return restorePendingCanonicalAccount()
					const retryMode = transactionRetryMode(state.pageErrorAppend, state.loaded.length > 0)
					return loadPage(retryMode.append, { liveRefresh: retryMode.liveRefresh })
				})
				transactionError.append(retry)
				if (!state.pageErrorAppend) content.push(transactionError)
			}
			content.push(list)
			if (transactionError !== undefined && state.pageErrorAppend) content.push(transactionError)
			content.push(more)
			detailContent.replaceChildren(...content)
			const nextAnchor = anchorKey ? detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(anchorKey)}"]`) : undefined
			if (nextAnchor && anchorTop !== undefined) dialog.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop
			if (focusedTransactionKey && focusedControlIndex >= 0) {
				const nextFocusedCard = detailContent.querySelector<HTMLElement>(`[data-live-key="${CSS.escape(focusedTransactionKey)}"]`)
				const nextControls = nextFocusedCard ? [...nextFocusedCard.querySelectorAll<HTMLElement>('a, button, summary')] : []
				nextControls[focusedControlIndex]?.focus({ preventScroll: true })
			} else if (outsideFocusKey === 'show-more-transactions') {
				detailContent.querySelector<HTMLElement>('[data-live-focus="show-more-transactions"]')?.focus({ preventScroll: true })
			}
			applyLiveChanges(list, previous, { live: highlight, selector: '.account-transaction[data-live-key]' })
		}
		interface AccountPageOptions {
			liveRefresh?: boolean
			background?: boolean
			stageOnly?: boolean
			limit?: number
			restartInvalidSnapshot?: boolean
		}
		const performLoadPage = async (append = false, { liveRefresh = false, background = false, stageOnly = false, limit = 50, restartInvalidSnapshot = true }: AccountPageOptions = {}) => {
			if (state.pageLoading) return false
			if (!stageOnly && !paginationRequestAllowed(append, canonicalRefreshRequired)) {
				const more = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
				if (more !== null) {
					more.hidden = true
					more.disabled = true
				}
				return false
			}
			state.pageLoading = true
			state.pageError = undefined
			state.pageErrorAppend = false
			detailContent.setAttribute('aria-busy', String(refreshPresentation({ live: background, append }).busy))
			const previous = liveSnapshot(detailContent, '.account-transaction[data-live-key]')
			const previousLoaded = state.loaded
			const previousTotal = state.total
			const previousCursor = state.nextPageCursor
			if (!append && !liveRefresh && !stageOnly && state.loaded.length === 0) {
				const loading = element('p', 'detail-status', 'Loading sent transactions…')
				loading.setAttribute('role', 'status')
				detailContent.replaceChildren(loading, element('div', 'loading-line'))
			} else if (append && !stageOnly) render()
			try {
				const query = new URLSearchParams({
					chainId: String(state.account.chain_id),
					address: state.account.address,
					limit: String(limit),
				})
				if (append && state.nextPageCursor) query.set('cursor', state.nextPageCursor)
				const result = decodeItemsPage(await api(`/api/v1/address-transactions?${query}`), isAccountTransaction, 'Address transactions')
				if (contextVersion !== detailContextVersion || !isCurrentLiveRequest(requestVersion, detailRequestVersion, state.account.chain_id, selectedChainId()) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
					state.pageLoading = false
					return false
				}
				const retained = append || liveRefresh ? previousLoaded : []
				state.loaded = mergeUniqueRecords(append ? retained : result.items, append ? result.items : retained, transaction => `${transaction.chain_id}:${transaction.tx_hash}`)
				state.total = reconcilePaginatedTotal(state.total, result.total ?? state.total, append)
				state.nextPageCursor = liveRefresh && previousCursor !== undefined ? previousCursor : result.nextCursor
				if (state.loaded.length >= state.total) state.nextPageCursor = undefined
				state.pageLoading = false
				if (!stageOnly) render({ previous, highlight: liveRefresh })
				return true
			} catch (error) {
				if (!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
					state.pageLoading = false
					return false
				}
				if (error instanceof Error && error.status === 409 && restartInvalidSnapshot) {
					state.pageLoading = false
					const targetCount = previousLoaded.length + (append ? limit : 0)
					state.loaded = []
					state.total = 0
					state.nextPageCursor = undefined
					let recovered = await performLoadPage(false, {
						background,
						stageOnly: true,
						limit: canonicalPageLimit(targetCount, 0, 50),
						restartInvalidSnapshot: false,
					})
					while (shouldContinueTransactionRestore(recovered, state.loaded.length, targetCount, state.nextPageCursor))
						recovered = await performLoadPage(true, {
							background,
							stageOnly: true,
							limit: canonicalPageLimit(targetCount, state.loaded.length, 50),
							restartInvalidSnapshot: false,
						})
					if (recovered) {
						if (!stageOnly) render({ previous, highlight: true })
						return true
					}
					const recoveryError = state.pageError
					state.loaded = previousLoaded
					state.total = previousTotal
					state.nextPageCursor = previousCursor
					state.pageLoading = false
					state.pageErrorAppend = append
					state.pageError = append ? `Could not load more transactions; showing the last known activity: ${recoveryError ?? errorMessage(error)}` : `Could not refresh sent transactions; showing the last known activity: ${recoveryError ?? errorMessage(error)}`
					if (!stageOnly) render()
					return false
				}
				state.pageLoading = false
				state.pageErrorAppend = append
				state.pageError = accountTransactionsError(errorMessage(error), state.loaded.length > 0, append)
				if (!stageOnly) render()
				return false
			} finally {
				if (isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) detailContent.setAttribute('aria-busy', 'false')
			}
		}
		const loadPage = (append = false, options: AccountPageOptions = {}) => {
			if (append && options.background !== true) {
				const more = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
				if (more !== null) {
					more.disabled = true
					more.setAttribute('aria-busy', 'true')
					more.textContent = 'Loading more transactions…'
				}
				detailContent.setAttribute('aria-busy', 'true')
			}
			return options.background === true ? accountPageRefreshGate.runBackground(() => performLoadPage(append, options)) : accountPageRefreshGate.runForeground(() => performLoadPage(append, options))
		}
		const loadMore = () => loadPage(true)
		let releaseStagedRefresh: (() => void) | undefined
		const stagedRefreshCompleted = stagedRefresh
			? new Promise<void>(resolve => {
					releaseStagedRefresh = resolve
				})
			: undefined
		const queuedLoadMore = async () => {
			const more = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
			if (more !== null) {
				more.disabled = true
				more.setAttribute('aria-busy', 'true')
				more.textContent = 'Loading more transactions…'
			}
			await stagedRefreshCompleted
			return activeAccountLoadMore === queuedLoadMore ? false : await activeAccountLoadMore?.()
		}
		activeAccountLoadMore = stagedRefresh ? queuedLoadMore : loadMore
		let loadRequest: Promise<boolean>
		if (stagedRefresh) {
			loadRequest = accountPageRefreshGate.runBackground(async () => {
				const targetCount = stagedSnapshot?.loadedCount ?? 0
				let staged = await performLoadPage(false, {
					background: true,
					stageOnly: true,
					limit: canonicalPageLimit(targetCount, 0, 50),
				})
				while (stagedSnapshot && shouldContinueTransactionRestore(staged, state.loaded.length, stagedSnapshot.loadedCount, state.nextPageCursor))
					staged = await performLoadPage(true, {
						background: true,
						stageOnly: true,
						limit: canonicalPageLimit(stagedSnapshot.loadedCount, state.loaded.length, 50),
					})
				return staged
			})
		} else {
			loadRequest = loadPage(false, { liveRefresh: live && state.loaded.length > 0, background: live })
		}
		pageReservation.release()
		await pageReservation.completed
		let loaded = await loadRequest
		if (!stagedRefresh) {
			while (restoreSnapshot && shouldContinueTransactionRestore(loaded, state.loaded.length, restoreSnapshot.loadedCount, state.nextPageCursor)) loaded = await loadPage(true)
		}
		if (!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
			releaseStagedRefresh?.()
			return false
		}
		if (stagedRefresh) {
			if (!loaded) {
				if (isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) && dialog.open) {
					activeAccountTransactions = previousState
					activeAccountLoadMore = previousLoadMore
					detailContent.querySelector<HTMLElement>('.account-transactions-error')?.remove()
					if (!canonicalRecovery) {
						const alert = element('div', 'detail-error account-transactions-error')
						alert.setAttribute('role', 'alert')
						alert.append(element('p', '', state.pageError ?? 'Could not refresh sent transactions; showing the last known activity.'))
						const retry = element('button', 'state-retry', 'Retry loading transactions')
						retry.type = 'button'
						retry.addEventListener('click', () => openAccountTransactions(account, { live: true }))
						alert.append(retry)
						detailContent.prepend(alert)
					}
				}
				releaseStagedRefresh?.()
				return false
			}
			activeAccountTransactions = state
			activeAccountLoadMore = loadMore
			render({ previous: refreshPrevious, highlight: true })
			releaseStagedRefresh?.()
		}
		if (loaded && stagedSnapshot) restoreAccountDialogSnapshot(stagedSnapshot)
		if (loaded && canonicalRecovery && pendingCanonicalAccount && String(pendingCanonicalAccount.chain_id) === String(state.account.chain_id) && pendingCanonicalAccount.address.toLowerCase() === state.account.address.toLowerCase()) pendingCanonicalAccount = undefined
		if (loaded && !canonicalRecovery && canonicalRefreshRequired) pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
		if (loaded && pendingCanonicalAccount === undefined) pendingAccountDialogSnapshot = undefined
		return loaded
	}

	const openAccountTransactions = (account: AccountReference, options: AccountDetailOptions = {}): Promise<boolean> => {
		if (options.live !== true && options.canonicalRecovery !== true) {
			detailContextVersion++
			detailRequestVersion++
		}
		const contextVersion = detailContextVersion
		const operation = () => performOpenAccountTransactions(account, { ...options, contextVersion })
		return options.live === true ? detailRefreshGate.runBackground(operation) : detailRefreshGate.runForeground(operation)
	}

	const restorePendingCanonicalAccount = async () => {
		const pending = pendingCanonicalAccount
		if (pending === undefined) return true
		let restored = false
		if (isRichList) {
			const current = richListItems.find(item => String(item.chain_id) === String(pending.chain_id) && item.address.toLowerCase() === pending.address.toLowerCase())
			restored = await openAccountTransactions(current ?? pending, {
				live: dialog.open,
				restoreSnapshot: pendingAccountDialogSnapshot,
				canonicalRecovery: true,
			})
		} else if (isAddress && currentAddressProfile && String(currentAddressProfile.chain_id) === String(pending.chain_id) && currentAddressProfile.address.toLowerCase() === pending.address.toLowerCase())
			restored = await openAccountTransactions(currentAddressProfile, {
				live: dialog.open,
				restoreSnapshot: pendingAccountDialogSnapshot,
				canonicalRecovery: true,
			})
		if (restored) {
			pendingCanonicalAccount = undefined
			pendingAccountDialogSnapshot = undefined
		}
		return restored
	}

	const closeDetail = ({ preservePendingCanonicalAccount = false, preservePendingCanonicalLog = false } = {}) => {
		detailContextVersion++
		detailRequestVersion++
		activeLog = undefined
		removeEventDrawers()
		activeAccount = undefined
		activeAccountTransactions = undefined
		activeAccountLoadMore = undefined
		if (activeReorgRecovery !== undefined) {
			activeReorgRecovery.logToRefresh = undefined
			activeReorgRecovery.accountToRefresh = undefined
		}
		hideCanonicalDialogStatus()
		preservePendingOnDialogClose = preservePendingCanonicalAccount || preservePendingCanonicalLog
		if (!preservePendingCanonicalAccount) {
			pendingCanonicalAccount = undefined
			pendingAccountDialogSnapshot = undefined
		}
		if (!preservePendingCanonicalLog) pendingCanonicalLog = undefined
		dialog.close()
		clearDetailUrl()
	}

	const clearDetailUrl = () => {
		const url = urlWithoutLogDetail(new URL(location.href))
		url.searchParams.delete('account')
		history.replaceState(null, '', url)
	}

	const exactUnit = (value: string | number | bigint | null | undefined, decimals = 18, symbol = '', maximumFraction = 3): string => {
		if (value === null || value === undefined) return '—'
		const negative = String(value).startsWith('-')
		const digits = String(value)
			.replace('-', '')
			.padStart(decimals + 1, '0')
		const whole = digits.slice(0, -decimals) || '0'
		const fraction = decimals === 0 ? '' : digits.slice(-decimals).slice(0, maximumFraction).replace(/0+$/, '')
		const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
		return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}${symbol ? ` ${symbol}` : ''}`
	}

	const compactValue = (value: string | number | bigint | null | undefined, decimals = 18): number => {
		if (value === null || value === undefined) return 0
		const digits = String(value)
		const scale = 10 ** Math.min(decimals, 18)
		return Number(digits) / scale
	}

	const staticField = (label: string, value: string | number | bigint | null | undefined) => {
		const field = element('div', 'static-field')
		field.append(element('span', '', label), element('code', '', value === null || value === undefined ? '—' : String(value)))
		return field
	}

	const staticAddressField = (label: string, address: string | null | undefined, chainId: string) => {
		const field = element('div', 'static-field')
		field.append(element('span', '', label), address ? protocolAddressLink(address, { chainId }) : element('code', '', '—'))
		return field
	}

	const metricCard = (label: string, value: string, detail?: string) => {
		const card = element('div', 'metric-card')
		card.append(element('span', '', label), element('strong', '', value))
		if (detail !== undefined) card.append(element('small', '', detail))
		return card
	}

	const chartNumericValue = (value: unknown): string | number | bigint | null | undefined => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value === null || value === undefined ? value : undefined)

	const chartTimestamp = (value: string): number => {
		const parsed = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value)
		return Number.isFinite(parsed) ? parsed : 0
	}

	const lineChart = <T extends { timestamp: string }>(rows: T[], definitions: ChartDefinition<T>[], { sharedRange, axisUnit = '' }: { sharedRange?: readonly [number, number]; axisUnit?: string } = {}) => {
		const width = 760
		const height = 190
		const margin = { left: 48, right: 14, top: 12, bottom: 28 }
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
		svg.setAttribute('class', 'time-chart')
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
		svg.setAttribute('role', 'img')
		svg.setAttribute('aria-label', `${definitions.map(({ label }) => label).join(', ')} value over time`)
		const series = definitions.map(({ key, decimals = 18 }) => {
			const raw = rows.map(row => (row[key] === undefined ? Number.NaN : compactValue(chartNumericValue(row[key]), decimals)))
			return raw
		})
		const timestamps = rows.map(row => chartTimestamp(row.timestamp))
		const minimumTimestamp = Math.min(...timestamps)
		const timestampRange = Math.max(...timestamps) - minimumTimestamp
		const values = series.flat().filter(Number.isFinite)
		const { minimum, maximum } = chartValueBounds(values, sharedRange)
		const range = maximum - minimum
		const chartWidth = width - margin.left - margin.right
		const chartHeight = height - margin.top - margin.bottom
		for (let index = 0; index <= 3; index++) {
			const y = margin.top + (chartHeight * index) / 3
			const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line')
			grid.setAttribute('class', 'chart-grid-line')
			grid.setAttribute('x1', String(margin.left))
			grid.setAttribute('x2', String(width - margin.right))
			grid.setAttribute('y1', String(y))
			grid.setAttribute('y2', String(y))
			svg.append(grid)
			const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			label.setAttribute('class', 'chart-axis-label')
			label.setAttribute('x', '2')
			label.setAttribute('y', String(y + 3))
			const axisValue = maximum - (range * index) / 3
			label.textContent = `${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(axisValue)}${axisUnit}`
			svg.append(label)
		}
		definitions.forEach(({ key, label, decimals = 18, unit = '', className = '', pointShape, pointLabel }, definitionIndex) => {
			const points = rows.flatMap((row, index) => {
				const definitionSeries = requiredArrayItem(series, definitionIndex, 'Chart definition series')
				const value = requiredArrayItem(definitionSeries, index, 'Chart series point')
				if (!Number.isFinite(value)) return []
				const timestamp = requiredArrayItem(timestamps, index, 'Chart timestamp')
				const x = margin.left + (timestampRange === 0 ? chartWidth / 2 : (chartWidth * (timestamp - minimumTimestamp)) / timestampRange)
				const y = margin.top + chartHeight - ((value - minimum) / range) * chartHeight
				return [{ x, y, row }]
			})
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
			path.setAttribute('class', `chart-line ${className}`)
			path.setAttribute('d', points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '))
			svg.append(path)
			for (const { x, y, row } of points) {
				const shape = pointShape?.(row) ?? 'circle'
				const point = document.createElementNS('http://www.w3.org/2000/svg', shape === 'diamond' ? 'rect' : 'circle')
				point.setAttribute('class', `chart-point ${className}${shape === 'diamond' ? ' initialization' : ''}`)
				if (shape === 'diamond') {
					point.setAttribute('x', String(x - 3))
					point.setAttribute('y', String(y - 3))
					point.setAttribute('width', '6')
					point.setAttribute('height', '6')
					point.setAttribute('transform', `rotate(45 ${x} ${y})`)
				} else {
					point.setAttribute('cx', String(x))
					point.setAttribute('cy', String(y))
					point.setAttribute('r', '2.8')
				}
				point.setAttribute('tabindex', '0')
				const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
				const observationType = pointLabel?.(row)
				title.textContent = `${label}: ${exactUnit(chartNumericValue(row[key]), decimals, unit, decimals)} · ${new Date(row.timestamp).toLocaleString()}${observationType ? ` · ${observationType}` : ''}`
				point.setAttribute('aria-label', title.textContent)
				point.append(title)
				svg.append(point)
			}
		})
		if (rows.length > 0)
			for (const [x, row] of [
				[margin.left, rows[0]],
				[width - margin.right, rows.at(-1)],
			] as const) {
				if (row === undefined) continue
				const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
				label.setAttribute('class', 'chart-axis-label')
				label.setAttribute('x', String(x))
				label.setAttribute('y', String(height - 5))
				label.setAttribute('text-anchor', x === margin.left ? 'start' : 'end')
				label.textContent = new Date(chartTimestamp(row.timestamp)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
				svg.append(label)
			}
		return svg
	}

	const chartCard = <T extends { timestamp: string }>(
		title: string,
		rows: T[],
		definitions: ChartDefinition<T>[],
		note: string,
		{
			sharedRange,
			axisUnit,
			legendItems = [],
			emptyMessage = 'No checkpoints match this view.',
		}: {
			sharedRange?: readonly [number, number]
			axisUnit?: string
			legendItems?: Array<{ label: string; className?: string }>
			emptyMessage?: string
		} = {},
	) => {
		const card = element('section', 'chart-card')
		const heading = element('div', 'chart-heading')
		heading.append(element('h4', '', title))
		const legend = element('div', 'chart-legend')
		for (const { label, className = '' } of [...definitions, ...legendItems]) {
			const item = element('span')
			item.append(element('i', className === '' ? '' : `chart-${className}`), document.createTextNode(label))
			legend.append(item)
		}
		if (rows.length > 0) heading.append(legend)
		card.append(heading)
		if (rows.length === 0) card.append(element('p', 'data-note', emptyMessage))
		else {
			const independentlyScaled = definitions.length > 1 && sharedRange === undefined
			if (independentlyScaled) {
				const currentValues = element('dl', 'chart-current-values')
				for (const { key, label, decimals = 18, unit = '' } of definitions) {
					const latest = rows.findLast(row => row[key] !== undefined)
					if (latest === undefined) continue
					const item = element('div')
					item.append(element('dt', '', label), element('dd', '', exactUnit(chartNumericValue(latest[key]), decimals, unit, decimals)))
					currentValues.append(item)
				}
				card.append(currentValues)
			}
			const viewport = element('div', 'chart-scroll')
			if (independentlyScaled) {
				for (const definition of definitions) {
					const series = element('section', 'chart-series')
					series.append(element('h5', '', definition.label), lineChart(rows, [definition], { axisUnit: definition.unit }))
					viewport.append(series)
				}
			} else viewport.append(lineChart(rows, definitions, { sharedRange, axisUnit }))
			const dataDisclosure = document.createElement('details')
			dataDisclosure.className = 'chart-data-disclosure'
			dataDisclosure.append(element('summary', '', 'View exact chart data'))
			const tableViewport = element('div', 'chart-data-scroll')
			const table = document.createElement('table')
			const caption = element('caption', '', `${title} exact observations`)
			const head = document.createElement('thead')
			const headerRow = document.createElement('tr')
			headerRow.append(element('th', '', 'Time'))
			for (const definition of definitions) headerRow.append(element('th', '', definition.label))
			head.append(headerRow)
			const body = document.createElement('tbody')
			for (const row of rows) {
				const tableRow = document.createElement('tr')
				const time = element('th', '', new Date(chartTimestamp(row.timestamp)).toLocaleString())
				time.setAttribute('scope', 'row')
				tableRow.append(time)
				for (const { key, decimals = 18, unit = '' } of definitions) {
					const value = row[key]
					tableRow.append(element('td', '', value === undefined ? 'Unavailable' : exactUnit(chartNumericValue(value), decimals, unit, decimals)))
				}
				body.append(tableRow)
			}
			table.append(caption, head, body)
			tableViewport.append(table)
			dataDisclosure.append(tableViewport)
			card.append(viewport, element('p', 'data-note', `${note}${independentlyScaled ? ' Each line is independently scaled to its observed range so every trend remains visible; exact latest values are listed above.' : ''}`), dataDisclosure)
		}
		return card
	}

	const stateHeader = (eyebrow: string, title: string, subtitle: string, kind: string) => {
		const header = element('header', 'state-detail-header')
		const copy = element('div')
		copy.append(element('p', 'eyebrow', eyebrow), element('h3', 'state-detail-title', title), element('p', 'state-detail-subtitle', subtitle))
		header.append(copy, element('span', 'state-kind', kind))
		return header
	}

	const richBalance = (value: string | number | undefined, symbol: string, digits = 2) => exactUnit(value ?? '0', 18, symbol, digits)

	const richFieldLabel = (label: string) => element('span', 'sr-only rich-field-label', label)

	const nativeSymbol = (chainId = selectedChainId()) => (String(chainId) === '1' ? 'ETH' : 'SepoliaETH')

	const renderContracts = () => {
		const pageScrollY = window.scrollY
		const list = $('#contract-list')
		if (contractItems.length === 0) {
			list.replaceChildren(element('div', 'state-placeholder', 'No system contracts are registered for this network.'))
			list.setAttribute('aria-busy', 'false')
			return
		}
		const sectionOrder: readonly ContractRegistrySection[] = ['Protocol contracts', 'System dependencies', 'Discovered contracts']
		const displayedContractItems = [...contractItems].sort((left, right) => sectionOrder.indexOf(contractRegistrySection(left)) - sectionOrder.indexOf(contractRegistrySection(right)))
		const scrollLeft = list.scrollLeft
		const scrollTop = list.scrollTop
		const focusedContractAddress = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.contract-row')?.dataset.contractAddress : undefined
		const focusedAction = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-contract-action]')?.dataset.contractAction : undefined
		const groupScrollPositions = new Map(
			[...list.querySelectorAll<HTMLElement>('.contract-group[data-contract-group]')].flatMap(group => {
				const name = group.dataset.contractGroup
				const rows = group.querySelector<HTMLElement>('.contract-group-rows')
				return name === undefined || rows === null ? [] : [[name, rows.scrollLeft] as const]
			}),
		)
		const existingRows = new Map([...list.querySelectorAll<HTMLElement>('.contract-row[data-contract-address]')].map(row => [row.dataset.contractAddress, row]))
		const groupedRows = new Map<ContractRegistrySection, HTMLElement[]>()
		for (const contract of displayedContractItems) {
			const status = contractDeploymentStatus(contract)
			const addressKey = contract.address.toLowerCase()
			const row = existingRows.get(addressKey) ?? element('article', 'contract-row')
			row.dataset.contractAddress = addressKey
			const head = element('span', 'contract-row-head')
			const deployment = contract.deployment_block ? explorerLink(contract.explorer_base_url, 'block', contract.deployment_block, `${contract.deployment_block_exact === false ? 'Deployed at or before' : 'Deployed at'} #${number(contract.deployment_block)}`) : element('span', '', status.label)
			deployment.className = `deployment-status ${status.tone}`
			deployment.dataset.contractAction = `${addressKey}:deployment`
			const deploymentDetails = element('span', 'contract-deployment')
			deploymentDetails.append(deployment)
			head.append(element('strong', '', contract.label), deploymentDetails)
			if (contract.deployment_timestamp) {
				const deployed = element('time', 'data-note', `${contract.deployment_block_exact === false ? 'At or before ' : ''}${new Date(contract.deployment_timestamp).toLocaleDateString('en-GB')} · ${age(contract.deployment_timestamp)}`)
				deployed.dateTime = exactTimestamp(contract.deployment_timestamp)
				deployed.title = exactTimestamp(contract.deployment_timestamp)
				deploymentDetails.append(deployed)
			}
			const address = explorerLink(contract.explorer_base_url, 'address', contract.address, contract.address)
			address.className = 'contract-address-link'
			address.dataset.contractAction = `${addressKey}:address`
			row.replaceChildren(head, address)
			const section = contractRegistrySection(contract)
			const rows = groupedRows.get(section) ?? []
			rows.push(row)
			groupedRows.set(section, rows)
		}
		const sections = sectionOrder.flatMap(sectionName => {
			const rows = groupedRows.get(sectionName)
			if (rows === undefined || rows.length === 0) return []
			const section = element('section', 'contract-group')
			section.dataset.contractGroup = sectionName
			const rowList = element('div', 'contract-group-rows')
			rowList.append(...rows)
			section.append(rowList)
			return [section]
		})
		list.replaceChildren(...sections)
		for (const section of list.querySelectorAll<HTMLElement>('.contract-group[data-contract-group]')) {
			const name = section.dataset.contractGroup
			const rows = section.querySelector<HTMLElement>('.contract-group-rows')
			if (name !== undefined && rows !== null) rows.scrollLeft = groupScrollPositions.get(name) ?? 0
		}
		list.scrollLeft = scrollLeft
		list.scrollTop = scrollTop
		window.scrollTo({ top: pageScrollY, behavior: 'instant' })
		if (focusedAction !== undefined) document.querySelector<HTMLElement>(`[data-contract-action="${focusedAction}"]`)?.focus({ preventScroll: true })
		else if (focusedContractAddress !== undefined) list.querySelector<HTMLElement>(`[data-contract-address="${focusedContractAddress}"]`)?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })
		list.setAttribute('aria-busy', 'false')
	}

	const performLoadContracts = async ({ live = false, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== viewContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		const requestVersion = ++contractRequestVersion
		const status = $('#contracts-status')
		const presentation = refreshPresentation({ live })
		if (presentation.loadingState) {
			status.hidden = false
			status.className = contractItems.length === 0 ? 'system-status' : 'system-status sr-only'
			status.textContent = contractItems.length === 0 ? 'Loading system contracts…' : 'Refreshing system contracts…'
		}
		$('#contract-list').setAttribute('aria-busy', String(presentation.busy))
		try {
			const result = decodeItemsPage(await api(`/api/v1/contracts?${new URLSearchParams({ chainId: requiredChainId() })}`), isContractRecord, 'Contracts')
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, contractRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			contractItems = result.items
			renderContracts()
			if (presentation.loadingState) {
				status.className = 'system-status sr-only'
				status.textContent = 'System contracts updated.'
			} else status.hidden = true
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, contractRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			$('#contract-list').setAttribute('aria-busy', 'false')
			renderRetryStatus(status, contractItems.length === 0 ? `Contract registry unavailable: ${errorMessage(error)}` : `Refresh failed; showing the last registry: ${errorMessage(error)}`, () => retryCanonicalViewOr(loadContracts))
			return false
		}
	}

	const loadContracts = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = viewContextVersion
		const operation = () => performLoadContracts({ ...options, contextVersion })
		return options.live === true ? contractRefreshGate.runBackground(operation) : contractRefreshGate.runForeground(operation)
	}

	const renderRichList = () => {
		const rows = $('#richlist-rows')
		const isInitialRender = rows.childElementCount === 0
		const openDetailKeys = new Set([...rows.querySelectorAll<HTMLElement>('details[open][data-detail-key]')].map(details => details.dataset.detailKey))
		const focusedDetailKey = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('details[data-detail-key]')?.dataset.detailKey : undefined
		rows.replaceChildren()
		for (const item of richListItems) {
			const itemKey = `${item.chain_id}:${item.address}`
			const article = setLiveRecord(element('article', 'rich-row'), itemKey, item)
			const main = element('div', 'rich-row-main')
			const identity = element('div', 'rich-identity')
			const addressLink = protocolAddressLink(item.address, { knownLabel: item.label, chainId: item.chain_id, className: 'rich-address address-link' })
			identity.append(richFieldLabel('Address'), addressLink)
			const identityMeta = item.label ? item.address : undefined
			if (identityMeta) identity.append(element('span', '', identityMeta))
			const hasNative = Number(item.sampled_native_count) > 0
			const repComplete = Number(item.sampled_rep_token_count) >= Number(item.rep_token_count)
			const wethComplete = Number(item.sampled_weth_token_count) >= Number(item.weth_token_count)
			const repTokens = Array.isArray(item.rep_balances) ? item.rep_balances : []
			const itemNativeSymbol = nativeSymbol(item.chain_id)
			const wallet = element('div', 'rich-wallet')
			wallet.append(richFieldLabel(`${itemNativeSymbol} / WETH`), element('strong', '', hasNative ? richBalance(item.native_balance, itemNativeSymbol) : `${itemNativeSymbol} pending`), element('span', '', wethComplete ? richBalance(item.weth_balance, 'WETH') : `${richBalance(item.weth_balance, 'WETH')} · partial`))
			const transactions = element('button', 'rich-count rich-transactions')
			transactions.type = 'button'
			transactions.setAttribute('aria-label', `View ${number(item.transaction_count)} transactions sent by ${item.label ?? item.address}`)
			transactions.append(richFieldLabel('Transactions'), element('strong', '', number(item.transaction_count)))
			transactions.addEventListener('click', () => openAccountTransactions(item))
			const positions = element('div', 'rich-count')
			positions.append(richFieldLabel('Protocol involvement'), element('strong', '', counted(item.pool_count, 'pool')), element('span', '', `${counted(item.active_vault_count, 'active vault')} / ${counted(item.vault_count, 'known vault')}`))
			const rep = element('div', 'rich-rep')
			rep.append(richFieldLabel('REP tokens'))
			if (repTokens.length === 0) rep.append(element('strong', '', 'REP pending'))
			for (const token of repTokens) {
				const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
				const tokenLine = element('span', 'rich-rep-token')
				const tokenIdentity = element('span')
				tokenIdentity.append(
					protocolAddressLink(token.address, {
						knownLabel: token.contractLabel,
						chainId: item.chain_id,
						className: 'address-link',
					}),
				)
				if (token.universeId !== null && token.universeId !== undefined) tokenIdentity.append(document.createTextNode(` · universe ${shortIdentifier(token.universeId)}`))
				tokenLine.append(element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP', 2)), tokenIdentity)
				rep.append(tokenLine)
			}
			if (!repComplete) rep.append(element('span', '', `${number(item.sampled_rep_token_count)} of ${number(item.rep_token_count)} REP tokens sampled`))
			main.append(identity, rep, wallet, transactions, positions)
			article.append(main)
			const poolAssociations = Array.isArray(item.pool_associations) ? item.pool_associations : []
			const vaultPositions = Array.isArray(item.vault_positions) ? item.vault_positions : []
			const involvement = element('details', 'rich-assets rich-involvement')
			involvement.dataset.detailKey = `${itemKey}:involvement`
			involvement.open = openDetailKeys.has(involvement.dataset.detailKey) || (isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
			involvement.append(element('summary', '', `${counted(item.pool_count, 'pool association')} · ${counted(item.vault_count, 'vault position')}`))
			const involvementGrid = element('div', 'rich-position-grid')
			for (const pool of poolAssociations) {
				const card = element('div', 'rich-position')
				const link = protocolAddressLink(pool.address, {
					knownLabel: pool.label,
					chainId: item.chain_id,
					className: 'rich-token-address address-link',
				})
				card.append(element('span', 'rich-position-kind', 'Pool association'), element('strong', '', pool.questionTitle ?? pool.label ?? 'Associated security pool'), element('span', '', pool.label ?? 'Observed in the same protocol transaction'), link)
				involvementGrid.append(card)
			}
			for (const position of vaultPositions) {
				const card = element('div', 'rich-position')
				const link = protocolAddressLink(position.poolAddress, { chainId: item.chain_id, className: 'rich-token-address address-link' })
				card.append(
					element('span', 'rich-position-kind', 'Vault position'),
					element('strong', '', position.questionTitle ?? 'Vault position'),
					element('span', '', `REP backing units ${exactUnit(position.repBackingUnits, 18, '', 2)}`),
					element('span', '', `Capacity ownership ${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP', 2)}`),
					element('span', '', `Claimable fees ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol, 2)} · block #${number(position.blockNumber)}`),
					link,
				)
				involvementGrid.append(card)
			}
			if (poolAssociations.length < Number(item.pool_count) || vaultPositions.length < Number(item.vault_count)) involvementGrid.append(element('span', 'data-note', 'Showing the first 100 associations or positions.'))
			involvement.append(involvementGrid)
			if (Number(item.pool_count) > 0 || Number(item.vault_count) > 0) article.append(involvement)
			rows.append(article)
		}
		if (focusedDetailKey) {
			const focusedDetails = [...rows.querySelectorAll<HTMLElement>('details[data-detail-key]')].find(details => details.dataset.detailKey === focusedDetailKey)
			focusedDetails?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
		}
		rows.setAttribute('aria-busy', 'false')
		$('#richlist-summary').textContent = `${number(richListItems.length)} of ${number(richListTotal)} known addresses`
		$('#richlist-more').hidden = !retainedPaginationAvailable(richListItems.length < richListTotal, canonicalRefreshRequired)
	}

	const performLoadRichList = async ({ append = false, live = false, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== viewContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		if (!paginationRequestAllowed(append, canonicalRefreshRequired)) {
			$('#richlist-more').hidden = true
			$('#richlist-more').disabled = true
			return false
		}
		const requestVersion = ++richListRequestVersion
		const status = $('#richlist-status')
		const paginationStatus = $('#richlist-more-status')
		const more = $('#richlist-more')
		const nextOffset = append ? richListItems.length : 0
		const presentation = refreshPresentation({ live, append })
		if (presentation.loadingState) {
			if (append) {
				paginationStatus.hidden = false
				paginationStatus.className = 'system-status sr-only'
				paginationStatus.textContent = 'Loading more known addresses…'
				more.hidden = false
				more.setAttribute('aria-busy', 'true')
				more.textContent = 'Loading more…'
			} else {
				status.hidden = false
				status.textContent = richListItems.length === 0 ? 'Loading known addresses…' : 'Refreshing known addresses…'
			}
		}
		more.disabled = presentation.busy
		$('#rich-sort').disabled = presentation.busy
		$('#richlist-rows').setAttribute('aria-busy', String(presentation.busy))
		try {
			const fetchPage = async (offset: number, limit: number) => {
				const query = new URLSearchParams({ sort: $('#rich-sort').value, offset: String(offset), limit: String(limit) })
				query.set('chainId', requiredChainId())
				return decodeItemsPage(await api(`/api/v1/richlist?${query}`), isRichListRecord, 'Rich list')
			}
			const fetchSnapshot = async (requestedCount: number) => {
				const firstLimit = Math.min(100, requestedCount)
				const firstPage = await fetchPage(0, firstLimit)
				const targetCount = Math.min(requestedCount, firstPage.total ?? firstPage.items.length)
				const remainingOffsets = []
				for (let offset = firstLimit; offset < targetCount; offset += 100) remainingOffsets.push(offset)
				const remainingPages = await Promise.all(remainingOffsets.map(offset => fetchPage(offset, Math.min(100, targetCount - offset))))
				return { ...firstPage, items: [firstPage, ...remainingPages].flatMap(page => page.items).slice(0, targetCount) }
			}
			let replace = !append
			let result = append ? await fetchPage(nextOffset, 50) : await fetchSnapshot(Math.max(50, richListItems.length))
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			if (append && paginatedSnapshotWasReplaced(richListItems.length, result.total ?? result.items.length)) {
				result = await fetchSnapshot(Math.max(1, richListItems.length))
				if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
				replace = true
			}
			richListItems = replace ? result.items : [...richListItems, ...result.items]
			richListTotal = result.total ?? richListItems.length
			renderRichList()
			status.hidden = true
			paginationStatus.hidden = true
			paginationStatus.replaceChildren()
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			$('#richlist-rows').setAttribute('aria-busy', 'false')
			const failureStatus = append ? paginationStatus : status
			renderRetryStatus(failureStatus, richListError(errorMessage(error), append, richListItems.length === 0), () => retryCanonicalViewOr(() => loadRichList({ append })))
			more.hidden = !retainedPaginationAvailable(richListItems.length < richListTotal, canonicalRefreshRequired)
			if (append) more.hidden = true
			if (richListItems.length === 0) $('#richlist-summary').textContent = ''
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion)) {
				more.disabled = canonicalRefreshRequired
				if (canonicalRefreshRequired) more.hidden = true
				$('#rich-sort').disabled = false
				more.removeAttribute('aria-busy')
				more.textContent = 'Show more'
			}
		}
	}

	const loadRichList = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = viewContextVersion
		const paginationIntentVersion = options.append === true ? ++richListPaginationIntentVersion : undefined
		if (paginationIntentVersion !== undefined) {
			const more = $('#richlist-more')
			const presentation = queuedPaginationPresentation(canonicalRefreshRequired)
			more.hidden = presentation.hidden
			more.disabled = presentation.disabled
			more.textContent = presentation.label
			if (presentation.busy) more.setAttribute('aria-busy', 'true')
			else more.removeAttribute('aria-busy')
			const paginationStatus = $('#richlist-more-status')
			paginationStatus.hidden = !presentation.busy
			paginationStatus.className = 'system-status sr-only'
			paginationStatus.textContent = presentation.busy ? 'Loading more known addresses…' : ''
		}
		const operation = () => performLoadRichList({ ...options, contextVersion })
		const request = options.live === true && options.append !== true ? richListRefreshGate.runBackground(operation) : richListRefreshGate.runForeground(operation)
		if (paginationIntentVersion !== undefined) {
			const clearPending = () => {
				if (paginationIntentVersion !== richListPaginationIntentVersion || contextVersion !== viewContextVersion) return
				const more = $('#richlist-more')
				more.removeAttribute('aria-busy')
				more.textContent = 'Show more'
				more.disabled = canonicalRefreshRequired
				if (canonicalRefreshRequired) {
					$('#richlist-more-status').hidden = true
					$('#richlist-more-status').replaceChildren()
				}
			}
			void request.then(clearPending, clearPending)
		}
		return request
	}

	const renderAddressProfile = (item: RichListRecord, transactions: AccountTransaction[], interactions: AccountTransaction[], { live = false, portfolioFocusKind }: { live?: boolean; portfolioFocusKind?: 'forks' | 'lp' | 'reports' } = {}) => {
		const content = $('#address-profile-content')
		const previousSections = liveSnapshot(content, '[data-live-key]')
		const chainId = String(item.chain_id)
		const itemNativeSymbol = nativeSymbol(chainId)
		const header = element('header', 'address-profile-header')
		const identity = element('div')
		const heading = element('h2', '', item.label ?? 'Address')
		heading.id = 'address-profile-heading'
		identity.append(element('p', 'eyebrow', item.kind ? 'Protocol contract' : 'Account'), heading, element('code', 'address-profile-value', item.address))
		const actions = element('div', 'address-profile-actions')
		const logParams = new URLSearchParams({ chainId, address: item.address })
		if (isDemo) logParams.set('demo', '1')
		const relatedLogs = element('a', 'explorer-link', 'View related logs')
		relatedLogs.href = `/?${logParams}`
		actions.append(relatedLogs, explorerLink(item.explorer_base_url, 'address', item.address, 'Open in Etherscan ↗'))
		header.append(identity, actions)
		setLiveRecord(header, 'identity', { label: item.label, kind: item.kind, address: item.address })
		const metrics = element('div', 'state-stats address-profile-stats')
		for (const [label, value] of [
			['Sent transactions', number(item.transaction_count)],
			['Observed interactions', number(item.interaction_count)],
			['Pools', number(item.pool_count)],
			['Vault positions', number(item.vault_count)],
		]) {
			const card = element('div', 'state-stat')
			card.append(element('span', '', label), element('strong', '', value))
			metrics.append(card)
		}
		setLiveRecord(metrics, 'metrics', {
			transactions: item.transaction_count,
			interactions: item.interaction_count,
			pools: item.pool_count,
			vaults: item.vault_count,
		})
		const balances = element('section', 'address-profile-panel')
		balances.append(element('p', 'eyebrow', 'Balances'), element('h3', '', 'Assets observed by augurScan'))
		const balanceGrid = element('div', 'address-balance-grid')
		const nativeCard = element('div', 'rich-token')
		nativeCard.append(element('strong', '', item.native_balance_detail ? exactUnit(item.native_balance_detail.balance, 18, itemNativeSymbol, 2) : `${itemNativeSymbol} pending`), element('span', '', item.native_balance_detail ? `Block #${number(item.native_balance_detail.blockNumber)}` : 'No balance snapshot yet'))
		balanceGrid.append(nativeCard)
		for (const token of [...(item.weth_balances ?? []), ...(item.rep_balances ?? [])]) {
			const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
			const card = element('div', 'rich-token')
			card.append(
				element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP', 2)),
				element('span', '', `${token.universeId === undefined || token.universeId === null ? 'Token' : `Universe ${shortIdentifier(token.universeId)}`} · block #${number(token.blockNumber)}`),
				protocolAddressLink(token.address, {
					knownLabel: token.contractLabel,
					chainId,
					className: 'rich-token-address address-link',
				}),
			)
			balanceGrid.append(card)
		}
		balances.append(balanceGrid)
		setLiveRecord(balances, 'balances', {
			native: item.native_balance_detail,
			weth: item.weth_balances,
			rep: item.rep_balances,
		})
		const involvement = element('section', 'address-profile-panel')
		involvement.append(element('p', 'eyebrow', 'Augur involvement'), element('h3', '', 'Pools and vaults'))
		const involvementGrid = element('div', 'rich-position-grid')
		for (const pool of item.pool_associations ?? []) {
			const card = element('div', 'rich-position')
			card.append(element('span', 'rich-position-kind', 'Pool'), element('strong', '', pool.questionTitle ?? pool.label ?? 'Security pool'), protocolAddressLink(pool.address, { knownLabel: pool.label, chainId, className: 'rich-token-address address-link' }))
			involvementGrid.append(card)
		}
		for (const position of item.vault_positions ?? []) {
			const card = element('div', 'rich-position')
			card.append(
				element('span', 'rich-position-kind', 'Vault'),
				element('strong', '', position.questionTitle ?? 'Vault position'),
				element('span', '', `${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP', 2)} capacity · ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol, 2)} claimable`),
				protocolAddressLink(position.poolAddress, { chainId, className: 'rich-token-address address-link' }),
			)
			involvementGrid.append(card)
		}
		if (involvementGrid.childElementCount === 0) involvementGrid.append(element('p', 'data-note', 'No pool or vault involvement matches this view.'))
		involvement.append(involvementGrid)
		setLiveRecord(involvement, 'involvement', { pools: item.pool_associations, vaults: item.vault_positions })
		const escalationClaims = operationsPanel(
			'Escalation interactions',
			(item.escalation_claims ?? []).map(claim => operationRow(String(claim['type'] ?? 'Escalation position'), `${String(claim['provenance'] ?? 'historical interaction')} · current claimability is unavailable`, String(claim['entity'] ?? ''), claim['blockNumber'])),
			'No escalation interactions are associated with this address.',
		)
		const auctionClaims = operationsPanel(
			'Auction interactions',
			(item.auction_claims ?? []).map(claim => operationRow(String(claim['type'] ?? 'Auction position'), `${String(claim['provenance'] ?? 'historical interaction')} · current entitlement is unavailable`, String(claim['entity'] ?? ''), claim['blockNumber'])),
			'No truth-auction interactions are associated with this address.',
		)
		const lpPositions = operationsPanel(
			'AMM liquidity positions',
			operationRecords(item['lp_positions']).map(position =>
				operationRow(
					String(position['question_title'] ?? 'Augur AMM market'),
					`${exactUnit(String(position['balance'] ?? '0'), 18, 'LP tokens', 4)} · ${operationCounted(position['transfer_count'], 'transfer')}`,
					String(position['market_address'] ?? ''),
					undefined,
					operationsHref(`/operations/trading/${encodeURIComponent(String(position['market_address'] ?? ''))}`),
				),
			),
			'No current AMM liquidity-token position has been reconstructed for this address.',
		)
		const forkParticipation = operationsPanel(
			'Fork and migration participation',
			operationRecords(item['fork_participation']).map(event =>
				operationRow(String(event['event_name'] ?? 'Fork migration'), 'Canonical event evidence naming this address as migrator, vault, or recipient', String(event['universe_identity'] ?? ''), event['block_number'], operationsHref(`/operations/fork/${encodeURIComponent(String(event['universe_identity'] ?? ''))}`)),
			),
			'No fork or migration participation matches this view.',
		)
		const reportParticipation = operationsPanel(
			'OpenOracle reporting participation',
			operationRecords(item['report_participation']).map(event =>
				operationRow(
					`${String(event['event_name'] ?? 'Report')} · report ${String(event['report_id'] ?? '—')}`,
					`Round ${String(event['round_number'] ?? '—')} · canonical reporter evidence`,
					String(event['open_oracle_address'] ?? ''),
					event['block_number'],
					operationsHref(`/operations/report/${encodeURIComponent(String(event['open_oracle_address'] ?? ''))}/${encodeURIComponent(String(event['report_id'] ?? ''))}`),
				),
			),
			'No OpenOracle rounds identify this address as the current reporter.',
		)
		const appendPortfolioPagination = (kind: 'forks' | 'lp' | 'reports', panel: HTMLElement) => {
			const page = portfolioPage(item, kind)
			const items = portfolioItems(item, kind)
			const singular = PORTFOLIO_KIND_LABELS[kind].singular
			const total = typeof page['total'] === 'number' ? page['total'] : undefined
			panel.querySelector('h3')?.after(element('p', 'operations-panel-scope', `${operationCounted(items.length, singular)} shown · ${operationCounted(total, singular)} total`))
			if (page['hasMore'] === true && typeof page['nextCursor'] === 'string') {
				const button = element('button', 'secondary compact portfolio-history-more', `Show more ${PORTFOLIO_KIND_LABELS[kind].plural}`)
				button.type = 'button'
				button.dataset['portfolioKind'] = kind
				const status = element('p', 'activity-summary')
				status.setAttribute('role', 'status')
				status.setAttribute('aria-live', 'polite')
				button.addEventListener('click', async () => {
					const scrollY = window.scrollY
					button.disabled = true
					button.setAttribute('aria-busy', 'true')
					button.textContent = `Showing more ${PORTFOLIO_KIND_LABELS[kind].plural}…`
					status.textContent = 'Loading older account evidence…'
					status.classList.add('sr-only')
					const loaded = await loadAddressProfile({ live: true, portfolioTarget: { kind, count: items.length + 100 } })
					if (loaded) {
						const next = $('#address-profile-content').querySelector<HTMLElement>(`[data-portfolio-kind="${kind}"]`)
						next?.focus({ preventScroll: true })
						window.scrollTo({ top: scrollY, behavior: 'auto' })
					} else if (button.isConnected) {
						button.disabled = false
						button.removeAttribute('aria-busy')
						button.textContent = `Retry more ${PORTFOLIO_KIND_LABELS[kind].plural}`
						status.textContent = 'Additional account evidence could not be loaded.'
						status.classList.remove('sr-only')
						button.focus({ preventScroll: true })
					}
				})
				panel.append(button, status)
			} else if (portfolioFocusKind === kind) {
				const complete = element('p', 'activity-summary operations-pagination-complete', `All available ${singular}${singular.endsWith('s') ? '' : 's'} are shown.`)
				complete.dataset['portfolioKind'] = kind
				complete.tabIndex = -1
				complete.setAttribute('role', 'status')
				complete.setAttribute('aria-live', 'polite')
				panel.append(complete)
			}
		}
		appendPortfolioPagination('lp', lpPositions)
		appendPortfolioPagination('forks', forkParticipation)
		appendPortfolioPagination('reports', reportParticipation)
		const activity = element('section', 'address-profile-panel')
		const activityHeader = element('div', 'address-section-heading')
		const activityCopy = element('div')
		activityCopy.append(element('p', 'eyebrow', 'Account activity'), element('h3', '', 'Recent sent transactions'))
		activityHeader.append(activityCopy)
		const allTransactions = element('button', 'secondary', 'View all sent transactions')
		allTransactions.type = 'button'
		allTransactions.addEventListener('click', () => openAccountTransactions(item))
		activityHeader.append(allTransactions)
		const transactionList = element('div', 'address-transaction-list')
		for (const transaction of transactions) {
			const row = element('article', 'address-transaction-row')
			const destination = transaction.to_address
				? protocolAddressLink(transaction.to_address, {
						knownLabel: transaction.to_label,
						chainId: transaction.chain_id,
						className: 'address-link',
					})
				: element('span', '', 'Contract creation')
			row.append(
				explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 10, 8)),
				destination,
				element('span', '', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'),
				element('span', '', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)} UTC`),
				element('strong', '', exactUnit(transaction.value, 18, itemNativeSymbol, 2)),
			)
			transactionList.append(row)
		}
		if (transactions.length === 0) transactionList.append(element('p', 'data-note', 'No sent transactions match this view.'))
		activity.append(activityHeader, transactionList)
		const interactionPanel = element('section', 'address-profile-panel')
		interactionPanel.append(element('p', 'eyebrow', 'Augur activity'), element('h3', '', 'Recent protocol references'))
		const interactionList = element('div', 'address-transaction-list')
		for (const transaction of interactions) {
			const row = element('article', 'address-transaction-row address-interaction-row')
			const destination = transaction.to_address
				? protocolAddressLink(transaction.to_address, {
						knownLabel: transaction.to_label,
						chainId: transaction.chain_id,
						className: 'address-link',
					})
				: element('span', '', 'Contract creation')
			row.append(
				explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 10, 8)),
				destination,
				element('span', '', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'),
				element('span', '', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)} UTC`),
				element('strong', '', exactUnit(transaction.value, 18, itemNativeSymbol, 2)),
			)
			if (transaction.action_arguments && Object.keys(transaction.action_arguments).length > 0) {
				const action = element('details', 'account-transaction-action')
				const argumentsContent = element('div', 'account-transaction-arguments')
				argumentsContent.append(decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id))
				action.append(element('summary', '', 'Decoded arguments'), argumentsContent)
				row.append(action)
			}
			interactionList.append(row)
		}
		if (interactions.length === 0) interactionList.append(element('p', 'data-note', 'No protocol references match this view.'))
		interactionPanel.append(interactionList)
		setLiveRecord(interactionPanel, 'references', interactions)
		setLiveRecord(activity, 'transactions', transactions)
		content.replaceChildren(header, metrics, balances, involvement, lpPositions, forkParticipation, reportParticipation, escalationClaims, auctionClaims, interactionPanel, activity)
		applyLiveChanges(content, previousSections, { live })
		content.setAttribute('aria-busy', 'false')
	}

	const accountTransactionsError = (detail: string, hasLoaded: boolean, append: boolean) => {
		if (!hasLoaded) return `Could not load sent transactions: ${detail}`
		return append ? `Could not load more transactions; showing the last known activity: ${detail}` : `Could not refresh sent transactions; showing the last known activity: ${detail}`
	}

	const richListError = (detail: string, append: boolean, empty: boolean) => {
		if (append) return `Could not load more; showing known rankings: ${detail}`
		return empty ? `Rich list unavailable: ${detail}` : `Refresh failed; showing last known rankings: ${detail}`
	}

	const PORTFOLIO_KIND_LABELS = {
		forks: { collection: 'fork_participation', cursorParameter: 'forkCursor', plural: 'fork events', singular: 'fork event' },
		lp: { collection: 'lp_positions', cursorParameter: 'lpCursor', plural: 'positions', singular: 'position' },
		reports: { collection: 'report_participation', cursorParameter: 'reportCursor', plural: 'report events', singular: 'report event' },
	} as const

	const historyCoverageHeadline = (moreAvailable: boolean, partiallyIndexed: boolean) => {
		if (moreAvailable) return 'More history available'
		return partiallyIndexed ? 'Requested range is partially indexed' : 'History loaded'
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

	const portfolioPage = (data: PortfolioData, kind: 'forks' | 'lp' | 'reports'): JsonRecord => {
		const pagination = isJsonRecord(data['portfolioPagination']) ? data['portfolioPagination'] : {}
		return isJsonRecord(pagination[kind]) ? pagination[kind] : {}
	}

	const portfolioItems = (data: PortfolioData, kind: 'forks' | 'lp' | 'reports'): JsonRecord[] => operationRecords(data[PORTFOLIO_KIND_LABELS[kind].collection])

	const portfolioItemKey = (kind: 'forks' | 'lp' | 'reports', item: JsonRecord): string => {
		if (kind === 'lp') return String(item['market_address'] ?? '')
		return `${String(item['block_hash'] ?? '')}:${String(item['tx_hash'] ?? '')}:${String(item['log_index'] ?? '')}:${kind === 'forks' ? String(item['universe_identity'] ?? '') : `${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`}`
	}

	const loadAddressPortfolioSnapshot = async (address: string, targets: Readonly<Record<'forks' | 'lp' | 'reports', number>>): Promise<OperationsResponse> => {
		const initialQuery = new URLSearchParams({ chainId: requiredChainId(), address, limit: '100' })
		const first = decodeOperationsResponse(await api(`/api/v1/state/address-portfolio?${initialQuery.toString()}`))
		const snapshotIdentity = `${first.chainId}:${String(first.asOf['blockNumber'] ?? '')}:${String(first.asOf['blockHash'] ?? '')}`
		const collections = {
			forks: portfolioItems(first.data, 'forks'),
			lp: portfolioItems(first.data, 'lp'),
			reports: portfolioItems(first.data, 'reports'),
		}
		const pages = {
			forks: portfolioPage(first.data, 'forks'),
			lp: portfolioPage(first.data, 'lp'),
			reports: portfolioPage(first.data, 'reports'),
		}
		for (const kind of ['lp', 'forks', 'reports'] as const) {
			while (collections[kind].length < targets[kind] && pages[kind]['hasMore'] === true && typeof pages[kind]['nextCursor'] === 'string') {
				const query = new URLSearchParams({ chainId: requiredChainId(), address, limit: '100' })
				query.set(PORTFOLIO_KIND_LABELS[kind].cursorParameter, pages[kind]['nextCursor'])
				const response = decodeOperationsResponse(await api(`/api/v1/state/address-portfolio?${query.toString()}`))
				const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
				if (responseIdentity !== snapshotIdentity) throw new Error('Portfolio history changed while older evidence was loading; retry from the latest available block')
				collections[kind] = mergeUniqueRecords(collections[kind], portfolioItems(response.data, kind), item => portfolioItemKey(kind, item))
				pages[kind] = portfolioPage(response.data, kind)
			}
		}
		return {
			...first,
			data: {
				...first.data,
				lp_positions: collections.lp,
				fork_participation: collections.forks,
				report_participation: collections.reports,
				portfolioPagination: pages,
			},
		}
	}

	const performLoadAddressProfile = async ({ live = false, contextVersion, portfolioTarget }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== viewContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		const requestVersion = ++addressProfileRequestVersion
		const content = $('#address-profile-content')
		const hadProfile = content.querySelector<HTMLElement>('[data-live-key]') !== null
		const requestedAddress = pageUrl.searchParams.get('address')?.toLowerCase()
		const backParams = new URLSearchParams({ chainId: requiredChainId() })
		if (isDemo) backParams.set('demo', '1')
		$('#address-back').href = `/richlist?${backParams}`
		if (requestedAddress === undefined || !/^0x[0-9a-f]{40}$/.test(requestedAddress)) {
			content.replaceChildren(element('div', 'detail-error', 'A complete 20-byte address is required.'))
			content.setAttribute('aria-busy', 'false')
			return false
		}
		const address = requestedAddress
		const presentation = refreshPresentation({ live })
		content.setAttribute('aria-busy', String(presentation.busy))
		if (presentation.loadingState) content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
		if (presentation.loadingState && !hadProfile) content.replaceChildren(element('p', 'detail-status', 'Loading address activity…'), element('div', 'loading-line'))
		try {
			const retainedPortfolioDepths = currentAddressPortfolioDepths?.chainId === requiredChainId() && currentAddressPortfolioDepths.address === address ? currentAddressPortfolioDepths : { chainId: requiredChainId(), address, forks: 0, lp: 0, reports: 0 }
			const portfolioTargets = {
				forks: portfolioTarget?.kind === 'forks' ? portfolioTarget.count : retainedPortfolioDepths.forks,
				lp: portfolioTarget?.kind === 'lp' ? portfolioTarget.count : retainedPortfolioDepths.lp,
				reports: portfolioTarget?.kind === 'reports' ? portfolioTarget.count : retainedPortfolioDepths.reports,
			}
			const [portfolio, identity, transactions, interactions] = await Promise.all([
				loadAddressPortfolioSnapshot(address, portfolioTargets),
				api(`/api/v1/address-identity?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}`).then(value => decodeValue(value, isAddressIdentity, 'Address identity')),
				api(`/api/v1/address-transactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then(value => decodeItemsPage(value, isAccountTransaction, 'Address transactions')),
				api(`/api/v1/address-interactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then(value => decodeItemsPage(value, isAccountTransaction, 'Address interactions')),
			])
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, addressProfileRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			const network = latestNetworks.find(candidate => String(candidate.chain_id) === selectedChainId())
			const profileItem = isRichListRecord(portfolio.data) ? portfolio.data : undefined
			const item = profileItem
				? { ...profileItem, ...portfolio.data, label: profileItem.label ?? identity.label, kind: profileItem.kind ?? identity.kind }
				: {
						chain_id: selectedChainId(),
						address,
						label: identity.label,
						kind: identity.kind,
						explorer_base_url: network?.explorer_base_url ?? '',
						transaction_count: transactions.total ?? transactions.items.length,
						interaction_count: interactions.total ?? interactions.items.length,
						pool_count: 0,
						vault_count: 0,
						rep_balances: [],
						weth_balances: [],
						native_balance_detail: { balance: '0', blockNumber: network?.indexed_block ?? '0' },
						pool_associations: [],
						vault_positions: [],
						...portfolio.data,
					}
			renderAddressProfile(item, transactions.items, interactions.items, { live, portfolioFocusKind: portfolioTarget?.kind })
			currentAddressProfile = item
			currentAddressPortfolioDepths = {
				chainId: requiredChainId(),
				address,
				forks: operationRecords(portfolio.data['fork_participation']).length,
				lp: operationRecords(portfolio.data['lp_positions']).length,
				reports: operationRecords(portfolio.data['report_participation']).length,
			}
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, addressProfileRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			if (hadProfile && canonicalRefreshRequired) {
				content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
				content.setAttribute('aria-busy', 'false')
				return false
			}
			const alert = element('div', `detail-error${hadProfile ? ' address-refresh-error' : ''}`)
			alert.setAttribute('role', 'alert')
			alert.append(element('p', '', hadProfile ? `Refresh failed; showing last known address state: ${errorMessage(error)}` : `Could not load address: ${errorMessage(error)}`))
			const retry = element('button', 'state-retry', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', () => retryCanonicalViewOr(loadAddressProfile))
			alert.append(retry)
			if (hadProfile) {
				content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
				content.prepend(alert)
			} else content.replaceChildren(alert)
			content.setAttribute('aria-busy', 'false')
			return false
		}
	}

	const loadAddressProfile = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = viewContextVersion
		const operation = () => performLoadAddressProfile({ ...options, contextVersion })
		return options.live === true ? addressProfileRefreshGate.runBackground(operation) : addressProfileRefreshGate.runForeground(operation)
	}

	const entityHistoryCollectionKeys = ['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory', 'pools', 'forks'] as const

	const entityHistoryCollections = (history: EntityHistory): Readonly<Record<(typeof entityHistoryCollectionKeys)[number], readonly unknown[]>> => ({
		snapshots: history.snapshots,
		events: history.events,
		ammPrices: history.ammPrices,
		repEthPrices: history.repEthPrices,
		uniswapRepEthPrices: history.uniswapRepEthPrices,
		openOracleHistory: history.openOracleHistory,
		pools: history.pools,
		forks: history.forks,
	})

	const fetchEntityHistoryPage = async (type: StateTab, item: StateEntity, cursor?: string): Promise<EntityHistory> => {
		const range = new URLSearchParams()
		for (const parameter of ['fromBlock', 'toBlock'] as const) {
			const value = pageUrl.searchParams.get(parameter)
			if (value !== null) range.set(parameter, value)
		}
		if (cursor !== undefined) range.set('cursor', cursor)
		const suffix = range.size === 0 ? '' : `?${range}`
		if (type === 'pools' && 'pool_address' in item) return decodeEntityHistory(await api(`/api/v1/state/pools/${item.chain_id}/${item.pool_address}${suffix}`))
		if (type === 'vaults' && 'vault_address' in item) return decodeEntityHistory(await api(`/api/v1/state/vaults/${item.chain_id}/${item.pool_address}/${item.vault_address}${suffix}`))
		if (type === 'questions' && 'question_id' in item) return decodeEntityHistory(await api(`/api/v1/state/questions/${item.chain_id}/${item.question_id}${suffix}`))
		if ('universe_id' in item) return decodeEntityHistory(await api(`/api/v1/state/universes/${item.chain_id}/${item.universe_id}${suffix}`))
		throw new Error(`State entity does not match the selected ${type} tab`)
	}

	const fetchEntityHistory = async (type: StateTab, item: StateEntity, throughOffset = 0): Promise<EntityHistory> => {
		let firstPage: EntityHistory | undefined
		let anchor: EntityHistoryCoverageValue | undefined
		const collected = await collectCursorCollections<unknown>(
			async cursor => {
				const page = await fetchEntityHistoryPage(type, item, cursor)
				const coverage = page.coverage
				if (coverage === undefined) throw new Error('State history response is missing coverage metadata')
				if (page.truncated === true && coverage.nextCursor === undefined) throw new Error('State history continuation is malformed')
				if (page.truncated === false && coverage.nextCursor !== undefined) throw new Error('State history completion is malformed')
				if (anchor === undefined) anchor = coverage
				else if (coverage.requestedFromBlock !== anchor.requestedFromBlock || coverage.requestedToBlock !== anchor.requestedToBlock || coverage.indexedFromBlock !== anchor.indexedFromBlock || coverage.indexedThroughBlock !== anchor.indexedThroughBlock || coverage.indexedThroughHash !== anchor.indexedThroughHash)
					throw new Error('State history changed while loading its continuation')
				firstPage ??= page
				return {
					collections: entityHistoryCollections(page),
					offset: coverage.offset,
					...(coverage.nextCursor === undefined ? {} : { nextCursor: coverage.nextCursor }),
				}
			},
			entityHistoryCollectionKeys,
			throughOffset,
		)
		if (firstPage === undefined || anchor === undefined) throw new Error('State history returned no pages')
		const anchoredCoverage = anchor
		const chronological = (records: readonly unknown[]) => records.toSorted((left, right) => (isRecord(left) && isRecord(right) ? compareCanonicalEventPosition(left, right) : 0))
		const collections = Object.fromEntries(entityHistoryCollectionKeys.map(key => [key, chronological(collected.collections[key] ?? [])]))
		const series = Object.fromEntries(entityHistoryCollectionKeys.filter(key => key in anchoredCoverage.series).map(key => [key, collections[key]?.length ?? 0]))
		const decoded = decodeEntityHistory({
			...firstPage,
			...collections,
			truncated: collected.nextCursor !== undefined,
			offset: 0,
			coverage: {
				...anchoredCoverage,
				offset: 0,
				series,
				complete: anchoredCoverage.rangeCovered === true && collected.nextCursor === undefined,
				hasPreviousPages: false,
				...(collected.nextCursor === undefined ? { nextCursor: undefined } : { nextCursor: collected.nextCursor }),
			},
		})
		return { ...decoded, loadedOffset: collected.loadedOffset }
	}

	const historySeriesLabel = (key: string): string => {
		if (key === 'snapshots') return 'checkpoints'
		if (key === 'events') return 'lifecycle'
		if (key === 'ammPrices') return 'AMM prices'
		if (key === 'repEthPrices') return 'coordinator prices'
		if (key === 'uniswapRepEthPrices') return 'Uniswap prices'
		if (key === 'openOracleHistory') return 'OpenOracle'
		return key
	}

	const historyCoverageNotice = (history: EntityHistory, type: StateTab, item: StateEntity): HTMLElement => {
		const notice = element('section', `history-coverage${history.coverage?.complete === false ? ' incomplete' : ''}`)
		const coverage = history.coverage
		if (coverage?.complete === true && coverage.rangeCovered !== false && coverage.nextCursor === undefined) {
			if ((history.loadedOffset ?? 0) > 0) {
				notice.className = 'sr-only state-history-complete'
				notice.tabIndex = -1
				notice.setAttribute('role', 'status')
				notice.textContent = 'History complete'
			} else notice.hidden = true
			return notice
		}
		if (coverage === undefined) {
			notice.append(element('strong', '', 'History coverage unavailable'), element('span', '', 'This response did not include an indexed range boundary.'))
			return notice
		}
		const collections = entityHistoryCollections(history)
		const recordCollections = Object.fromEntries(entityHistoryCollectionKeys.map(key => [key, collections[key].filter(isRecord)]))
		const summary = summarizeHistoryCollections(recordCollections, entityHistoryCollectionKeys)
		const loadedRange = historyBlockRangeLabel(summary.oldestBlock, summary.newestBlock, 'No block-numbered records loaded')
		const seriesCounts = Object.entries(coverage.series)
			.map(([key, count]) => `${historySeriesLabel(key)} ${number(count)}`)
			.join(' · ')
		const indexedRange = `#${number(coverage.indexedFromBlock)}–${coverage.indexedThroughBlock === undefined ? 'pending' : `#${number(coverage.indexedThroughBlock)}`}`
		const requestedRange = `#${number(coverage.requestedFromBlock)}–#${number(coverage.requestedToBlock)}`
		notice.append(
			element('strong', '', historyCoverageHeadline(coverage.nextCursor !== undefined, coverage.rangeCovered === false)),
			element('span', '', `${loadedRange} · ${seriesCounts || 'no historical series'}. Requested ${requestedRange}; scanner coverage ${indexedRange}.${coverage.rangeCovered === false ? ' Narrow the requested range or backfill the missing blocks.' : ''}`),
		)
		if (coverage.nextCursor !== undefined) {
			const pagination = element('div', 'history-coverage-pagination')
			const showOlder = element('button', 'secondary compact state-history-more', 'Show older history')
			showOlder.type = 'button'
			showOlder.setAttribute('aria-label', `Show older ${type.slice(0, -1)} history`)
			const status = element('p', 'state-history-status')
			status.setAttribute('role', 'status')
			status.setAttribute('aria-live', 'polite')
			showOlder.addEventListener('click', async () => {
				const scrollY = window.scrollY
				const pendingPresentation = entityHistoryContinuationPresentation('pending')
				showOlder.disabled = true
				showOlder.setAttribute('aria-busy', 'true')
				showOlder.textContent = pendingPresentation.buttonLabel
				status.textContent = pendingPresentation.statusText
				status.classList.toggle('sr-only', pendingPresentation.statusVisuallyHidden)
				const loaded = await selectEntity(item, {
					preserveDetail: true,
					pagination: true,
					historyTargetOffset: (history.loadedOffset ?? 0) + coverage.limit,
				})
				if (loaded) {
					const nextControl = $('#state-detail').querySelector<HTMLElement>('.state-history-more, .state-history-complete')
					nextControl?.focus({ preventScroll: true })
					window.scrollTo({ top: scrollY, behavior: 'auto' })
				} else if (showOlder.isConnected) {
					const errorPresentation = entityHistoryContinuationPresentation('error')
					showOlder.disabled = false
					showOlder.removeAttribute('aria-busy')
					showOlder.textContent = errorPresentation.buttonLabel
					status.textContent = errorPresentation.statusText
					status.classList.toggle('sr-only', errorPresentation.statusVisuallyHidden)
					showOlder.focus({ preventScroll: true })
				}
			})
			pagination.append(showOlder, status)
			notice.append(pagination)
			if (isDemo && pageUrl.searchParams.get('stateHistoryAutoLoad') === '1' && !demoStateHistoryAutoLoadConsumed) {
				demoStateHistoryAutoLoadConsumed = true
				window.setTimeout(() => {
					if (showOlder.isConnected) {
						showOlder.focus({ preventScroll: true })
						showOlder.click()
					}
				}, 0)
			}
		} else if ((history.loadedOffset ?? 0) > 0) {
			notice.classList.add('state-history-complete')
			notice.tabIndex = -1
			notice.setAttribute('role', 'status')
			notice.setAttribute('aria-live', 'polite')
		}
		return notice
	}

	const renderPoolDetail = async (poolItem: PoolRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await fetchEntityHistory('pools', poolItem))
		if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
		const poolNativeSymbol = nativeSymbol(poolItem.chain_id)
		const ammPrices = history.ammPrices ?? []
		const repEthPrices = history.repEthPrices ?? []
		const uniswapRepEthPrices = history.uniswapRepEthPrices ?? []
		const openOracleHistory = history.openOracleHistory ?? []
		const uniswapChart = uniswapPriceChartModel(uniswapRepEthPrices)
		const uniswapLiquidity = uniswapLiquidityChartModel(uniswapRepEthPrices)
		const latestAmmPrice = ammPrices.at(-1)
		const latestRepEthPrice = repEthPrices.at(-1)
		const latestUniswapPrice = uniswapChart.latestObservation
		const fragment = document.createDocumentFragment()
		fragment.append(stateHeader('Security pool', poolItem.question_title ?? 'Unknown question', `${poolItem.pool_address} · universe ${shortIdentifier(poolItem.universe_id, 8, 6)}`, 'Latest available'))
		fragment.append(historyCoverageNotice(history, 'pools', poolItem))
		fragment.append(
			operationsPanel(
				'OpenOracle coordinator state and history',
				openOracleHistory.map(observation => operationRow(String(observation['event_name'] ?? 'Coordinator transition'), String(observation['summary'] ?? 'Canonical OpenOracle coordinator evidence'), String(observation['coordinator_address'] ?? poolItem.coordinator_address), observation['block_number'])),
				'No OpenOracle coordinator state transitions match this view.',
			),
		)
		const metrics = element('div', 'metric-grid')
		metrics.append(
			metricCard('Settlement collateral', exactUnit(poolItem.settlement_collateral_atto_eth ?? poolItem.initial_settlement_collateral_atto_eth, 18, poolNativeSymbol, 2)),
			metricCard('Capacity ownership', exactUnit(poolItem.total_capacity_ownership_atto_rep, 18, 'REP', 2)),
			metricCard('Claimable vault fees', exactUnit(poolItem.total_claimable_vault_fees_atto_eth, 18, poolNativeSymbol, 3)),
			metricCard('Vaults', number(poolItem.vault_count)),
			metricCard('Conditional YES', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_yes_bps, 2, '%', 2)),
			metricCard('Conditional NO', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_no_bps, 2, '%', 2)),
			metricCard('REP / ETH', latestRepEthPrice === undefined ? 'No coordinator price' : exactUnit(latestRepEthPrice.rep_per_eth_1e18, 18, 'REP/ETH', 4)),
			metricCard('Latest Uniswap spot', latestUniswapPrice === undefined ? 'No Uniswap price' : exactUnit(latestUniswapPrice.rep_per_eth_1e18, 18, `REP/${latestUniswapPrice.quote_symbol}`, 4), latestUniswapPrice === undefined ? undefined : uniswapPriceProvenance(latestUniswapPrice)),
			metricCard('AMM market', history.market === undefined ? 'Unavailable' : `${number(ammPrices.length)} observations`),
		)
		fragment.append(metrics)
		fragment.append(
			chartCard(
				'Pool accounting history',
				history.snapshots,
				[
					{ key: 'settlement_collateral_atto_eth', label: 'Collateral', unit: poolNativeSymbol },
					{ key: 'total_capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
					{ key: 'total_claimable_vault_fees_atto_eth', label: 'Claimable fees', unit: poolNativeSymbol, className: 'tertiary' },
				],
				'Authoritative PoolAccountingCheckpoint results. Collateral and fees use attoETH; capacity ownership uses attoREP.',
			),
			chartCard(
				'Uniswap REP price curves',
				uniswapChart.rows,
				uniswapChart.definitions,
				'Event-time marginal prices derived from V2 Sync reserves and V3/V4 Initialize or Swap sqrt prices. Curves retain their explicit WETH, native ETH, or USDC quote orientation. These values can be manipulated within a block and are not a TWAP or protocol oracle.',
				{
					sharedRange: uniswapChart.sharedRange,
					emptyMessage: 'No Uniswap REP / ETH or REP / USDC pool observations match this view.',
				},
			),
			chartCard(
				'Uniswap liquidity over time',
				uniswapLiquidity.rows,
				uniswapLiquidity.definitions,
				'V2 points preserve the exact reserve product. V3 and V4 points preserve the exact active-liquidity integer emitted by Swap. Each venue is raw protocol evidence and is not silently normalized across token decimal systems.',
				{ emptyMessage: 'No Uniswap liquidity observations match this view.' },
			),
		)
		fragment.append(
			chartCard(
				'Conditional YES / NO spot price history',
				ammPrices,
				[
					{ key: 'conditional_yes_bps', label: 'Conditional YES', decimals: 2, unit: '%' },
					{ key: 'conditional_no_bps', label: 'Conditional NO', decimals: 2, unit: '%', className: 'secondary' },
				],
				'Each point is derived from the exact YES/NO reserves emitted by an Augur AMM Sync event. Prices are conditional on a valid resolution and are manipulable spot values, not a TWAP or protocol oracle.',
				{ sharedRange: [0, 100], axisUnit: '%', emptyMessage: 'No Augur AMM reserve observations match this view.' },
			),
			chartCard(
				'REP / ETH coordinator price history',
				repEthPrices,
				[
					{
						key: 'rep_per_eth_1e18',
						label: 'REP per ETH',
						unit: 'REP/ETH',
						pointShape: row => (row.event_name === 'RepEthPriceSet' ? 'diamond' : 'circle'),
						pointLabel: row => (row.event_name === 'RepEthPriceSet' ? 'Initialization seed' : 'Accepted settlement'),
					},
				],
				'Coordinator price state. RepEthPriceSet records initialization and does not establish timestamp-based oracle validity; PriceReported points are accepted settlements.',
				{
					legendItems: [{ label: 'Initialization', className: 'initialization' }],
					emptyMessage: 'No REP / ETH coordinator price observations match this view.',
				},
			),
		)
		const currentCard = element('section', 'static-card')
		currentCard.append(element('h4', '', 'Latest available accounting and lifecycle'))
		const currentGrid = element('div', 'static-grid')
		const systemStates = ['Operational', 'Pool forked', 'Fork migration', 'Fork truth auction']
		const currentState = poolItem.current_state ?? {}
		currentGrid.append(
			staticField('System state', currentState.systemState === undefined ? 'No lifecycle event yet' : (systemStates[Number(currentState.systemState)] ?? `State ${currentState.systemState}`)),
			staticField('Awaiting fork continuation', yesNoCheckpoint(currentState.awaitingForkContinuation)),
			staticField('Total REP backing units', currentState.totalRepBackingUnits === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.totalRepBackingUnits), 18, '', 3)),
			staticField('Share-token supply', currentState.shareTokenSupplyAttoShares === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.shareTokenSupplyAttoShares), 18, 'shares', 3)),
			staticField('Fee-eligible capacity ownership', exactUnit(poolItem.fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
			staticField('Unallocated accrued fees', exactUnit(poolItem.unallocated_accrued_fees_atto_eth, 18, poolNativeSymbol, 5)),
			staticField('Current retention rate', exactUnit(poolItem.current_retention_rate, 18, '', 9)),
			typeof currentState.escalationGame === 'string' && currentState.escalationGame !== '' ? staticAddressField('Escalation game', currentState.escalationGame, poolItem.chain_id) : staticField('Escalation game', 'Not set'),
		)
		currentCard.append(currentGrid)
		fragment.append(currentCard)
		const staticCard = element('section', 'static-card')
		staticCard.append(element('h4', '', 'Immutable deployment configuration'))
		const grid = element('div', 'static-grid')
		grid.append(
			staticField('Question ID', poolItem.question_id),
			staticAddressField('Parent pool', poolItem.parent_address, poolItem.chain_id),
			staticAddressField('Share token', poolItem.share_token_address, poolItem.chain_id),
			staticAddressField('Price coordinator', poolItem.coordinator_address, poolItem.chain_id),
			history.market === undefined || history.market === null ? staticField('Augur AMM pair', 'Unavailable') : staticAddressField('Augur AMM pair', history.market.pair_address, poolItem.chain_id),
			staticField('Augur AMM fee', history.market === undefined || history.market === null ? '—' : `${Number(history.market.fee_bps) / 100}%`),
			staticAddressField('Truth auction', poolItem.truth_auction_address, poolItem.chain_id),
			staticField('Security multiplier', `${Number(poolItem.security_multiplier_bps) / 100}%`),
			staticField('Initial priority fee', exactUnit(poolItem.initial_priority_fee_atto_eth_per_gas, 9, 'gwei', 2)),
			staticField('Child pools', number(poolItem.child_count)),
		)
		staticCard.append(grid)
		if (history.market?.pair_address) {
			const analyticsLink = document.createElement('a')
			analyticsLink.className = 'secondary compact state-analytics-link'
			analyticsLink.href = operationsHref(`/operations/trading/${encodeURIComponent(history.market.pair_address)}`)
			analyticsLink.textContent = 'Open AMM trading analytics'
			staticCard.append(analyticsLink)
		}
		fragment.append(staticCard)
		$('#state-detail').replaceChildren(fragment)
	}

	const renderVaultDetail = async (vaultItem: VaultRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await fetchEntityHistory('vaults', vaultItem))
		if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
		const vaultNativeSymbol = nativeSymbol(vaultItem.chain_id)
		const fragment = document.createDocumentFragment()
		fragment.append(stateHeader('Security vault', vaultItem.vault_address, `Pool ${vaultItem.pool_address}`, 'Latest available'))
		fragment.append(historyCoverageNotice(history, 'vaults', vaultItem))
		const metrics = element('div', 'metric-grid')
		metrics.append(
			metricCard('REP backing units', exactUnit(vaultItem.rep_backing_units, 18, '', 2)),
			metricCard('Capacity ownership', exactUnit(vaultItem.capacity_ownership_atto_rep, 18, 'REP', 2)),
			metricCard('Claimable fees', exactUnit(vaultItem.claimable_fees_atto_eth, 18, vaultNativeSymbol, 4)),
			metricCard('Fee index', exactUnit(vaultItem.fee_index, 18, '', 5)),
		)
		fragment.append(metrics)
		fragment.append(
			chartCard(
				'Vault accounting history',
				history.snapshots,
				[
					{ key: 'rep_backing_units', label: 'REP backing units', unit: 'units' },
					{ key: 'capacity_ownership_atto_rep', label: 'Capacity ownership', unit: 'REP', className: 'secondary' },
					{ key: 'claimable_fees_atto_eth', label: 'Claimable fees', unit: vaultNativeSymbol, className: 'tertiary' },
				],
				'VaultAccountingCheckpoint history. REP backing units are protocol accounting units; capacity ownership uses attoREP and fees use attoETH.',
			),
		)
		const staticCard = element('section', 'static-card')
		staticCard.append(element('h4', '', 'Identity and complete current checkpoint'))
		const grid = element('div', 'static-grid')
		grid.append(
			staticAddressField('Vault address', vaultItem.vault_address, vaultItem.chain_id),
			staticAddressField('Pool address', vaultItem.pool_address, vaultItem.chain_id),
			staticField('Question', vaultItem.question_title),
			staticField('Last block', `#${number(vaultItem.block_number)}`),
			staticField('Fee remainder (1e18 denominator)', vaultItem.vault_fee_remainder),
			staticField('Resulting pool-held REP backing units', exactUnit(vaultItem.resulting_total_rep_backing_units, 18, '', 3)),
			staticField('Resulting fee-eligible capacity', exactUnit(vaultItem.resulting_fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
			staticField('Fee index', exactUnit(vaultItem.fee_index, 18, '', 8)),
		)
		staticCard.append(grid)
		fragment.append(staticCard)
		$('#state-detail').replaceChildren(fragment)
	}

	const questionStatus = (question: QuestionRecord): string => {
		const now = Date.now()
		if (now < new Date(question.start_time).getTime()) return 'Scheduled'
		if (now < new Date(question.end_time).getTime()) return 'Open'
		return 'Ended'
	}

	const renderQuestionDetail = async (question: QuestionRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await fetchEntityHistory('questions', question))
		if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
		const kind = question.outcome_options.length === 0 ? 'Scalar' : 'Categorical'
		const fragment = document.createDocumentFragment()
		fragment.append(stateHeader('Immutable question', question.title, `ID ${short(question.question_id, 10, 8)}`, `${kind} · ${questionStatus(question)}`))
		fragment.append(historyCoverageNotice(history, 'questions', question))
		const metrics = element('div', 'metric-grid')
		metrics.append(metricCard('Status', questionStatus(question)), metricCard('Linked pools', number(question.pool_count)), metricCard('Universe forks', number(question.fork_count)), metricCard('Answer type', kind))
		fragment.append(metrics)
		const definition = element('section', 'static-card')
		definition.append(element('h4', '', 'Question definition — immutable after creation'), element('p', 'question-description', question.description))
		const outcomes = element('div', 'outcomes')
		const labels = question.outcome_options.length > 0 ? ['Invalid', ...question.outcome_options] : [`${exactUnit(question.display_value_min, 18, question.answer_unit)} → ${exactUnit(question.display_value_max, 18, question.answer_unit)}`, `${number(question.num_ticks)} ticks`]
		for (const label of labels) outcomes.append(element('span', 'outcome', label))
		definition.append(outcomes)
		const timeline = element('div', 'timeline')
		for (const [label, value] of [
			['Created', question.created_timestamp],
			['Starts', question.start_time],
			['Ends', question.end_time],
		] as const)
			timeline.append(element('div', 'timeline-step', `${label} · ${new Date(value).toLocaleDateString('en-GB')}`))
		definition.append(timeline)
		fragment.append(definition)
		const usage = element('section', 'static-card')
		usage.append(element('h4', '', 'Protocol usage'))
		const grid = element('div', 'static-grid')
		grid.append(staticField('Pool deployments', String(history.pools.length)), staticField('Universe forks using this question', String(history.forks.length)), staticField('Question ID', question.question_id), staticField('Created block evidence', `#${number(question.block_number)}`))
		usage.append(grid, element('p', 'data-note', 'Question metadata has no mutable onchain fields. Pool deployments and universe forks are tracked separately as historical usage.'))
		fragment.append(usage)
		$('#state-detail').replaceChildren(fragment)
	}

	const renderLineage = (universes: UniverseRecord[], selected: UniverseRecord): SVGSVGElement => {
		const byKey = new Map(universes.map(universe => [`${universe.chain_id}:${universe.universe_id}`, universe]))
		const depth = (universe: UniverseRecord, seen = new Set<string>()): number => {
			const key = `${universe.chain_id}:${universe.universe_id}`
			if (seen.has(key) || universe.parent_universe_id === universe.universe_id) return 0
			seen.add(key)
			const parent = byKey.get(`${universe.chain_id}:${universe.parent_universe_id}`)
			return parent === undefined ? 0 : depth(parent, seen) + 1
		}
		const positions = new Map<string, { x: number; y: number }>()
		const levels = new Map<number, UniverseRecord[]>()
		for (const universe of universes) {
			const level = depth(universe)
			const members = levels.get(level) ?? []
			members.push(universe)
			levels.set(level, members)
		}
		const maximumLevel = Math.max(0, ...levels.keys())
		const maximumMembers = Math.max(1, ...[...levels.values()].map(members => members.length))
		const nodeWidth = 210
		const columnGap = 285
		const rowGap = 70
		const width = 60 + maximumLevel * columnGap + nodeWidth
		const height = 40 + maximumMembers * rowGap
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
		svg.setAttribute('class', 'lineage-graph')
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
		svg.setAttribute('width', String(width))
		svg.setAttribute('height', String(height))
		svg.setAttribute('role', 'img')
		svg.setAttribute('aria-label', 'Zoltar universe parent and child relationships')
		for (const [level, members] of levels)
			members.forEach((universe, index) => {
				positions.set(`${universe.chain_id}:${universe.universe_id}`, { x: 30 + level * columnGap, y: 20 + index * rowGap })
			})
		for (const universe of universes) {
			if (universe.parent_universe_id === universe.universe_id) continue
			const from = positions.get(`${universe.chain_id}:${universe.parent_universe_id}`)
			const to = positions.get(`${universe.chain_id}:${universe.universe_id}`)
			if (from === undefined || to === undefined) continue
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
			line.setAttribute('class', 'lineage-link')
			line.setAttribute('x1', String(from.x + nodeWidth))
			line.setAttribute('y1', String(from.y + 25))
			line.setAttribute('x2', String(to.x))
			line.setAttribute('y2', String(to.y + 25))
			svg.append(line)
		}
		for (const universe of universes) {
			const position = positions.get(`${universe.chain_id}:${universe.universe_id}`)
			if (position === undefined) continue
			const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
			group.setAttribute('class', `lineage-node${universe === selected ? ' selected' : ''}`)
			group.setAttribute('transform', `translate(${position.x} ${position.y})`)
			const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
			rect.setAttribute('width', String(nodeWidth))
			rect.setAttribute('height', '50')
			rect.setAttribute('rx', '7')
			const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			label.setAttribute('x', '10')
			label.setAttribute('y', '20')
			label.textContent = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 7, 5)}`
			const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text')
			meta.setAttribute('class', 'node-meta')
			meta.setAttribute('x', '10')
			meta.setAttribute('y', '37')
			meta.textContent = `${counted(universe.pool_count, 'pool')} · outcome ${universe.forking_outcome_index}`
			group.append(rect, label, meta)
			svg.append(group)
		}
		return svg
	}

	const renderUniverseDetail = async (universe: UniverseRecord, requestVersion: number, canonicalGeneration: number, suppliedHistory?: EntityHistory): Promise<void> => {
		const history = suppliedHistory ?? (await fetchEntityHistory('universes', universe))
		if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
		const fragment = document.createDocumentFragment()
		const title = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 12, 8)}`
		fragment.append(stateHeader('Zoltar universe', title, `Outcome ${universe.forking_outcome_index} · parent ${shortIdentifier(universe.parent_universe_id, 8, 6)}`, universe.active_fork_time ? 'Forked' : 'Active'))
		fragment.append(historyCoverageNotice(history, 'universes', universe))
		const metrics = element('div', 'metric-grid')
		metrics.append(
			metricCard('Theoretical REP supply', exactUnit(universe.theoretical_supply_atto_rep, 18, 'REP', 1)),
			metricCard('Child universes', number(universe.child_count)),
			metricCard('Security pools', number(universe.pool_count)),
			metricCard('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toLocaleDateString('en-GB') : 'Not forked'),
		)
		fragment.append(metrics)
		fragment.append(
			chartCard(
				'Theoretical REP supply history',
				history.events.filter(event => event['theoretical_supply_atto_rep'] !== null),
				[{ key: 'theoretical_supply_atto_rep', label: 'Theoretical REP', unit: 'REP' }],
				'Supply changes are recorded from initialization, fork, burn, and migration events.',
			),
		)
		const lineage = element('section', 'lineage-card')
		const heading = element('div', 'chart-heading')
		const catalog = stateData
		if (catalog === undefined) throw new Error('System state catalog is unavailable')
		heading.append(element('h4', '', 'Zoltar universes'), element('span', 'data-note', counted(catalog.universes.length, 'universe')))
		const scroll = element('div', 'lineage-scroll')
		scroll.append(renderLineage(catalog.universes, universe))
		lineage.append(heading, scroll)
		fragment.append(lineage)
		const identity = element('section', 'static-card')
		identity.append(element('h4', '', 'Immutable universe identity'))
		const grid = element('div', 'static-grid')
		grid.append(
			staticField('Universe ID', universe.universe_id),
			staticField('Parent universe', universe.parent_universe_id),
			staticField('Forking outcome', universe.forking_outcome_index),
			staticAddressField('REP token', universe.reputation_token_address, universe.chain_id),
			staticField('Fork question', universe.active_fork_question_id),
			staticField('Fork time', universe.active_fork_time ? new Date(universe.active_fork_time).toISOString() : 'Not forked'),
			staticAddressField('Fork initiator', universe.forker_address, universe.chain_id),
			staticField('Fork threshold', exactUnit(universe.fork_threshold_atto_rep, 18, 'REP', 3)),
			staticField('Fork initiator migration balance at fork', exactUnit(universe.migration_rep_balance_atto_rep, 18, 'REP', 3)),
		)
		identity.append(grid)
		fragment.append(identity)
		$('#state-detail').replaceChildren(fragment)
	}

	const entityKey = (type: StateTab, item: StateEntity): string => {
		if (type === 'pools' && 'pool_address' in item) return `${item.chain_id}:${item.pool_address}`
		if (type === 'vaults' && 'vault_address' in item) return `${item.chain_id}:${item.pool_address}:${item.vault_address}`
		if (type === 'questions' && 'question_id' in item) return `${item.chain_id}:${item.question_id}`
		if ('universe_id' in item) return `${item.chain_id}:${item.universe_id}`
		throw new Error(`State entity does not match the selected ${type} tab`)
	}

	const entityCopy = (type: StateTab, item: StateEntity): [string, string] => {
		if (type === 'pools' && 'settlement_collateral_atto_eth' in item) return [item.question_title ?? short(item.pool_address), `${counted(item.vault_count, 'vault')} · ${exactUnit(item.settlement_collateral_atto_eth, 18, nativeSymbol(item.chain_id), 1)}`]
		if (type === 'vaults' && 'vault_address' in item) return [short(item.vault_address, 10, 6), `${exactUnit(item.capacity_ownership_atto_rep, 18, 'REP', 1)} capacity`]
		if (type === 'questions' && 'outcome_options' in item) return [item.title, `${questionStatus(item)} · ${counted(item.pool_count, 'pool')}`]
		if ('universe_id' in item && 'pool_count' in item) return [item.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(item.universe_id, 9, 6)}`, `${counted(item.child_count, 'child', 'children')} · ${counted(item.pool_count, 'pool')}`]
		throw new Error(`State entity does not match the selected ${type} tab`)
	}

	const performSelectEntity = async (item: StateEntity, { preserveDetail = false, quiet = false, pagination = false, historyTargetOffset, contextVersion, suppliedHistory }: SelectEntityOptions = {}): Promise<boolean> => {
		if (contextVersion !== stateDetailContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		const nextEntityKey = entityKey(activeStateType, item)
		if (selectedEntityKey !== nextEntityKey) selectedEntityHistoryOffset = 0
		selectedEntityKey = nextEntityKey
		const targetHistoryOffset = historyTargetOffset ?? selectedEntityHistoryOffset
		for (const row of document.querySelectorAll<HTMLElement>('.entity-row')) row.setAttribute('aria-selected', String(row.dataset.key === selectedEntityKey))
		const requestVersion = ++stateDetailRequestVersion
		const detail = $('#state-detail')
		const presentation = refreshPresentation({ live: quiet })
		detail.setAttribute('aria-busy', String(presentation.busy))
		const replaceWithLoading = presentation.loadingState && (!preserveDetail || detail.childElementCount === 0)
		const existingRefreshStatus = detail.querySelector<HTMLElement>('.detail-refresh-status')
		if (presentation.loadingState) existingRefreshStatus?.remove()
		let refreshStatus = presentation.loadingState ? undefined : existingRefreshStatus
		if (replaceWithLoading) detail.replaceChildren(element('div', 'state-placeholder', 'Loading historical checkpoints…'))
		else if (!quiet && !pagination) {
			refreshStatus = element('div', 'system-status detail-refresh-status', 'Refreshing historical checkpoints…')
			refreshStatus.setAttribute('role', 'status')
			detail.prepend(refreshStatus)
		}
		const url = new URL(location.href)
		url.searchParams.set('tab', activeStateType)
		url.searchParams.set('entity', selectedEntityKey)
		history.replaceState(null, '', url)
		try {
			const loadedHistory = suppliedHistory ?? (await fetchEntityHistory(activeStateType, item, targetHistoryOffset))
			if (activeStateType === 'pools' && 'settlement_collateral_atto_eth' in item) await renderPoolDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			if (activeStateType === 'vaults' && 'vault_address' in item) await renderVaultDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			if (activeStateType === 'questions' && 'outcome_options' in item) await renderQuestionDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			if (activeStateType === 'universes' && 'reputation_token_address' in item) await renderUniverseDetail(item, requestVersion, canonicalGeneration, loadedHistory)
			const current = isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
			if (current) selectedEntityHistoryOffset = loadedHistory.loadedOffset ?? 0
			return current
		} catch (error) {
			if (isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
				if (pagination) {
					// The pagination control remains mounted and presents its local retry state.
				} else if (replaceWithLoading) {
					const failure = element('div', 'state-error')
					failure.append(element('span', '', `State history unavailable: ${errorMessage(error)}`))
					const retry = element('button', '', 'Retry')
					retry.type = 'button'
					retry.addEventListener('click', () => retryCanonicalViewOr(() => selectEntity(item)))
					failure.append(retry)
					detail.replaceChildren(failure)
				} else {
					const failure = refreshStatus ?? element('div', 'system-status detail-refresh-status')
					failure.classList.add('error')
					failure.setAttribute('role', 'alert')
					failure.replaceChildren(element('span', '', `Historical refresh failed; showing last known details: ${errorMessage(error)}`))
					const retry = element('button', '', 'Retry')
					retry.type = 'button'
					retry.addEventListener('click', () => retryCanonicalViewOr(() => selectEntity(item, { preserveDetail: true })))
					failure.append(retry)
					if (refreshStatus === undefined) detail.prepend(failure)
				}
			}
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) $('#state-detail').setAttribute('aria-busy', 'false')
		}
	}

	const selectEntity = (item: StateEntity, options: SelectEntityOptions = {}): Promise<boolean> => {
		if (options.quiet !== true) {
			stateDetailContextVersion++
			stateDetailRequestVersion++
		}
		const contextVersion = stateDetailContextVersion
		const operation = () => performSelectEntity(item, { ...options, contextVersion })
		return options.quiet === true ? systemDetailRefreshGate.runBackground(operation) : systemDetailRefreshGate.runForeground(operation)
	}

	const selectEntityWhileReserved = (item: StateEntity, options: SelectEntityOptions = {}): Promise<boolean> => {
		if (options.quiet !== true) {
			stateDetailContextVersion++
			stateDetailRequestVersion++
		}
		return performSelectEntity(item, { ...options, contextVersion: stateDetailContextVersion })
	}

	const stateItems = (catalog: StateCatalog, type: StateTab): StateEntity[] => {
		if (type === 'pools') return catalog.pools
		if (type === 'vaults') return catalog.vaults
		if (type === 'questions') return catalog.questions
		return catalog.universes
	}

	const renderEntityList = async ({ refreshSelected = false, live = false, selectedHistory, detailGateReserved = false }: RenderEntityListOptions = {}): Promise<boolean> => {
		const query = $('#entity-search').value.trim().toLowerCase()
		if (stateData === undefined) throw new Error('System state catalog is unavailable')
		const catalogItems = stateItems(stateData, activeStateType)
		const items = catalogItems.filter(item => !query || entityCopy(activeStateType, item).join(' ').toLowerCase().includes(query))
		$('#entity-list-title').textContent = `All ${activeStateType}`
		$('#entity-count').textContent = String(items.length)
		$('#entity-search').placeholder = `Filter ${activeStateType}…`
		const list = $('#entity-list')
		const previousRows = liveSnapshot(list, '.entity-row[data-live-key]')
		list.replaceChildren()
		for (const item of items) {
			const [title, meta] = entityCopy(activeStateType, item)
			const row = setLiveRecord(element('button', 'entity-row'), entityKey(activeStateType, item), item)
			row.type = 'button'
			row.dataset.key = entityKey(activeStateType, item)
			row.setAttribute('role', 'option')
			row.setAttribute('aria-selected', String(row.dataset.key === selectedEntityKey))
			row.append(element('span', 'entity-row-title', title), element('span', 'entity-row-meta', meta))
			row.addEventListener('click', () => selectEntity(item))
			list.append(row)
		}
		applyLiveChanges(list, previousRows, { live, selector: '.entity-row[data-live-key]' })
		list.setAttribute('aria-busy', 'false')
		const selected = items.find(item => entityKey(activeStateType, item) === selectedEntityKey)
		if (selected !== undefined) {
			if (refreshSelected) {
				const select = detailGateReserved ? selectEntityWhileReserved : selectEntity
				return await select(selected, { preserveDetail: true, quiet: live, suppliedHistory: selectedHistory })
			}
			return true
		}
		if (items[0] !== undefined) {
			const select = detailGateReserved ? selectEntityWhileReserved : selectEntity
			return await select(items[0], { preserveDetail: live, quiet: live, suppliedHistory: selectedHistory })
		}
		stateDetailContextVersion++
		stateDetailRequestVersion++
		selectedEntityKey = undefined
		$('#state-detail').setAttribute('aria-busy', 'false')
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', `No ${activeStateType} match this view.`))
		return true
	}

	const renderStateStats = ({ live = false } = {}) => {
		if (stateData === undefined) throw new Error('System state catalog is unavailable')
		const stats = $('#state-stats')
		const previousStats = liveSnapshot(stats, '.state-stat[data-live-key]')
		stats.replaceChildren()
		const statGroups: Array<readonly [string, keyof NonNullable<StateCatalog['totals']>, readonly StateEntity[]]> = [
			['Pools', 'pools', stateData.pools],
			['Questions', 'questions', stateData.questions],
			['Vaults', 'vaults', stateData.vaults],
			['Universes', 'universes', stateData.universes],
		]
		for (const [label, key, items] of statGroups) {
			const total = stateData.totals?.[key] ?? items.length
			const card = setLiveRecord(element('div', 'state-stat'), label.toLowerCase(), String(total))
			card.append(element('span', '', label), element('strong', '', number(total)))
			stats.append(card)
		}
		applyLiveChanges(stats, previousStats, { live, selector: '.state-stat[data-live-key]' })
		stats.setAttribute('aria-busy', 'false')
	}

	const setSystemControlsDisabled = (disabled: boolean) => {
		$('#entity-search').disabled = disabled
		for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-state-tab]')) tab.disabled = disabled
		for (const row of document.querySelectorAll<HTMLButtonElement>('.entity-row')) row.disabled = disabled
	}

	const performLoadSystemState = async ({ live = false, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== viewContextVersion) return false
		const canonicalGeneration = canonicalDataGeneration
		const requestVersion = ++catalogRequestVersion
		const alert = $('#system-alert')
		const status = $('#system-status')
		const hadData = stateData !== undefined
		const presentation = refreshPresentation({ live })
		if (presentation.loadingState) {
			alert.hidden = true
			alert.replaceChildren()
			status.hidden = false
			status.textContent = hadData ? 'Refreshing registry…' : 'Loading registry…'
		}
		setSystemControlsDisabled(presentation.busy)
		$('#state-stats').setAttribute('aria-busy', String(presentation.busy))
		$('#entity-list').setAttribute('aria-busy', String(presentation.busy))
		try {
			const nextStateData = decodeStateCatalog(await api(`/api/v1/state/catalog?chainId=${requiredChainId()}`))
			if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			for (const poolItem of nextStateData.pools) poolItem.current_state = {}
			const orderedPoolStates = (nextStateData.poolStates ?? []).toSorted((left, right) => Number(left.block_number) - Number(right.block_number) || Number(left.log_index) - Number(right.log_index))
			for (const state of orderedPoolStates) {
				const poolItem = nextStateData.pools.find(candidate => String(candidate.chain_id) === String(state.chain_id) && candidate.pool_address === state.pool_address)
				if (poolItem?.current_state !== undefined) Object.assign(poolItem.current_state, state.state)
			}
			const stagedStateType = activeStateType
			const stagedDetailContext = stateDetailContextVersion
			const query = $('#entity-search').value.trim().toLowerCase()
			const visibleItems = stateItems(nextStateData, stagedStateType).filter(item => !query || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(query))
			const selectedItem = visibleItems.find(item => entityKey(stagedStateType, item) === selectedEntityKey) ?? visibleItems[0]
			const stagedSelectedKey = selectedItem === undefined ? undefined : entityKey(stagedStateType, selectedItem)
			const selectedHistory = selectedItem === undefined ? undefined : await fetchEntityHistory(stagedStateType, selectedItem, selectedEntityHistoryOffset)
			const currentQuery = $('#entity-search').value.trim().toLowerCase()
			const currentVisibleItems = stateItems(nextStateData, stagedStateType).filter(item => !currentQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(currentQuery))
			const currentSelectedItem = currentVisibleItems.find(item => entityKey(stagedStateType, item) === selectedEntityKey) ?? currentVisibleItems[0]
			const currentSelectedKey = currentSelectedItem === undefined ? undefined : entityKey(stagedStateType, currentSelectedItem)
			if (
				!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) ||
				!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration) ||
				stagedDetailContext !== stateDetailContextVersion ||
				stagedStateType !== activeStateType ||
				query !== currentQuery ||
				stagedSelectedKey !== currentSelectedKey
			)
				return false
			return await runWithForegroundReservation(systemDetailRefreshGate, async () => {
				const reservedQuery = $('#entity-search').value.trim().toLowerCase()
				const reservedVisibleItems = stateItems(nextStateData, stagedStateType).filter(item => !reservedQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(reservedQuery))
				const reservedSelectedItem = reservedVisibleItems.find(item => entityKey(stagedStateType, item) === selectedEntityKey) ?? reservedVisibleItems[0]
				const reservedSelectedKey = reservedSelectedItem === undefined ? undefined : entityKey(stagedStateType, reservedSelectedItem)
				if (
					!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) ||
					!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration) ||
					stagedDetailContext !== stateDetailContextVersion ||
					stagedStateType !== activeStateType ||
					query !== reservedQuery ||
					stagedSelectedKey !== reservedSelectedKey
				)
					return false
				const renderScrollY = window.scrollY
				stateData = nextStateData
				renderStateStats({ live })
				const detailRefreshed = await renderEntityList({ refreshSelected: true, live, selectedHistory, detailGateReserved: true })
				if (live) window.scrollTo({ top: renderScrollY, behavior: 'instant' })
				if (!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
				status.hidden = true
				alert.hidden = true
				alert.replaceChildren()
				const truncated = Object.entries(stateData.truncated ?? {})
					.filter(([, value]) => value)
					.map(([name]) => name)
				if (truncated.length > 0) {
					alert.hidden = false
					alert.append(element('span', '', `Large registry: showing ${stateData.limit} ${truncated.join(', ')} records for this network.`))
				}
				return detailRefreshed
			})
		} catch (error) {
			if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
				$('#state-stats').setAttribute('aria-busy', 'false')
				$('#entity-list').setAttribute('aria-busy', 'false')
				$('#state-detail').setAttribute('aria-busy', 'false')
				alert.hidden = false
				alert.replaceChildren()
				status.hidden = true
				alert.append(element('span', '', hadData ? `Refresh failed; showing last known state: ${errorMessage(error)}` : `System state unavailable: ${errorMessage(error)}`))
				const retry = element('button', '', 'Retry')
				retry.type = 'button'
				retry.addEventListener('click', () => retryCanonicalViewOr(loadSystemState))
				alert.append(retry)
				if (!hadData) {
					$('#entity-list-title').textContent = 'Registry unavailable'
					$('#entity-count').textContent = '—'
					$('#entity-list').replaceChildren(element('div', 'state-placeholder', 'No registry data is available.'))
					$('#state-detail').replaceChildren(element('div', 'state-placeholder', 'State details are unavailable.'))
				}
			}
			return false
		} finally {
			if (isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) && isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) {
				$('#state-stats').setAttribute('aria-busy', 'false')
				$('#entity-list').setAttribute('aria-busy', 'false')
				setSystemControlsDisabled(false)
			}
		}
	}

	const loadSystemState = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = viewContextVersion
		const operation = () => performLoadSystemState({ ...options, contextVersion })
		return options.live === true ? systemStateRefreshGate.runBackground(operation) : systemStateRefreshGate.runForeground(operation)
	}

	const setStateTab = (type: StateTab, restoredEntityKey?: string) => {
		stateDetailContextVersion++
		stateDetailRequestVersion++
		activeStateType = type
		selectedEntityKey = restoredEntityKey
		selectedEntityHistoryOffset = 0
		$('#state-detail').setAttribute('aria-busy', 'false')
		for (const tab of document.querySelectorAll<HTMLElement>('[data-state-tab]')) {
			const selected = tab.dataset.stateTab === type
			tab.setAttribute('aria-selected', String(selected))
			tab.tabIndex = selected ? 0 : -1
		}
		$('#state-detail').setAttribute('aria-labelledby', `tab-${type}`)
		if (stateData !== undefined) void renderEntityList()
	}

	const resetActivityFilterContext = () => {
		if (document.querySelector('.event-detail-drawer')) closeEventDrawer()
		feed.replaceChildren()
		feed.setAttribute('aria-busy', 'true')
		nextCursor = undefined
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
		if (nextFilters.event === appliedActivityFilters.event && nextFilters.address === appliedActivityFilters.address) return
		appliedActivityFilters = nextFilters
		syncActivityFilterUrl()
		viewContextVersion++
		logsAbortController?.abort()
		logsRequestVersion++
		resetActivityFilterContext()
		void loadLogs()
	})

	$('#clear-filters').addEventListener('click', () => {
		$('#event-filter').value = ''
		$('#address-filter').value = ''
		validateAddressFilter()
		appliedActivityFilters = activityFilterValues()
		syncActivityFilterUrl()
		viewContextVersion++
		logsAbortController?.abort()
		logsRequestVersion++
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
		if (shouldClearPendingDetailState(preservePendingOnDialogClose)) {
			activeLog = undefined
			pendingCanonicalLog = undefined
			pendingCanonicalAccount = undefined
			pendingAccountDialogSnapshot = undefined
			activeAccount = undefined
			activeAccountTransactions = undefined
			activeAccountLoadMore = undefined
			detailRequestVersion++
		}
		preservePendingOnDialogClose = false
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
		selectedEntityHistoryOffset = 0
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
		selectedEntityHistoryOffset = 0
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
		stateDetailContextVersion++
		stateDetailRequestVersion++
		if (stateData !== undefined) void renderEntityList()
	})

	$('#entity-search').addEventListener('keydown', event => {
		const input = event.currentTarget
		if (!(input instanceof HTMLInputElement) || event.key !== 'Escape' || input.value === '') return
		event.preventDefault()
		input.value = ''
		stateDetailContextVersion++
		stateDetailRequestVersion++
		if (stateData !== undefined) void renderEntityList()
	})

	const resetSelectedNetworkContext = () => {
		loadedRouteContexts.clear()
		operationsRouteCache.clear()
		renderedOperationsContext = undefined
		viewContextVersion++
		detailContextVersion++
		stateDetailContextVersion++
		contractRequestVersion++
		richListRequestVersion++
		addressProfileRequestVersion++
		catalogRequestVersion++
		stateDetailRequestVersion++
		activeReorgRecovery = undefined
		activeLog = undefined
		removeEventDrawers()
		pendingCanonicalLog = undefined
		pendingCanonicalActivityCount = undefined
		pendingCanonicalAccount = undefined
		pendingAccountDialogSnapshot = undefined
		canonicalRefreshRequired = false
		hideCanonicalDialogStatus()
		if (blockRefreshTimer !== undefined) clearTimeout(blockRefreshTimer)
		blockRefreshTimer = undefined
		if (headFreshnessTimer !== undefined) clearTimeout(headFreshnessTimer)
		headFreshnessTimer = undefined
		pendingBlockUpdates = 0
		logsAbortController?.abort()
		logsAbortController = undefined
		logsRequestVersion++
		feed.replaceChildren()
		nextCursor = undefined
		$('#activity-summary').textContent = 'No logs shown'
		$('#more').hidden = true
		if (dialog.open) closeDetail({ preservePendingCanonicalAccount: true })
		const url = new URL(location.href)
		url.searchParams.delete('log')
		url.searchParams.delete('entity')
		url.searchParams.delete('account')
		url.searchParams.delete('contract')
		history.replaceState(null, '', url)
		stateDetailRequestVersion++
		stateData = undefined
		selectedEntityKey = undefined
		selectedEntityHistoryOffset = 0
		$('#state-stats').replaceChildren()
		$('#entity-list').replaceChildren()
		$('#entity-count').textContent = '—'
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', 'Loading system state…'))
		contractItems = []
		$('#contract-list').replaceChildren()
		richListItems = []
		richListTotal = 0
		$('#richlist-rows').replaceChildren()
		$('#richlist-summary').textContent = '0 of 0 known addresses'
		$('#richlist-more').hidden = true
		currentAddressProfile = undefined
		currentAddressPortfolioDepths = undefined
		$('#address-profile-content').replaceChildren(element('div', 'state-placeholder', 'Loading address activity…'))
		operationsRequestVersion++
		operationsLoadState.promise = undefined
		operationsLoadState.context = undefined
		operationsCatalogState = undefined
		operationsRiskCatalogState = undefined
		$('#operations-content').replaceChildren()
		$('#operations-content').setAttribute('aria-busy', 'true')
	}

	globalNetworkFilter.addEventListener('change', async () => {
		resetSelectedNetworkContext()
		syncNetworkUrl()
		updateNetworkLabels()
		renderNetworks(latestNetworks)
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
		} else {
			await loadLogs()
		}
	})

	$('#rich-sort').addEventListener('change', () => {
		viewContextVersion++
		richListRequestVersion++
		richListItems = []
		richListTotal = 0
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

	$('#richlist-more').addEventListener('click', () => loadRichList({ append: true }))

	const refreshAfterUpdates = async (_count: number, _forceContentRefresh: boolean, recovery: CanonicalRecovery | undefined): Promise<boolean> => {
		if (activeReorgRecovery !== undefined && activeReorgRecovery !== recovery) return await activeReorgRecovery.promise
		if (isSystem) {
			const contentRefreshed = await loadSystemState({ live: true })
			if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
			return contentRefreshed
		}
		if (isOperations) {
			const contentRefreshed = await loadOperations({ live: true })
			if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
			return contentRefreshed
		}
		if (isContracts) {
			const contentRefreshed = await loadContracts({ live: true })
			if (contentRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
			return contentRefreshed
		}
		if (isRichList) {
			const contentRefreshed = await loadRichList({ live: true })
			if (contentRefreshed && activeReorgRecovery === undefined && pendingCanonicalAccount === undefined && activeAccount && dialog.open) {
				const account = activeAccount
				const refreshedAccount = richListItems.find(item => String(item.chain_id) === String(account.chain_id) && item.address.toLowerCase() === account.address.toLowerCase())
				await openAccountTransactions(refreshedAccount ?? account, { live: true })
			}
			const canonicalDetailRefreshed = contentRefreshed && pendingCanonicalAccount && activeReorgRecovery === undefined ? await restorePendingCanonicalAccount() : true
			const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
			if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
			return fullyRefreshed
		}
		if (isAddress) {
			const contentRefreshed = await loadAddressProfile({ live: true })
			if (
				contentRefreshed &&
				activeReorgRecovery === undefined &&
				pendingCanonicalAccount === undefined &&
				activeAccount &&
				dialog.open &&
				currentAddressProfile &&
				String(currentAddressProfile.chain_id) === String(activeAccount.chain_id) &&
				currentAddressProfile.address.toLowerCase() === activeAccount.address.toLowerCase()
			)
				await openAccountTransactions(currentAddressProfile, { live: true })
			const canonicalDetailRefreshed = contentRefreshed && pendingCanonicalAccount && activeReorgRecovery === undefined ? await restorePendingCanonicalAccount() : true
			const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
			if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
			return fullyRefreshed
		}
		const activityRetention = activityRefreshRetention(canonicalRefreshRequired, pendingCanonicalActivityCount, feed.querySelectorAll<HTMLElement>('.log-row').length)
		const contentRefreshed = await loadLogs({
			live: true,
			...activityRetention,
		})
		const detailResults = contentRefreshed
			? await Promise.all(
					eventDrawers().map(drawer => {
						const log = drawerLogs.get(drawer)
						return log === undefined ? Promise.resolve(true) : openDetail(log, { live: true, canonicalRecovery: canonicalRefreshRequired })
					}),
				)
			: []
		const canonicalDetailRefreshed = detailResults.every(Boolean)
		const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
		if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
		return fullyRefreshed
	}

	requestRouteRefresh = createLiveRouteRefreshCoordinator(refreshAfterUpdates, () => activeReorgRecovery)

	const refreshCanonicalViews = (title: string, detail: string) => {
		canonicalDataGeneration++
		if (activeReorgRecovery !== undefined) {
			activeReorgRecovery.pendingRefresh = true
			if (isActivity) {
				const visibleCount = feed.querySelectorAll<HTMLElement>('.log-row').length
				pendingCanonicalActivityCount = Math.max(pendingCanonicalActivityCount ?? 0, visibleCount)
			}
			activeReorgRecovery.title = title
			activeReorgRecovery.detail = detail
			$('#freshness-title').textContent = title
			$('#freshness-detail').textContent = detail
			showCanonicalDialogStatus(title, detail)
			return activeReorgRecovery.promise
		}
		const recovery: CanonicalRecovery = {
			chainId: requiredChainId(),
			title,
			detail,
			logToRefresh: activeLog && document.querySelector('.event-detail-drawer') ? activeLog : undefined,
			accountToRefresh: activeAccount && dialog.open ? activeAccount : undefined,
			accountDialogSnapshot: activeAccount && dialog.open ? captureAccountDialogSnapshot() : undefined,
			pendingRefresh: false,
			promise: Promise.resolve(false),
		}
		if (isActivity) pendingCanonicalActivityCount = feed.querySelectorAll<HTMLElement>('.log-row').length
		if (recovery.logToRefresh) pendingCanonicalLog = recovery.logToRefresh
		if (recovery.accountToRefresh) {
			pendingCanonicalAccount = recovery.accountToRefresh
			pendingAccountDialogSnapshot = recovery.accountDialogSnapshot
		}
		activeReorgRecovery = recovery
		canonicalRefreshRequired = true
		if (isActivity) {
			$('#more').hidden = true
			$('#more').disabled = true
		}
		if (isRichList) {
			$('#richlist-more').hidden = true
			$('#richlist-more').disabled = true
		}
		const accountMore = detailContent.querySelector<HTMLButtonElement>('.account-transactions-more')
		if (accountMore !== null) {
			accountMore.hidden = true
			accountMore.disabled = true
		}
		const banner = $('#freshness-banner')
		banner.hidden = false
		$('#freshness-title').textContent = title
		$('#freshness-detail').textContent = detail
		showCanonicalDialogStatus(title, detail)
		recovery.promise = (async () => {
			try {
				while (true) {
					recovery.pendingRefresh = false
					const refreshed = await requestRouteRefresh(1, true)
					if (activeReorgRecovery !== recovery || selectedChainId() !== recovery.chainId) return false
					if (recovery.pendingRefresh) continue
					if (!refreshed) return false
					let detailRefreshed = true
					if (recovery.logToRefresh && document.querySelector('.event-detail-drawer')) {
						pendingCanonicalLog = recovery.logToRefresh
						const restored = await restorePendingCanonicalLog()
						detailRefreshed = restored || !document.querySelector('.event-detail-drawer') || recovery.logToRefresh === undefined
					}
					if (recovery.accountToRefresh && dialog.open) {
						pendingCanonicalAccount = recovery.accountToRefresh
						pendingAccountDialogSnapshot = captureAccountDialogSnapshot()
						const restored = await restorePendingCanonicalAccount()
						detailRefreshed = (restored || !dialog.open || recovery.accountToRefresh === undefined) && detailRefreshed
					}
					if (recovery.pendingRefresh) continue
					if (!detailRefreshed) return false
					completeCanonicalRefresh()
					return true
				}
			} finally {
				if (activeReorgRecovery === recovery) {
					activeReorgRecovery = undefined
					syncCanonicalDialogStatus()
					updateFreshness()
				}
			}
		})()
		return recovery.promise
	}

	const scheduleBlockRefresh = () => {
		blockRefreshTimer = window.setTimeout(() => {
			blockRefreshTimer = undefined
			if (activeReorgRecovery !== undefined) {
				void activeReorgRecovery.promise.finally(() => {
					if (pendingBlockUpdates > 0 && blockRefreshTimer === undefined) scheduleBlockRefresh()
				})
				return
			}
			const count = pendingBlockUpdates
			pendingBlockUpdates = 0
			void requestRouteRefresh(count)
		}, 1_000)
	}

	const queueBlockRefresh = () => {
		pendingBlockUpdates++
		if (blockRefreshTimer === undefined) scheduleBlockRefresh()
	}

	const connectStream = () => {
		if (isDemo && pageUrl.searchParams.get('streamDemo') !== '1') {
			connection.className = 'connection live'
			$('#connection-label').textContent = 'Demo fixture'
			return
		}
		if (stream !== undefined) return
		const streamQuery = new URLSearchParams()
		if (isDemo && pageUrl.searchParams.get('reorgDemo') === '1') streamQuery.set('reorg', '1')
		if (isDemo && pageUrl.searchParams.get('burstDemo') === '1') streamQuery.set('burst', '1')
		const streamPath = `/api/v1/stream${streamQuery.size > 0 ? `?${streamQuery}` : ''}`
		const nextStream = new EventSource(streamPath)
		stream = nextStream
		nextStream.addEventListener('open', () => {
			updateConnectionStatus()
			if (streamHasOpened) void requestRouteRefresh(1)
			streamHasOpened = true
		})
		nextStream.addEventListener('error', () => {
			updateConnectionStatus()
		})
		const eventPayload = (event: MessageEvent, label: string): LiveEventPayload | undefined => {
			try {
				const value: unknown = JSON.parse(String(event.data))
				if (!isRecord(value) || (typeof value['chainId'] !== 'string' && typeof value['chainId'] !== 'number')) throw new Error('Missing chainId')
				const blockNumber = value['blockNumber']
				const depth = value['depth']
				const reason = value['reason']
				if (blockNumber !== undefined && typeof blockNumber !== 'string' && typeof blockNumber !== 'number') throw new Error('Invalid blockNumber')
				if (depth !== undefined && typeof depth !== 'string' && typeof depth !== 'number') throw new Error('Invalid depth')
				if (reason !== undefined && !isHistoryInvalidationReason(reason)) throw new Error('Invalid history invalidation reason')
				return {
					chainId: value['chainId'],
					...(blockNumber === undefined ? {} : { blockNumber }),
					...(depth === undefined ? {} : { depth }),
					...(reason === undefined ? {} : { reason }),
				}
			} catch (error) {
				console.error(`${label} notification could not be decoded (${error instanceof Error ? error.name : typeof error})`)
				return undefined
			}
		}
		const selectedEventPayload = (event: MessageEvent, label: string) => {
			const payload = eventPayload(event, label)
			return payload !== undefined && String(payload.chainId) === selectedChainId() ? payload : undefined
		}
		const liveUpdate = (event: MessageEvent) => {
			if (selectedEventPayload(event, 'Live update') === undefined) return
			queueBlockRefresh()
		}
		nextStream.addEventListener('block', event => {
			const payload = eventPayload(event, 'Block update')
			if (payload === undefined) return
			demo?.applyBlock(payload)
			invalidateAddressIdentityCache(String(payload.chainId), true)
			if (String(payload.chainId) === selectedChainId()) liveUpdate(event)
		})
		nextStream.addEventListener('status', liveUpdate)
		nextStream.addEventListener('reorg', async event => {
			const payload = eventPayload(event, 'Reorganization')
			if (payload === undefined) return
			if (payload.reason === undefined) {
				console.error('Reorganization notification could not be decoded (missing history invalidation reason)')
				return
			}
			if (isDemo) {
				demo?.observeReorg(activeAccount?.address.toLowerCase())
			}
			invalidateAddressIdentityCache(String(payload.chainId))
			if (String(payload.chainId) !== selectedChainId()) return
			const depth = String(payload.depth ?? 'unknown')
			const notice = historyInvalidationNotice(payload.reason, depth)
			await refreshCanonicalViews(notice.title, notice.detail)
		})
		nextStream.addEventListener('reset', async () => {
			addressIdentityCache.clear()
			await refreshCanonicalViews('Live replay window expired', 'Refreshing views from the current database state.')
		})
	}

	if (initialChainId) {
		globalNetworkFilter.replaceChildren(new Option(knownNetworkName(initialChainId), initialChainId))
		globalNetworkFilter.value = initialChainId
		globalNetworkFilter.dataset.restored = 'true'
		syncNetworkUrl()
		updateNetworkLabels()
	}

	const cachedNetworkSnapshot = initialChainId === '' ? undefined : networkSnapshotCache.read()

	let restoredCurrentNetworkSnapshot = false

	if (cachedNetworkSnapshot?.items.some(network => String(network.chain_id) === initialChainId)) {
		if (cachedNetworkSnapshot.clientClockOffsetMs !== undefined) serverClockOffsetMs = cachedNetworkSnapshot.clientClockOffsetMs
		if (cachedNetworkSnapshot.freshnessThresholdMs !== undefined) networkFreshnessThresholdMs = cachedNetworkSnapshot.freshnessThresholdMs
		restoredCurrentNetworkSnapshot = restoredNetworkSnapshotIsCurrent(cachedNetworkSnapshot.writtenAt)
		// An old snapshot (restored session, discarded tab) must not be judged for freshness against the current clock.
		if (!restoredCurrentNetworkSnapshot) awaitingResumedNetworkStatus = true
		reconcileNetworkOptions(cachedNetworkSnapshot.items)
		renderNetworks(cachedNetworkSnapshot.items)
		updateFreshness()
	}

	connectStream()

	addEventListener('pagehide', () => {
		stream?.close()
		stream = undefined
		streamHasOpened = false
		if (blockRefreshTimer !== undefined) clearTimeout(blockRefreshTimer)
		blockRefreshTimer = undefined
		if (headFreshnessTimer !== undefined) clearTimeout(headFreshnessTimer)
		headFreshnessTimer = undefined
		pendingBlockUpdates = 0
	})

	const refreshResumedPage = (force = false): Promise<boolean> => {
		awaitingResumedNetworkStatus = true
		networkResumeGeneration++
		lastNetworkRequestFailed = false
		renderNetworks(latestNetworks)
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

	let lastTimeTickAt = Date.now()

	setInterval(() => {
		const now = Date.now()
		const tickGapMs = now - lastTimeTickAt
		lastTimeTickAt = now
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
		if (isSystem) return '#system'
		if (isOperations) return '#operations'
		if (isContracts) return '#contracts'
		if (isRichList) return '#richlist'
		return isAddress ? '#address-profile' : '#activity'
	}

	const syncVisibleRoute = () => {
		isSystem = location.pathname === '/system'
		isOperations = location.pathname === '/operations' || location.pathname.startsWith('/operations/')
		isContracts = location.pathname === '/contracts'
		isRichList = location.pathname === '/richlist'
		isAddress = location.pathname === '/address'
		isActivity = !isSystem && !isOperations && !isContracts && !isRichList && !isAddress
		$('#activity').hidden = !isActivity
		$('#system').hidden = !isSystem
		$('#operations').hidden = !isOperations
		$('#contracts').hidden = !isContracts
		$('#richlist').hidden = !isRichList
		$('#address-profile').hidden = !isAddress
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

	const requestedTab = pageUrl.searchParams.get('tab')

	if (isSystem) setStateTab(isStateTab(requestedTab) ? requestedTab : 'pools')

	if (isSystem) selectedEntityKey = pageUrl.searchParams.get('entity') ?? undefined

	const initialNetworkStatusLoad = loadInitialNetworkStatus(restoredCurrentNetworkSnapshot, () => loadNetworks({ synchronizeActivity: false }))

	const loadVisibleRoute = async () => {
		await initialNetworkStatusLoad
		const context = `${selectedChainId()}:${location.pathname}`
		const live = loadedRouteContexts.has(context) && (!isOperations || renderedOperationsContext === context)
		let loaded: boolean | undefined
		if (isSystem) loaded = await loadSystemState({ live })
		else if (isOperations) loaded = await loadOperations({ live })
		else if (isContracts) loaded = await loadContracts({ live })
		else if (isRichList) loaded = await loadRichList({ live })
		else if (isAddress) loaded = await loadAddressProfile({ live })
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
			if (isOperations) renderedOperationsContext = context
		}
	}

	const stashOperationsRoute = () => {
		if (!isOperations || renderedOperationsContext === undefined) return
		const content = $('#operations-content')
		const focusedElements = [...content.querySelectorAll<HTMLElement>(operationsFocusableSelector)]
		const focusedIndex = document.activeElement instanceof HTMLElement ? focusedElements.indexOf(document.activeElement) : -1
		const fragment = document.createDocumentFragment()
		fragment.append(...content.childNodes)
		operationsRouteCache.set(renderedOperationsContext, {
			fragment,
			catalogState: operationsCatalogState,
			riskCatalogState: operationsRiskCatalogState,
			detailState: operationsDetailState,
			scrollY: window.scrollY,
			...(focusedIndex < 0 ? {} : { focusedIndex }),
		})
	}

	const restoreOperationsPosition = (position: OperationsRoutePosition) => {
		window.scrollTo({ top: position.scrollY })
		if (position.focusedIndex === undefined) return
		const focusedElement = $('#operations-content').querySelectorAll<HTMLElement>(operationsFocusableSelector)[position.focusedIndex]
		focusedElement?.focus({ preventScroll: true })
	}

	const restoreOperationsRoute = (): OperationsRoutePosition | undefined => {
		if (!isOperations) return undefined
		const context = `${selectedChainId()}:${location.pathname}`
		const snapshot = operationsRouteCache.get(context)
		if (snapshot === undefined) {
			renderedOperationsContext = undefined
			return undefined
		}
		$('#operations-content').replaceChildren(snapshot.fragment)
		operationsCatalogState = snapshot.catalogState
		operationsRiskCatalogState = snapshot.riskCatalogState
		operationsDetailState = snapshot.detailState
		operationsRouteCache.delete(context)
		renderedOperationsContext = context
		const position = { scrollY: snapshot.scrollY, ...(snapshot.focusedIndex === undefined ? {} : { focusedIndex: snapshot.focusedIndex }) }
		restoreOperationsPosition(position)
		return position
	}

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
			if (restoredFilters.event !== appliedActivityFilters.event || restoredFilters.address !== appliedActivityFilters.address) {
				appliedActivityFilters = restoredFilters
				viewContextVersion++
				logsAbortController?.abort()
				logsRequestVersion++
				resetActivityFilterContext()
				loadedRouteContexts.delete(`${selectedChainId()}:${location.pathname}`)
			}
		}
		if (isSystem) {
			const restoredTab = pageUrl.searchParams.get('tab')
			setStateTab(isStateTab(restoredTab) ? restoredTab : 'pools', pageUrl.searchParams.get('entity') ?? undefined)
			historyFromBlock.value = pageUrl.searchParams.get('fromBlock') ?? ''
			historyToBlock.value = pageUrl.searchParams.get('toBlock') ?? ''
		}
		if (isContracts) {
			if (contractItems.length > 0) renderContracts()
		}
	}

	const invalidateRouteRequests = () => {
		viewContextVersion++
		detailContextVersion++
		stateDetailContextVersion++
		contractRequestVersion++
		richListRequestVersion++
		addressProfileRequestVersion++
		catalogRequestVersion++
		stateDetailRequestVersion++
		operationsRequestVersion++
		logsAbortController?.abort()
		logsAbortController = undefined
		logsRequestVersion++
	}

	const focusNewRoute = () => {
		window.scrollTo({ top: 0 })
		const heading = document.querySelector<HTMLElement>('main > section:not([hidden]) h1, main > section:not([hidden]) h2')
		if (heading === null) return
		heading.tabIndex = -1
		heading.focus({ preventScroll: true })
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
				const item = richListItems.find(candidate => candidate.chain_id === chainId && candidate.address.toLowerCase() === address.toLowerCase())
				const network = latestNetworks.find(candidate => String(candidate.chain_id) === chainId)
				await openAccountTransactions(item ?? { chain_id: chainId, address, explorer_base_url: network?.explorer_base_url })
				return
			}
			currentUrl.searchParams.delete('account')
			history.replaceState(null, '', currentUrl)
			pageUrl = currentUrl
		}
	}

	for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a, .operations-nav a')) {
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
		const link = targetElement.closest<HTMLAnchorElement>('#operations-content a[href]')
		if (link === null || link.hasAttribute('download') || (link.target !== '' && link.target !== '_self')) return
		const target = new URL(link.href)
		if (target.origin !== location.origin || !target.pathname.startsWith('/operations')) return
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
		const historyChainId = pageUrl.searchParams.get('chainId')
		if (historyChainId !== null && historyChainId !== selectedChainId() && [...globalNetworkFilter.options].some(option => option.value === historyChainId)) {
			const restoredUrl = new URL(location.href)
			globalNetworkFilter.value = historyChainId
			globalNetworkFilter.dataset.restored = 'true'
			resetSelectedNetworkContext()
			history.replaceState(null, '', restoredUrl)
			pageUrl = restoredUrl
			syncNetworkUrl()
			updateNetworkLabels()
			renderNetworks(latestNetworks)
			updateFreshness()
		}
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
