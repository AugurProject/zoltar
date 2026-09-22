import { $, element, number, counted, time, exactTimestamp, questionStatus } from './view-presentation.ts'
import { exactUnit } from './chart-view.ts'
import { short, shortIdentifier } from './identifier-format.ts'

import {
	type AccountDetailOptions,
	type AccountReference,
	type AccountTransactionState,
	type ActivityRecord,
	type ArgumentDefinition,
	type CanonicalRecovery,
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
	type PortfolioData,
	type ProtocolAddressLinkOptions,
	type RenderEntityListOptions,
	type RichListRecord,
	type SelectEntityOptions,
	type StateCatalog,
	type StateEntity,
	type StateTab,
} from './browser-types.ts'

import { decodeOperationsResponseValue, isJsonRecord, isRecord, operationRecords, operationsCatalogRecords, operationsRiskPagination, operationsRiskRecords, type EntityHistoryCoverageValue, type JsonRecord, type OperationsResponse } from './api-validation.ts'

import {
	activityRefreshRetention,
	availableSessionSnapshotStorage,
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
	handleActivityDetailDrawerEscape,
	historyInvalidationNotice,
	indexerConnectionStatus,
	isCurrentCanonicalGeneration,
	isCurrentContextRequest,
	isHistoryInvalidationReason,
	isNoncanonicalDetailFailure,
	knownNetworkName,
	loadInitialNetworkStatus,
	mergeUniqueRecords,
	operationsCatalogRecordKey,
	operationsDetailRecordKey,
	paginatedSnapshotWasReplaced,
	paginationRequestAllowed,
	placeActivityDetailDrawer,
	queuedPaginationPresentation,
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
	type ContractRegistrySection,
	urlWithoutLogDetail,
	visibleActivityLogCount,
} from './live-update.ts'

import { decodeEntityHistory, decodeItemsPage, decodeNetworkResponse, decodeStateCatalog, decodeValue, isAccountTransaction, isActivityRecord, isAddressIdentity, isContractRecord, isLogDetail, isRichListRecord, requiredArrayItem } from './api-decoding.ts'

import type { DemoFactory } from './demo-runtime.ts'

import { fetchApi } from './fetch-api.ts'

import { createOperationsCatalogView } from './operations-catalog-view.ts'
import { createOperationsDetailView } from './operations-detail-view.ts'
import { createEntityDetailView } from './entity-detail-view.ts'
import { createAddressProfileView } from './address-profile-view.ts'
import { createAccountTransactionsDialog } from './account-transactions-dialog.ts'
import { createNetworkStatusView } from './network-status-view.ts'

export async function startScanner(demoFactory?: DemoFactory) {
	const { operationsTimelineFilters, operationsRiskSnapshotFilter, captureOperationsRenderContext, approvalTransitionSummary, restoreOperationsRenderContext, renderOperations } = createOperationsCatalogView({
		get pageUrl() {
			return pageUrl
		},
		set pageUrl(value) {
			pageUrl = value
		},
		get requiredChainId() {
			return requiredChainId
		},
		get isDemo() {
			return isDemo
		},
		get operationsHref() {
			return operationsHref
		},
		get latestNetworks() {
			return latestNetworks
		},
		set latestNetworks(value) {
			latestNetworks = value
		},
		get operationsRiskCatalogState() {
			return operationsRiskCatalogState
		},
		set operationsRiskCatalogState(value) {
			operationsRiskCatalogState = value
		},
		get loadOperations() {
			return loadOperations
		},
		get operationsCatalogSection() {
			return operationsCatalogSection
		},
		get operationsCatalogState() {
			return operationsCatalogState
		},
		set operationsCatalogState(value) {
			operationsCatalogState = value
		},
		get connection() {
			return connection
		},
		get operationsSectionFilters() {
			return operationsSectionFilters
		},
	})

	const { tradingEvidenceRows, reportEvidenceRows, detailEvidenceRows, renderOperationsDetail } = createOperationsDetailView({
		get captureOperationsRenderContext() {
			return captureOperationsRenderContext
		},
		get connection() {
			return connection
		},
		get operationsHref() {
			return operationsHref
		},
		get detailPageRecord() {
			return detailPageRecord
		},
		get approvalTransitionSummary() {
			return approvalTransitionSummary
		},
		get operationRatio() {
			return operationRatio
		},
		get loadOperations() {
			return loadOperations
		},
		get operationsHistoryOffset() {
			return operationsHistoryOffset
		},
		get operationsRiskHistoryKeys() {
			return operationsRiskHistoryKeys
		},
		get isDemo() {
			return isDemo
		},
		get pageUrl() {
			return pageUrl
		},
		set pageUrl(value) {
			pageUrl = value
		},
		get demoRiskHistoryAutoLoadConsumed() {
			return demoRiskHistoryAutoLoadConsumed
		},
		set demoRiskHistoryAutoLoadConsumed(value) {
			demoRiskHistoryAutoLoadConsumed = value
		},
		get operationsDetailState() {
			return operationsDetailState
		},
		set operationsDetailState(value) {
			operationsDetailState = value
		},
		get requiredChainId() {
			return requiredChainId
		},
		get operationsDetailRouteKey() {
			return operationsDetailRouteKey
		},
		get detailEvidenceRowsFor() {
			return detailEvidenceRowsFor
		},
		get restoreOperationsRenderContext() {
			return restoreOperationsRenderContext
		},
	})

	const { renderPoolDetail, renderVaultDetail, renderQuestionDetail, renderUniverseDetail } = createEntityDetailView({
		get entityHistoryCollections() {
			return entityHistoryCollections
		},
		get entityHistoryCollectionKeys() {
			return entityHistoryCollectionKeys
		},
		get historyCoverageHeadline() {
			return historyCoverageHeadline
		},
		get selectEntity() {
			return selectEntity
		},
		get isDemo() {
			return isDemo
		},
		get pageUrl() {
			return pageUrl
		},
		set pageUrl(value) {
			pageUrl = value
		},
		get demoStateHistoryAutoLoadConsumed() {
			return demoStateHistoryAutoLoadConsumed
		},
		set demoStateHistoryAutoLoadConsumed(value) {
			demoStateHistoryAutoLoadConsumed = value
		},
		get fetchEntityHistory() {
			return fetchEntityHistory
		},
		get stateDetailRequestVersion() {
			return stateDetailRequestVersion
		},
		set stateDetailRequestVersion(value) {
			stateDetailRequestVersion = value
		},
		get canonicalDataGeneration() {
			return canonicalDataGeneration
		},
		set canonicalDataGeneration(value) {
			canonicalDataGeneration = value
		},
		get nativeSymbol() {
			return nativeSymbol
		},
		get staticAddressField() {
			return staticAddressField
		},
		get operationsHref() {
			return operationsHref
		},
		get stateData() {
			return stateData
		},
		set stateData(value) {
			stateData = value
		},
	})

	const { renderAddressProfile } = createAddressProfileView({
		get liveSnapshot() {
			return liveSnapshot
		},
		get nativeSymbol() {
			return nativeSymbol
		},
		get isDemo() {
			return isDemo
		},
		get explorerLink() {
			return explorerLink
		},
		get setLiveRecord() {
			return setLiveRecord
		},
		get protocolAddressLink() {
			return protocolAddressLink
		},
		get operationsHref() {
			return operationsHref
		},
		get portfolioPage() {
			return portfolioPage
		},
		get portfolioItems() {
			return portfolioItems
		},
		get PORTFOLIO_KIND_LABELS() {
			return PORTFOLIO_KIND_LABELS
		},
		get loadAddressProfile() {
			return loadAddressProfile
		},
		get openAccountTransactions() {
			return openAccountTransactions
		},
		get decodedArgumentsTable() {
			return decodedArgumentsTable
		},
		get applyLiveChanges() {
			return applyLiveChanges
		},
	})

	const { captureAccountDialogSnapshot, performOpenAccountTransactions } = createAccountTransactionsDialog({
		get activeAccountTransactions() {
			return activeAccountTransactions
		},
		set activeAccountTransactions(value) {
			activeAccountTransactions = value
		},
		get detailContent() {
			return detailContent
		},
		get dialog() {
			return dialog
		},
		get detailContextVersion() {
			return detailContextVersion
		},
		set detailContextVersion(value) {
			detailContextVersion = value
		},
		get canonicalDataGeneration() {
			return canonicalDataGeneration
		},
		set canonicalDataGeneration(value) {
			canonicalDataGeneration = value
		},
		get accountPageRefreshGate() {
			return accountPageRefreshGate
		},
		get activeAccountLoadMore() {
			return activeAccountLoadMore
		},
		set activeAccountLoadMore(value) {
			activeAccountLoadMore = value
		},
		get detailRequestVersion() {
			return detailRequestVersion
		},
		set detailRequestVersion(value) {
			detailRequestVersion = value
		},
		get stagedAccountDialogSnapshot() {
			return stagedAccountDialogSnapshot
		},
		get liveSnapshot() {
			return liveSnapshot
		},
		get activeLog() {
			return activeLog
		},
		set activeLog(value) {
			activeLog = value
		},
		get removeEventDrawers() {
			return removeEventDrawers
		},
		get pendingCanonicalLog() {
			return pendingCanonicalLog
		},
		set pendingCanonicalLog(value) {
			pendingCanonicalLog = value
		},
		get pendingCanonicalAccount() {
			return pendingCanonicalAccount
		},
		set pendingCanonicalAccount(value) {
			pendingCanonicalAccount = value
		},
		get activeReorgRecovery() {
			return activeReorgRecovery
		},
		set activeReorgRecovery(value) {
			activeReorgRecovery = value
		},
		get canonicalRefreshRequired() {
			return canonicalRefreshRequired
		},
		set canonicalRefreshRequired(value) {
			canonicalRefreshRequired = value
		},
		get pendingAccountDialogSnapshot() {
			return pendingAccountDialogSnapshot
		},
		set pendingAccountDialogSnapshot(value) {
			pendingAccountDialogSnapshot = value
		},
		get activeAccount() {
			return activeAccount
		},
		set activeAccount(value) {
			activeAccount = value
		},
		get syncCanonicalDialogStatus() {
			return syncCanonicalDialogStatus
		},
		get isRichList() {
			return isRichList
		},
		set isRichList(value) {
			isRichList = value
		},
		get setLiveRecord() {
			return setLiveRecord
		},
		get explorerLink() {
			return explorerLink
		},
		get nativeSymbol() {
			return nativeSymbol
		},
		get protocolAddressLink() {
			return protocolAddressLink
		},
		get decodedArgumentsTable() {
			return decodedArgumentsTable
		},
		get restorePendingCanonicalAccount() {
			return restorePendingCanonicalAccount
		},
		get applyLiveChanges() {
			return applyLiveChanges
		},
		get api() {
			return api
		},
		get selectedChainId() {
			return selectedChainId
		},
		get errorMessage() {
			return errorMessage
		},
		get accountTransactionsError() {
			return accountTransactionsError
		},
		get openAccountTransactions() {
			return openAccountTransactions
		},
	})

	const { updateFreshness, renderNetworks } = createNetworkStatusView({
		get latestNetworks() {
			return latestNetworks
		},
		set latestNetworks(value) {
			latestNetworks = value
		},
		get selectedChainId() {
			return selectedChainId
		},
		get invalidateAddressIdentityCache() {
			return invalidateAddressIdentityCache
		},
		get serverClockOffsetMs() {
			return serverClockOffsetMs
		},
		set serverClockOffsetMs(value) {
			serverClockOffsetMs = value
		},
		get networkCards() {
			return networkCards
		},
		get activeReorgRecovery() {
			return activeReorgRecovery
		},
		set activeReorgRecovery(value) {
			activeReorgRecovery = value
		},
		get polledReorgRefreshTimer() {
			return polledReorgRefreshTimer
		},
		set polledReorgRefreshTimer(value) {
			polledReorgRefreshTimer = value
		},
		get refreshCanonicalViews() {
			return refreshCanonicalViews
		},
		get awaitingResumedNetworkStatus() {
			return awaitingResumedNetworkStatus
		},
		set awaitingResumedNetworkStatus(value) {
			awaitingResumedNetworkStatus = value
		},
		get updateConnectionStatus() {
			return updateConnectionStatus
		},
		get indexerProgressSamples() {
			return indexerProgressSamples
		},
		get setLiveRecord() {
			return setLiveRecord
		},
		get headFreshnessState() {
			return headFreshnessState
		},
		get networkBadgeLabel() {
			return networkBadgeLabel
		},
		get age() {
			return age
		},
		get progressCompletionLabel() {
			return progressCompletionLabel
		},
		get until() {
			return until
		},
		get headFreshnessTimer() {
			return headFreshnessTimer
		},
		set headFreshnessTimer(value) {
			headFreshnessTimer = value
		},
		get lastNetworkRequestFailed() {
			return lastNetworkRequestFailed
		},
		set lastNetworkRequestFailed(value) {
			lastNetworkRequestFailed = value
		},
		get canonicalRefreshRequired() {
			return canonicalRefreshRequired
		},
		set canonicalRefreshRequired(value) {
			canonicalRefreshRequired = value
		},
		get networkFreshnessThresholdMs() {
			return networkFreshnessThresholdMs
		},
		set networkFreshnessThresholdMs(value) {
			networkFreshnessThresholdMs = value
		},
	})

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

	const age = (value: string | number | Date | null | undefined) => {
		if (!value) return 'unavailable'
		const seconds = Math.max(0, Math.floor((Date.now() + serverClockOffsetMs - new Date(value).getTime()) / 1000))
		if (seconds < 60) return `${seconds}s ago`
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
		if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
		return `${Math.floor(seconds / 86400)}d ago`
	}

	const until = (value: string | number | Date | null | undefined) => {
		if (!value) return 'time unknown'
		const seconds = Math.ceil((new Date(value).getTime() - (Date.now() + serverClockOffsetMs)) / 1000)
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

	const detailEvidenceRowsFor = (kind: OperationsDetailRoute['kind'], items: readonly JsonRecord[]) => {
		if (kind === 'trading') return tradingEvidenceRows(items)
		return kind === 'report' ? reportEvidenceRows(items) : detailEvidenceRows(items)
	}

	const detailPageRecord = (data: JsonRecord, key: string): JsonRecord => (isJsonRecord(data[key]) ? data[key] : {})

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

	const stagedAccountDialogSnapshot = (canonicalRecovery: boolean, stagedLiveRefresh: boolean, restoreSnapshot: DialogSnapshot | undefined) => {
		if (canonicalRecovery) return restoreSnapshot
		return stagedLiveRefresh ? captureAccountDialogSnapshot() : undefined
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

	const staticAddressField = (label: string, address: string | null | undefined, chainId: string) => {
		const field = element('div', 'static-field')
		field.append(element('span', '', label), address ? protocolAddressLink(address, { chainId }) : element('code', '', '—'))
		return field
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
