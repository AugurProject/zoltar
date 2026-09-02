import {
	decodeOperationsResponseValue,
	type EntityHistoryCoverageValue,
	isAccountTransactionValue,
	isActivityRecordValue,
	isAddressIdentityValue,
	isAmmPriceValue,
	isChartRowValue,
	isEntityHistoryCoverageValue,
	isJsonValue,
	isLogDetailValue,
	isNetworkRecordValue,
	isNullableString,
	isPoolStateEntityValue,
	isQuestionStateEntityValue,
	isRecord,
	isRepEthPriceValue,
	isRichListRecordValue,
	isString,
	isUniswapPriceValue,
	isUniverseStateEntityValue,
	isVaultStateEntityValue,
	type JsonValue,
	type OperationsResponse,
	operationRecords,
	operationsCatalogRecords,
	operationsRiskPagination,
	operationsRiskRecords,
} from './api-validation.ts'
import { chartValueBounds, uniswapLiquidityChartModel, uniswapPriceChartModel, uniswapPriceProvenance } from './chart-values.ts'
import { demoAmmPriceHistory, demoDenseUniswapRepEthPriceHistory, demoRepEthPriceHistory, demoUniswapRepEthPriceHistory } from './demo-fixtures.ts'
import { requiredElementRole } from './dom-elements.ts'
import {
	accountStateDuringStagedRefresh,
	activityRefreshRetention,
	approvalTransitionFields,
	availableSessionSnapshotStorage,
	type ContractRegistrySection,
	canonicalPageLimit,
	canReuseNetworkStatusPresentation,
	classifyLiveRecords,
	collectCanonicalPages,
	collectCursorCollections,
	collectDualCursorCollections,
	compareCanonicalEventPosition,
	contractDeploymentBlockActionLabel,
	contractDeploymentStatus,
	contractDeploymentTimestampLabel,
	contractRegistrySection,
	createForegroundRefreshGate,
	createLiveRouteRefreshCoordinator,
	createSessionSnapshotCache,
	decodedActionLabel,
	demoTimelineEvidenceStatus,
	entityHistoryContinuationPresentation,
	evidenceStatusLabel,
	type HistoryInvalidationReason,
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
	queuedPaginationPresentation,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	refreshPresentation,
	refreshRouteAlongsideNetworkStatus,
	resolveActivityRefreshDepth,
	retainedPaginationAvailable,
	runSerializedOperationsLoad,
	runWithForegroundReservation,
	shouldClearPendingDetailState,
	shouldContinueTransactionRestore,
	showIndexerSyncDetails,
	summarizeHistoryCollections,
	timelineEntityTypeLabel,
	timelineOccurrenceFields,
	transactionRetryMode,
	urlWithoutLogDetail,
} from './live-update.ts'

declare global {
	interface Error {
		status?: number
	}
	interface Window {
		__demoTransactionRequests?: number
		__demoRouteRequestsInFlight?: number
		__demoMaxRouteRequestsInFlight?: number
	}
}

type StateTab = 'pools' | 'vaults' | 'questions' | 'universes'
interface NetworkRecord {
	chain_id: string
	id: string
	name: string
	start_block: string
	indexed_block: string | null
	indexed_hash: string | null
	indexed_timestamp: string | null
	observed_block: string | null
	finalized_block: string | null
	phase: string
	last_poll_at: string | null
	last_success_at: string | null
	consecutive_failures: number
	last_error: string | null
	explorer_base_url: string
	last_reorg_at?: string | null
	next_retry_at?: string | null
}

interface ContractRecord {
	chain_id: string
	address: string
	label: string
	kind: string
	provenance: string
	discovery_block: string | null
	discovery_tx_hash: string | null
	deployment_block: string | null
	deployment_timestamp: string | null
	deployment_block_exact: boolean | null
	deployment_checked_block: string | null
	explorer_base_url: string
}

interface ActivityRecord {
	chain_id: string
	network_id: string
	block_number: string
	block_hash: string
	block_timestamp: string
	transaction_index: number
	log_index: number
	tx_hash: string
	emitter_address: string
	contract_label: string | null
	contract_kind: string | null
	event_name: string | null
	summary: string
	decode_status: string
	canonical: boolean
	finalized: boolean
	topics: string[]
	data: string
	arguments: Record<string, JsonValue> | null
	display_arguments: Record<string, JsonValue> | null
	argument_schema: Array<ArgumentDefinition & { indexed?: boolean }> | null
	origin_address: string | null
	explorer_base_url: string
	to_address?: string | null
	value?: string
	input?: string
	gas_used?: string
	contract_provenance?: string | null
	event_signature?: string | null
	action_summary?: string | null
	action_arguments?: Record<string, JsonValue> | null
	action_display_arguments?: Record<string, JsonValue> | null
	action_argument_schema?: ArgumentDefinition[] | null
	receipt?: Record<string, JsonValue>
	relatedLogs?: RelatedLogRecord[]
	function_signature?: string | null
}
interface TokenBalanceRecord {
	address: string
	balance: string
	contractLabel?: string | null
	name?: string | null
	universeId?: string | null
	symbol: string | null
	decimals: number | null
	blockNumber: string
}

interface RichListRecord {
	chain_id: string
	network_id?: string
	explorer_base_url: string
	address: string
	label: string | null | undefined
	kind: string | null | undefined
	weth_balance?: string
	native_balance?: string
	transaction_count: string | number
	interaction_count: string | number
	pool_count: string | number
	vault_count: string | number
	active_vault_count?: string
	rep_balances: TokenBalanceRecord[]
	weth_balances: TokenBalanceRecord[]
	native_balance_detail: { balance: string; blockNumber: string } | null
	sampled_native_count?: string | number
	sampled_rep_token_count?: string | number
	rep_token_count?: string | number
	sampled_weth_token_count?: string | number
	weth_token_count?: string | number
	oldest_balance_block?: string | null
	last_balance_refresh?: string | null
	rep_balances_truncated?: boolean
	weth_balances_truncated?: boolean
	pool_associations: Array<{ address: string; label: string | null; questionTitle: string | null }>
	vault_positions: Array<{
		poolAddress: string
		questionTitle: string | null
		repBackingUnits: string
		capacityOwnershipAttoRep: SerializedAtomicInteger
		claimableFeesAttoEth: SerializedAtomicInteger
		blockNumber: string
	}>
	escalation_claims?: Array<Record<string, unknown>>
	auction_claims?: Array<Record<string, unknown>>
	[key: string]: unknown
}
type PoolRecord = (typeof demoCatalog.pools)[number] & { current_state?: Record<string, JsonValue> }
type VaultRecord = (typeof demoCatalog.vaults)[number]
type QuestionRecord = (typeof demoCatalog.questions)[number] & { block_number?: string }
type UniverseRecord = (typeof demoCatalog.universes)[number]
type StateEntity = PoolRecord | VaultRecord | QuestionRecord | UniverseRecord
type SerializedAtomicInteger = string | number

interface StateCatalog {
	pools: PoolRecord[]
	vaults: VaultRecord[]
	questions: QuestionRecord[]
	universes: UniverseRecord[]
	poolStates?: Array<{
		chain_id: string
		pool_address: string
		event_name: string
		state: Record<string, JsonValue>
		block_number?: string
		log_index?: number
	}>
	truncated?: Record<string, boolean>
	limit?: number
	totals?: Record<'pools' | 'questions' | 'vaults' | 'universes', number>
}

interface AccountReference {
	chain_id: string
	address: string
	label?: string | null
	explorer_base_url?: string
}

interface AccountTransaction extends AccountReference {
	tx_hash: string
	block_hash: string
	block_number: string
	block_timestamp: string
	transaction_index: number
	from_address: string
	to_address: string | null
	to_label: string | null
	to_kind: string | null
	value: string
	status: string
	gas_used: string
	function_name: string | null
	function_signature: string | null
	action_summary: string | null
	action_arguments: Record<string, JsonValue> | null
	action_display_arguments: Record<string, JsonValue> | null
	action_argument_schema: ArgumentDefinition[] | null
	explorer_base_url: string
	roles?: string[]
	pool_addresses?: string[] | null
}

interface ArgumentDefinition {
	index: number
	name: string
	type: string
	indexed?: boolean
}

interface AccountTransactionState {
	key: string
	account: AccountReference
	items?: AccountTransaction[]
	loaded: AccountTransaction[]
	total: number
	nextPageCursor?: string
	snapshotBlock?: string
	pageError?: string
	pageErrorAppend: boolean
	pageLoading: boolean
}

interface DialogSnapshot {
	loadedCount: number
	expandedKeys: string[]
	anchorKey?: string
	anchorTop?: number
	focusKey?: string
	focusIndex: number
	outsideFocus?: string
	scrollTop: number
}

interface CanonicalRecovery {
	title: string
	detail: string
	pendingRefresh: boolean
	logToRefresh?: ActivityRecord
	accountToRefresh?: AccountReference
	promise: Promise<boolean>
	chainId?: string
	accountDialogSnapshot?: DialogSnapshot
}

interface AddressIdentity {
	chainId: number
	address: string
	label?: string
	kind?: string
}

interface ChartRow {
	timestamp: string
	[key: string]: JsonValue | undefined
}

interface ChartDefinition<T extends { timestamp: string }> {
	key: Extract<keyof T, string>
	label: string
	decimals?: number
	unit?: string
	className?: string
	pointShape?: (row: T) => 'circle' | 'diamond'
	pointLabel?: (row: T) => string
}

interface EntityHistory {
	snapshots: ChartRow[]
	events: ChartRow[]
	ammPrices: ReturnType<typeof demoAmmPriceHistory>
	repEthPrices: ReturnType<typeof demoRepEthPriceHistory>
	uniswapRepEthPrices: ReturnType<typeof demoUniswapRepEthPriceHistory>
	openOracleHistory: ChartRow[]
	market?: { pair_address?: string | null; fee_bps?: string | number | null } | null
	pools: JsonValue[]
	forks: JsonValue[]
	truncated?: boolean
	limit?: number
	offset?: number
	loadedOffset?: number
	coverage?: EntityHistoryCoverageValue
}

interface ItemsPage<T> {
	items: T[]
	nextCursor?: string
	total?: number
	limit?: number
	offset?: number
	snapshotBlock?: string
}

interface NetworkResponse extends ItemsPage<NetworkRecord> {
	serverTime?: string
	freshnessThresholdMs?: number
	clientClockOffsetMs?: number
}

interface RelatedLogRecord {
	log_index: number
	emitter_address: string
	event_name: string | null
	summary: string
}

interface LogDetail extends ActivityRecord {
	to_address: string | null
	value: string
	input: string
	gas_used: string
	contract_provenance: string | null
	event_signature: string | null
	function_signature: string | null
	action_summary: string | null
	action_arguments: Record<string, JsonValue> | null
	action_display_arguments: Record<string, JsonValue> | null
	action_argument_schema: ArgumentDefinition[] | null
	receipt: Record<string, JsonValue>
	relatedLogs: RelatedLogRecord[]
}

interface SelectEntityOptions {
	preserveDetail?: boolean
	quiet?: boolean
	pagination?: boolean
	historyTargetOffset?: number
	contextVersion?: number
	suppliedHistory?: EntityHistory
}

interface RenderEntityListOptions {
	refreshSelected?: boolean
	live?: boolean
	selectedHistory?: EntityHistory
	detailGateReserved?: boolean
}

interface LiveChangeOptions {
	live?: boolean
	selector?: string
}

interface LoadOptions {
	append?: boolean
	live?: boolean
	replaceDepth?: number
	contextVersion?: number
	retainVisibleDepth?: boolean
	portfolioTarget?: { readonly kind: 'forks' | 'lp' | 'reports'; readonly count: number }
}

interface DetailOptions {
	live?: boolean
	canonicalRecovery?: boolean
	contextVersion?: number
}

interface AccountDetailOptions extends DetailOptions {
	restoreSnapshot?: DialogSnapshot
}

function $(selector: '#detail-dialog'): HTMLDialogElement
function $(selector: '#event-filter' | '#address-filter' | '#entity-search'): HTMLInputElement
function $(selector: '#global-network-filter' | '#rich-sort'): HTMLSelectElement
function $(selector: '#filters'): HTMLFormElement
function $(selector: '#address-back' | '.skip-link'): HTMLAnchorElement
function $(
	selector: '#refresh-stale' | '#detail-canonical-retry' | '#more' | '#clear-filters' | '#close-detail' | '#richlist-more' | '#filters button[type="submit"]',
): HTMLButtonElement
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
const dialog = $('#detail-dialog')
const detailContent = $('#detail-content')
const connection = $('.connection')
let pageUrl = new URL(location.href)
const isDemo = pageUrl.searchParams.get('demo') === '1'
const connectionDemo = pageUrl.searchParams.get('connectionDemo')
const usesDemoConnectionLabel = isDemo && connectionDemo !== 'indexer' && connectionDemo !== 'reconnecting'
const demoState = pageUrl.searchParams.get('state')
const priceDemo = pageUrl.searchParams.get('priceDemo')
const detailState = pageUrl.searchParams.get('detailState')
const deploymentState = pageUrl.searchParams.get('deploymentState')
const networkState = pageUrl.searchParams.get('networkState')
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
let demoErrorConsumed = false
let demoDetailErrorConsumed = false
let demoStateDetailRequests = 0
let demoTransactionRequests = 0
let demoLogRequests = 0
let demoRichListRequests = 0
let demoNetworkRequests = 0
let demoRouteRequestsInFlight = 0
let demoMaxRouteRequestsInFlight = 0
let demoReorgObserved = false
let demoEvictedAddress: string | undefined
let demoReorgRefreshErrorConsumed = false
let demoTransactionSnapshotInvalidated = false
let demoCanonicalRouteRefreshErrorConsumed = false
let demoTransactionRestoreErrorConsumed = false
let demoTransactionAppendErrorConsumed = false
let demoNetworkFallbackErrorConsumed = false
let operationsRequestVersion = 0
const operationsLoadState: { promise?: Promise<boolean>; context?: string } = {}
let operationsCatalogState:
	| {
			readonly chainId: string
			readonly section: PagedOperationsCatalogSection
			readonly items: readonly Record<string, unknown>[]
	  }
	| undefined
let operationsRiskCatalogState:
	| {
			readonly chainId: string
			readonly pools: readonly Record<string, unknown>[]
			readonly vaults: readonly Record<string, unknown>[]
	  }
	| undefined
let operationsDetailState:
	| {
			readonly chainId: string
			readonly routeKey: string
			readonly items: readonly Record<string, unknown>[]
			readonly decisionItems: readonly Record<string, unknown>[]
			readonly riskHistoryOffset: number
	  }
	| undefined
let demoRouteRefreshErrorConsumed = false
let demoRiskHistoryAppendErrorConsumed = false
let demoRiskHistoryAutoLoadConsumed = false
let demoStateHistoryAppendErrorConsumed = false
let demoStateHistoryAutoLoadConsumed = false
let demoPortfolioAppendErrorConsumed = false
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
let currentAddressPortfolioDepths:
	| { readonly chainId: string; readonly address: string; readonly forks: number; readonly lp: number; readonly reports: number }
	| undefined
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
const operationsFocusableSelector =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]'
const logRefreshGate = createForegroundRefreshGate()
const contractRefreshGate = createForegroundRefreshGate()
const richListRefreshGate = createForegroundRefreshGate()
const addressProfileRefreshGate = createForegroundRefreshGate()
const systemStateRefreshGate = createForegroundRefreshGate()
const systemDetailRefreshGate = createForegroundRefreshGate()
const detailRefreshGate = createForegroundRefreshGate()
const accountPageRefreshGate = createForegroundRefreshGate()
const canonicalIncompleteTitle = 'Chain update refresh incomplete'
const canonicalIncompleteDetail = 'Showing the prior details. Retry the chain update refresh to confirm the current state.'

const showCanonicalDialogStatus = (title: string, detail: string) => {
	if (dialog.open) {
		$('#detail-canonical-title').textContent = title
		$('#detail-canonical-detail').textContent = detail
		$('#detail-canonical-retry').hidden = activeReorgRecovery !== undefined || !canonicalRefreshRequired
		$('#detail-canonical-status').hidden = false
	}
	const drawerStatus = document.querySelector<HTMLElement>('.event-detail-canonical-status')
	if (drawerStatus) {
		const message = element('div')
		message.append(element('strong', '', title), element('span', '', detail))
		const retry = element('button', 'secondary compact', 'Retry now')
		retry.type = 'button'
		retry.hidden = activeReorgRecovery !== undefined || !canonicalRefreshRequired
		retry.addEventListener('click', () => retryCanonicalRefresh(retry))
		drawerStatus.replaceChildren(message, retry)
		drawerStatus.hidden = false
	}
}

const hideCanonicalDialogStatus = () => {
	$('#detail-canonical-status').hidden = true
	document.querySelector<HTMLElement>('.event-detail-canonical-status')?.setAttribute('hidden', '')
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
	const network = latestNetworks.find((item) => String(item.chain_id) === selectedChainId())
	const streamState =
		connectionDemo === 'reconnecting'
			? 'closed'
			: stream?.readyState === EventSource.OPEN
				? 'open'
				: stream?.readyState === EventSource.CONNECTING || stream === undefined
					? 'connecting'
					: 'closed'
	const status = indexerConnectionStatus(network, streamState, lastNetworkRequestFailed, streamHasOpened || connectionDemo === 'reconnecting')
	connection.className = `connection ${status.tone}`
	$('#connection-label').textContent = status.label
}

const liveSnapshot = (container: ParentNode, selector = '[data-live-key]'): Map<string, string> =>
	new Map(
		[...container.querySelectorAll<HTMLElement>(selector)].flatMap((node) => {
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

const requiredArrayItem = <T>(items: readonly T[], index: number, label: string): T => {
	const item = items[index]
	if (item === undefined) throw new Error(`${label} is missing`)
	return item
}

const applyLiveChanges = (
	container: ParentNode,
	previous: ReadonlyMap<string, string>,
	{ live = false, selector = '[data-live-key]' }: LiveChangeOptions = {},
) => {
	const changes = { added: 0, changed: 0 }
	if (!live) return changes
	const nodes = [...container.querySelectorAll<HTMLElement>(selector)]
	const classified = classifyLiveRecords(
		previous,
		nodes.flatMap((node) => {
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

const demoHash = `0x${'7e4b9ad70f2248c48217f9c9ef694017'.repeat(2)}`
const demoNetworks = [
	{
		chain_id: '1',
		id: 'mainnet',
		name: 'Ethereum Mainnet',
		start_block: '23180000',
		indexed_block: '23184712',
		indexed_hash: demoHash,
		indexed_timestamp: new Date(Date.now() - 19_000).toISOString(),
		observed_block: '23184712',
		finalized_block: '23184648',
		phase: 'live',
		last_poll_at: new Date().toISOString(),
		last_success_at: new Date().toISOString(),
		consecutive_failures: 0,
		last_error: null,
		explorer_base_url: 'https://etherscan.io',
	},
	{
		chain_id: '11155111',
		id: 'sepolia',
		name: 'Sepolia',
		start_block: '8970000',
		indexed_block: '8972451',
		indexed_hash: demoHash,
		indexed_timestamp: new Date(Date.now() - 46_000).toISOString(),
		observed_block: '8972466',
		finalized_block: '8972402',
		phase: 'backfilling',
		last_poll_at: new Date().toISOString(),
		last_success_at: new Date().toISOString(),
		consecutive_failures: 0,
		last_error: null,
		explorer_base_url: 'https://sepolia.etherscan.io',
	},
]
const demoNetworkItems = () => {
	if (networkState === 'stale') return demoNetworks.map((network) => ({ ...network, last_success_at: new Date(Date.now() - 120_000).toISOString() }))
	if (networkState === 'stale-head')
		return demoNetworks.map((network) => ({
			...network,
			indexed_block: network.observed_block,
			indexed_timestamp: new Date(Date.now() - 120_000).toISOString(),
			phase: 'live',
		}))
	if (networkState !== 'future-start') return demoNetworks
	return demoNetworks.map((network) => ({
		...network,
		start_block: (BigInt(network.observed_block) + 1n).toString(),
		indexed_block: null,
		indexed_hash: null,
		indexed_timestamp: null,
		phase: 'live',
	}))
}
const demoContracts = demoNetworks.flatMap((network) => {
	const manifestDefinitions: readonly (readonly [address: string, label: string, kind: string, deploymentBlock: string | undefined, exact: boolean])[] = [
		['0x7A0D94F55792C434d74a40883C6ed8545E406D12', 'Proxy Deployer', 'proxyDeployer', '22181455', true],
		['0x052c04adFF6C1BF51f52158e36441C1e99cdfDB4', 'Deployment Status Oracle', 'deploymentStatusOracle', '22181462', true],
		['0x529dcaC57677451CBfe766d88CcC133D082500df', 'OpenOracle', 'openOracle', '22181501', true],
		['0xaa280cf94Fc3531aDe40b479C17eBef53923291C', 'Zoltar', 'zoltar', undefined, true],
		['0xBea56ec12C943213408DA17f754A523A8aB38947', 'Security Pool Factory', 'securityPoolFactory', undefined, true],
		['0x221657776846890989a759ba2973e427dff5c9bb', 'Genesis REP', 'reputationToken', '7290001', true],
		['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'Wrapped Ether', 'weth', '4719568', true],
		['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USD Coin', 'usdc', '6082465', true],
		['0x1F98431c8aD98523631AE4a59f267346ea31F984', 'Uniswap V3 Factory', 'uniswapV3Factory', '12369621', true],
	]
	const manifestContracts: ContractRecord[] = manifestDefinitions.map(([address, label, kind, deploymentBlock, exact], index) => ({
		chain_id: network.chain_id,
		address,
		label,
		kind,
		provenance: 'manifest',
		discovery_block: null,
		discovery_tx_hash: null,
		deployment_block: network.id === 'mainnet' ? (deploymentBlock ?? null) : index < 3 ? String(8_750_000 + index * 12) : null,
		deployment_timestamp:
			network.id === 'mainnet' && deploymentBlock !== undefined
				? new Date(Date.now() - (5 - index) * 86_400_000).toISOString()
				: network.id === 'sepolia' && index < 3
					? new Date(Date.now() - (3 - index) * 86_400_000).toISOString()
					: null,
		deployment_block_exact: deploymentBlock === undefined ? null : exact,
		deployment_checked_block: network.indexed_block,
		explorer_base_url: network.explorer_base_url,
	}))
	return [
		...manifestContracts,
		{
			chain_id: network.chain_id,
			address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			label: 'Security Pool 0',
			kind: 'securityPool',
			provenance: 'DeploySecurityPool',
			discovery_block: network.indexed_block,
			discovery_tx_hash: demoHash,
			deployment_block: network.indexed_block,
			deployment_timestamp: network.indexed_timestamp,
			deployment_block_exact: true,
			deployment_checked_block: network.indexed_block,
			explorer_base_url: network.explorer_base_url,
		},
	]
})
const demoEvents = [
	'PoolAccountingCheckpoint',
	'Transfer',
	'PriceReported',
	'ClaimDeposit',
	'DeploySecurityPool',
	'ReportSubmitted',
	'UniverseInitialized',
	'BidSubmitted',
]
const demoLogs = Array.from({ length: 18 }, (_, index) => {
	const network = requiredArrayItem(demoNetworks, index % 3 === 0 ? 1 : 0, 'Demo network')
	return {
		chain_id: network.chain_id,
		network_id: network.id,
		block_number: String(BigInt(network.indexed_block) - BigInt(index)),
		block_hash: network.indexed_hash,
		block_timestamp: new Date(new Date(network.indexed_timestamp).getTime() - index * 14_000).toISOString(),
		transaction_index: index % 7,
		log_index: index + 2,
		tx_hash: demoHash.slice(0, -2) + String(index).padStart(2, '0'),
		emitter_address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
		contract_label: index % 4 === 0 ? 'Security Pool 0x8c2f' : index % 4 === 1 ? 'OpenOracle' : index % 4 === 2 ? 'Genesis REP' : 'Security Pool Factory',
		contract_kind: 'securityPool',
		event_name: demoEvents[index % demoEvents.length],
		summary:
			index % 2 === 0
				? 'amount=4,250.75 REP · vault=Market maker (0x19B4…E2a0)'
				: `reportId=1842 · price=0.004281 ${network.id === 'sepolia' ? 'SepoliaETH' : 'ETH'} · outcomeIndex=2`,
		decode_status: index === 7 ? 'unknown' : 'decoded',
		canonical: true,
		finalized: index > 4,
		topics: [demoHash],
		data: '0x00',
		arguments: {
			['amountAttoRep']: (4_250_750n * 10n ** 15n).toString(),
			vault: '0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0',
			coordinator: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
		},
		display_arguments: {
			['amountAttoRep']: (4_250_750n * 10n ** 15n).toString(),
			vault: 'Market maker (0x19B4a7C60926D8FBe420C2a49f1DB56D7800E2a0)',
			coordinator: 'OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)',
			recipients: ['Security Pool (0x7777777777777777777777777777777777777777)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
		},
		argument_schema: [
			{ index: 0, name: 'amountAttoRep', type: 'uint256' },
			{ index: 1, name: 'vault', type: 'address', indexed: true },
			{ index: 2, name: 'coordinator', type: 'address' },
			{ index: 3, name: 'recipients', type: 'address[]' },
		],
		origin_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
		explorer_base_url: network.explorer_base_url,
	}
})
const demoRichList = Array.from({ length: 64 }, (_, index) => {
	const network = requiredArrayItem(demoNetworks, index % 3 === 0 ? 1 : 0, 'Demo rich-list network')
	const address = `0x${(BigInt(index + 1) * 0x123456789abcdefn).toString(16).padStart(40, '0')}`
	const repBalance = BigInt(920 - index * 8) * 10n ** 18n + (index === 0 ? 123_456_789n : 0n)
	const poolCount = 1 + (index % 4)
	const vaultCount = (index + 1) % 3
	return {
		chain_id: network.chain_id,
		network_id: network.id,
		explorer_base_url: network.explorer_base_url,
		address,
		label: index === 2 ? 'Price Coordinator' : null,
		kind: index === 2 ? 'priceCoordinator' : null,
		weth_balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
		native_balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
		rep_token_count: index <= 1 ? '2' : '1',
		sampled_rep_token_count: index === 0 ? '2' : '1',
		weth_token_count: '1',
		sampled_weth_token_count: '1',
		sampled_native_count: '1',
		returned_rep_token_count: index === 0 ? '2' : '1',
		returned_weth_token_count: '1',
		rep_balances_truncated: false,
		weth_balances_truncated: false,
		transaction_count: String(84 - index),
		interaction_count: String(102 - index),
		pool_count: String(poolCount),
		vault_count: String(vaultCount),
		active_vault_count: String(index % 2),
		oldest_balance_block: String(BigInt(network.indexed_block) - BigInt(index % 4)),
		last_balance_refresh: new Date(Date.now() - index * 17_000).toISOString(),
		rep_balances: [
			{
				address:
					requiredArrayItem(demoNetworks, 0, 'Mainnet demo network').chain_id === network.chain_id
						? '0x221657776846890989a759ba2973e427dff5c9bb'
						: '0x754bc4ca2539560f1b48a9c3d2def5b9718f2c82',
				balance: repBalance.toString(),
				contractLabel: 'Genesis REP',
				universeId: '0',
				symbol: 'REP',
				decimals: 18,
				blockNumber: network.indexed_block,
			},
			...(index === 0
				? [
						{
							address: network.id === 'sepolia' ? '0x86a1c70f2d9d6a0794458c4b2d08f2a1bd9289c1' : '0x4a0f2fc79d092e999aaa1e1e86bd4f3fdb68697b',
							balance: (repBalance / 3n).toString(),
							contractLabel: 'Child REP',
							universeId: '2',
							symbol: 'REP',
							decimals: 18,
							blockNumber: network.indexed_block,
						},
					]
				: []),
		],
		weth_balances: [
			{
				address: '0x0000000000000000000000000000000000000007',
				balance: (BigInt(18 + index) * 10n ** 17n + (index === 0 ? 987_654_321n : 0n)).toString(),
				name: 'Wrapped Ether',
				symbol: 'WETH',
				decimals: 18,
				blockNumber: network.indexed_block,
			},
		],
		native_balance_detail: {
			balance: (BigInt(4 + (index % 5)) * 10n ** 17n + (index === 0 ? 456_789_123n : 0n)).toString(),
			blockNumber: network.indexed_block,
		},
		pool_associations: Array.from({ length: poolCount }, (_, poolIndex) => ({
			address: `0x${(BigInt(index + 1) * 100n + BigInt(poolIndex + 1)).toString(16).padStart(40, 'a')}`,
			label: poolIndex === 0 ? 'Security Pool' : null,
			questionTitle:
				poolIndex === 0
					? network.id === 'sepolia'
						? 'Which client ships the next protocol release first?'
						: 'Will the 2030 global mean temperature anomaly exceed 1.5°C?'
					: null,
		})),
		vault_positions: Array.from({ length: vaultCount }, (_, vaultIndex) => ({
			poolAddress: `0x${(BigInt(index + 1) * 100n + BigInt(vaultIndex + 1)).toString(16).padStart(40, 'a')}`,
			questionTitle:
				network.id === 'sepolia' ? 'Which client ships the next protocol release first?' : 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
			repBackingUnits: String(BigInt(120 + vaultIndex) * 10n ** 18n),
			capacityOwnershipAttoRep: String(BigInt(85 + vaultIndex) * 10n ** 18n),
			claimableFeesAttoEth: String(BigInt(3 + vaultIndex) * 10n ** 16n),
			blockNumber: network.indexed_block,
		})),
	}
})
const demoInitialTransactionCounts = new Map(demoRichList.map((item) => [`${item.chain_id}:${item.address.toLowerCase()}`, Number(item.transaction_count)]))
const demoNetworkBaselines = new Map(
	demoNetworks.map((network) => [network.chain_id, { blockNumber: BigInt(network.indexed_block), timestamp: new Date(network.indexed_timestamp).getTime() }]),
)

const demoAddress = (seed: string) => `0x${seed.repeat(40).slice(0, 40)}`
const demoQuestions = [
	{
		chain_id: '1',
		network_id: 'mainnet',
		question_id: '8721049384720193847201',
		title: 'Will the 2030 global mean temperature anomaly exceed 1.5°C?',
		description: 'Resolves Yes when the cited annual dataset reports an anomaly strictly above 1.5°C relative to its stated pre-industrial baseline.',
		created_timestamp: new Date(Date.now() - 96 * 86_400_000).toISOString(),
		start_time: new Date(Date.now() - 90 * 86_400_000).toISOString(),
		end_time: new Date(Date.now() + 620 * 86_400_000).toISOString(),
		num_ticks: '0',
		display_value_min: '0',
		display_value_max: '0',
		answer_unit: '',
		outcome_options: ['Yes', 'No'],
		pool_count: '2',
		fork_count: '0',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		question_id: '7346511098237401928374',
		title: 'ETH/USD reference price at 00:00 UTC on 1 January 2028',
		description: 'Scalar outcome using the designated reference venue and UTC observation window.',
		created_timestamp: new Date(Date.now() - 70 * 86_400_000).toISOString(),
		start_time: new Date(Date.now() - 60 * 86_400_000).toISOString(),
		end_time: new Date(Date.now() + 510 * 86_400_000).toISOString(),
		num_ticks: '10000000000000000000000',
		display_value_min: '0',
		display_value_max: '10000000000000000000000',
		answer_unit: 'USD',
		outcome_options: [],
		pool_count: '1',
		fork_count: '1',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		question_id: '990172635410982736451',
		title: 'Which client ships the next protocol release first?',
		description: 'Testnet categorical market used to exercise pool and universe lifecycle transitions.',
		created_timestamp: new Date(Date.now() - 40 * 86_400_000).toISOString(),
		start_time: new Date(Date.now() - 35 * 86_400_000).toISOString(),
		end_time: new Date(Date.now() - 5 * 86_400_000).toISOString(),
		num_ticks: '0',
		display_value_min: '0',
		display_value_max: '0',
		answer_unit: '',
		outcome_options: ['Atlas', 'Borealis', 'Cygnus'],
		pool_count: '1',
		fork_count: '1',
	},
]
const mainnetDemoQuestion = requiredArrayItem(demoQuestions, 0, 'Mainnet demo question')
const secondaryDemoQuestion = requiredArrayItem(demoQuestions, 1, 'Secondary demo question')
const sepoliaDemoQuestion = requiredArrayItem(demoQuestions, 2, 'Sepolia demo question')
const demoPools = [
	{
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: demoAddress('a'),
		parent_address: demoAddress('0'),
		universe_id: '0',
		question_id: mainnetDemoQuestion.question_id,
		question_title: mainnetDemoQuestion.title,
		truth_auction_address: demoAddress('b'),
		coordinator_address: demoAddress('c'),
		share_token_address: demoAddress('d'),
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '10000000000',
		initial_retention_rate: '999999800000000000',
		initial_settlement_collateral_atto_eth: '182500000000000000000',
		settlement_collateral_atto_eth: '241820000000000000000',
		total_capacity_ownership_atto_rep: '168400000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '154200000000000000000',
		total_claimable_vault_fees_atto_eth: '1280000000000000000',
		unallocated_accrued_fees_atto_eth: '210000000000000000',
		current_retention_rate: '999999700000000000',
		vault_count: '7',
		child_count: '2',
		snapshot_block: '23184712',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: demoAddress('e'),
		parent_address: demoAddress('a'),
		universe_id: '4102938471029384710293847',
		question_id: mainnetDemoQuestion.question_id,
		question_title: mainnetDemoQuestion.title,
		truth_auction_address: demoAddress('f'),
		coordinator_address: demoAddress('1'),
		share_token_address: demoAddress('2'),
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '10000000000',
		initial_retention_rate: '999999800000000000',
		initial_settlement_collateral_atto_eth: '92000000000000000000',
		settlement_collateral_atto_eth: '117400000000000000000',
		total_capacity_ownership_atto_rep: '78200000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '73900000000000000000',
		total_claimable_vault_fees_atto_eth: '430000000000000000',
		unallocated_accrued_fees_atto_eth: '80000000000000000',
		current_retention_rate: '999999700000000000',
		vault_count: '4',
		child_count: '0',
		snapshot_block: '23184710',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: demoAddress('3'),
		parent_address: demoAddress('0'),
		universe_id: '0',
		question_id: secondaryDemoQuestion.question_id,
		question_title: secondaryDemoQuestion.title,
		truth_auction_address: demoAddress('4'),
		coordinator_address: demoAddress('5'),
		share_token_address: demoAddress('6'),
		security_multiplier_bps: '17500',
		initial_priority_fee_atto_eth_per_gas: '12000000000',
		initial_retention_rate: '999999500000000000',
		initial_settlement_collateral_atto_eth: '44000000000000000000',
		settlement_collateral_atto_eth: '68900000000000000000',
		total_capacity_ownership_atto_rep: '35500000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '32100000000000000000',
		total_claimable_vault_fees_atto_eth: '190000000000000000',
		unallocated_accrued_fees_atto_eth: '40000000000000000',
		current_retention_rate: '999999400000000000',
		vault_count: '3',
		child_count: '0',
		snapshot_block: '23184698',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		pool_address: demoAddress('7'),
		parent_address: demoAddress('0'),
		universe_id: '0',
		question_id: sepoliaDemoQuestion.question_id,
		question_title: sepoliaDemoQuestion.title,
		truth_auction_address: demoAddress('8'),
		coordinator_address: demoAddress('9'),
		share_token_address: demoAddress('a1'),
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '10000000000',
		initial_retention_rate: '999999800000000000',
		initial_settlement_collateral_atto_eth: '12000000000000000000',
		settlement_collateral_atto_eth: '18400000000000000000',
		total_capacity_ownership_atto_rep: '9700000000000000000',
		fee_eligible_capacity_ownership_atto_rep: '8800000000000000000',
		total_claimable_vault_fees_atto_eth: '70000000000000000',
		unallocated_accrued_fees_atto_eth: '9000000000000000',
		current_retention_rate: '999999700000000000',
		vault_count: '5',
		child_count: '1',
		snapshot_block: '8972451',
	},
]
const demoVaults = Array.from({ length: 9 }, (_, index) => {
	const poolItem = requiredArrayItem(demoPools, index % demoPools.length, 'Demo vault pool')
	return {
		chain_id: poolItem.chain_id,
		network_id: poolItem.network_id,
		pool_address: poolItem.pool_address,
		vault_address: demoAddress(`${(index + 2).toString(16)}f`),
		question_title: poolItem.question_title,
		rep_backing_units: String((920_000 + index * 143_000) * 1e12),
		capacity_ownership_atto_rep: String(BigInt(18 + index * 4) * 10n ** 18n),
		claimable_fees_atto_eth: String(BigInt(4 + index) * 10n ** 16n),
		fee_index: String(BigInt(1200 + index * 170) * 10n ** 15n),
		vault_fee_remainder: String(index * 13),
		resulting_total_rep_backing_units: '6410000000000000000',
		resulting_fee_eligible_capacity_ownership_atto_rep: poolItem.fee_eligible_capacity_ownership_atto_rep,
		block_number: String(23184700 - index),
	}
})
const demoUniverses = [
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '0',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: demoAddress('91'),
		theoretical_supply_atto_rep: '11000000000000000000000000',
		active_fork_question_id: secondaryDemoQuestion.question_id,
		active_fork_time: new Date(Date.now() - 45 * 86_400_000).toISOString(),
		forker_address: demoAddress('77'),
		fork_threshold_atto_rep: '1200000000000000000000000',
		migration_rep_balance_atto_rep: '960000000000000000000000',
		child_count: '3',
		pool_count: '2',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '4102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '1',
		reputation_token_address: demoAddress('92'),
		theoretical_supply_atto_rep: '10920000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '1',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '5102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '2',
		reputation_token_address: demoAddress('93'),
		theoretical_supply_atto_rep: '10920000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '0',
	},
	{
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '6102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: demoAddress('94'),
		theoretical_supply_atto_rep: '10920000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '0',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		universe_id: '0',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: demoAddress('95'),
		theoretical_supply_atto_rep: '7200000000000000000000000',
		active_fork_question_id: sepoliaDemoQuestion.question_id,
		active_fork_time: new Date(Date.now() - 4 * 86_400_000).toISOString(),
		forker_address: demoAddress('78'),
		fork_threshold_atto_rep: '800000000000000000000000',
		migration_rep_balance_atto_rep: '640000000000000000000000',
		child_count: '1',
		pool_count: '1',
	},
	{
		chain_id: '11155111',
		network_id: 'sepolia',
		universe_id: '8102938471029384710293847',
		parent_universe_id: '0',
		forking_outcome_index: '2',
		reputation_token_address: demoAddress('96'),
		theoretical_supply_atto_rep: '7080000000000000000000000',
		active_fork_question_id: null,
		active_fork_time: null,
		child_count: '0',
		pool_count: '0',
	},
]
const demoCatalog = {
	questions: demoQuestions,
	pools: demoPools,
	vaults: demoVaults,
	universes: demoUniverses,
	poolStates: demoPools.map((poolItem, index) => ({
		chain_id: poolItem.chain_id,
		pool_address: poolItem.pool_address,
		event_name: 'CurrentDemoState',
		state: {
			systemState: index === 1 ? '2' : '0',
			awaitingForkContinuation: index === 1,
			totalRepBackingUnits: String(BigInt(6_400_000 + index * 1_200_000) * 10n ** 12n),
			shareTokenSupplyAttoShares: String(BigInt(220 + index * 70) * 10n ** 18n),
			escalationGame: demoAddress(`${index + 4}e`),
		},
	})),
}

const demoSeries = (base: string, count = 12, variation = 0.32) =>
	Array.from({ length: count }, (_, index) => {
		const factor = 1 - variation + (variation * index) / Math.max(1, count - 1) + Math.sin(index * 1.4) * 0.025
		return String(BigInt(Math.max(1, Math.round(Number(base) * factor))))
	})

const demoHistory = (path: string) => {
	const request = new URL(path, location.origin)
	const parts = request.pathname.split('/')
	const type = parts[4]
	const offset = request.searchParams.has('cursor') ? 1000 : 0
	const historyMore = pageUrl.searchParams.get('stateHistoryMore') === '1'
	const pagedHistory = (history: Readonly<Record<string, unknown>>, seriesKeys: readonly string[]) => {
		const page: Record<string, unknown> = { ...history }
		for (const key of seriesKeys) {
			const records = Array.isArray(history[key]) ? history[key] : []
			const split = Math.max(1, Math.ceil(records.length / 2))
			page[key] = historyMore ? (offset === 0 ? records.slice(split) : records.slice(0, split)) : records
		}
		const series = Object.fromEntries(seriesKeys.map((key) => [key, Array.isArray(page[key]) ? page[key].length : 0]))
		const truncated = historyMore && offset === 0
		return {
			...page,
			truncated,
			limit: 1000,
			offset,
			coverage: {
				requestedFromBlock: request.searchParams.get('fromBlock') ?? '23000000',
				requestedToBlock: request.searchParams.get('toBlock') ?? '23514219',
				indexedFromBlock: '23000000',
				indexedThroughBlock: '23514219',
				indexedThroughHash: demoHash,
				limit: 1000,
				offset,
				series,
				complete: !truncated,
				rangeCovered: true,
				hasPreviousPages: offset > 0,
				...(truncated ? { nextCursor: 'demo-state-history-older' } : {}),
			},
		}
	}
	if (type === 'pools') {
		const poolItem = demoPools.find((item) => item.pool_address === parts[6]) ?? requiredArrayItem(demoPools, 0, 'Default demo pool')
		const collateral = demoSeries(poolItem.settlement_collateral_atto_eth)
		const capacity = demoSeries(poolItem.total_capacity_ownership_atto_rep, 12, 0.4)
		const hasAmm = poolItem.question_id === mainnetDemoQuestion.question_id
		const hasRepEthPrices = poolItem !== requiredArrayItem(demoPools, 2, 'REP price demo pool')
		const repEthPrices = demoRepEthPriceHistory()
		const firstRepEthPrice = requiredArrayItem(repEthPrices, 0, 'Demo REP/ETH price')
		const displayedRepEthPrices =
			priceDemo === 'constant-zero'
				? [{ ...firstRepEthPrice, rep_per_eth_1e18: '0' }]
				: priceDemo === 'constant-nonzero'
					? [firstRepEthPrice]
					: priceDemo === 'constant-repeated'
						? repEthPrices.slice(0, 3).map((price) => ({ ...price, rep_per_eth_1e18: firstRepEthPrice.rep_per_eth_1e18 }))
						: repEthPrices
		return pagedHistory(
			{
				snapshots: collateral.map((value, index) => ({
					timestamp: new Date(Date.now() - (11 - index) * 7 * 86_400_000).toISOString(),
					block_number: String(23100000 + index * 7700),
					settlement_collateral_atto_eth: value,
					total_capacity_ownership_atto_rep: requiredArrayItem(capacity, index, 'Demo capacity point'),
					total_claimable_vault_fees_atto_eth: String(BigInt(20 + index * 8) * 10n ** 16n),
					current_retention_rate: poolItem.current_retention_rate,
				})),
				events: [],
				market: hasAmm
					? {
							pair_address: demoAddress('fa'),
							pool_address: poolItem.pool_address,
							share_token_address: poolItem.share_token_address,
							universe_id: poolItem.universe_id,
							fee_bps: '30',
						}
					: undefined,
				ammPrices: hasAmm ? demoAmmPriceHistory() : [],
				repEthPrices: hasRepEthPrices ? displayedRepEthPrices : [],
				uniswapRepEthPrices: hasRepEthPrices ? (priceDemo === 'eight' ? demoDenseUniswapRepEthPriceHistory() : demoUniswapRepEthPriceHistory()) : [],
				openOracleHistory: hasRepEthPrices
					? displayedRepEthPrices.slice(-3).map((price, index) => ({
							timestamp: price.timestamp,
							block_number: price.block_number,
							event_name: index === 0 ? 'ReportSubmitted' : index === 1 ? 'ReportDisputed' : 'PriceReported',
							summary: index === 0 ? 'REP/ETH report submitted' : index === 1 ? 'Replacement round accepted' : 'Coordinator accepted the settled price',
							coordinator_address: poolItem.coordinator_address,
						}))
					: [],
			},
			['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory'],
		)
	}
	if (type === 'vaults') {
		const vaultItem =
			demoVaults.find((item) => item.pool_address === parts[6] && item.vault_address === parts[7]) ?? requiredArrayItem(demoVaults, 0, 'Default demo vault')
		const rep = demoSeries(vaultItem.rep_backing_units, 10, 0.45)
		const capacity = demoSeries(vaultItem.capacity_ownership_atto_rep, 10, 0.5)
		return pagedHistory(
			{
				snapshots: rep.map((value, index) => ({
					timestamp: new Date(Date.now() - (9 - index) * 8 * 86_400_000).toISOString(),
					block_number: String(23110000 + index * 6800),
					rep_backing_units: value,
					capacity_ownership_atto_rep: requiredArrayItem(capacity, index, 'Demo vault capacity point'),
					claimable_fees_atto_eth: String(BigInt(1 + index) * 10n ** 16n),
				})),
			},
			['snapshots'],
		)
	}
	if (type === 'universes') {
		const universe = demoUniverses.find((item) => item.universe_id === parts[6]) ?? requiredArrayItem(demoUniverses, 0, 'Default demo universe')
		const supply = Array.from({ length: 9 }, (_, index) => String((BigInt(universe.theoretical_supply_atto_rep) * BigInt(108 - index)) / 100n))
		return pagedHistory(
			{
				events: supply.map((value, index) => ({
					timestamp: new Date(Date.now() - (8 - index) * 12 * 86_400_000).toISOString(),
					block_number: String(23080000 + index * 11000),
					event_name: index === 0 ? 'UniverseInitialized' : index === 4 ? 'UniverseForked' : 'MigrationRepAdded',
					theoretical_supply_atto_rep: value,
				})),
			},
			['events'],
		)
	}
	return pagedHistory(
		{
			pools: demoPools
				.filter((item) => item.question_id === parts[6])
				.map((item, index) => ({ ...item, timestamp: new Date(Date.now() - (50 - index * 12) * 86_400_000).toISOString() })),
			forks: [],
		},
		['pools', 'forks'],
	)
}

let demoLiveSequence = 0
interface LiveEventPayload {
	chainId: string | number
	blockNumber?: string | number
	depth?: string | number
	reason?: HistoryInvalidationReason
}

const applyDemoBlock = (payload: LiveEventPayload) => {
	if (!isDemo || pageUrl.searchParams.get('streamDemo') !== '1') return
	const chainId = String(payload.chainId)
	const network = demoNetworks.find((item) => item.chain_id === chainId)
	if (network === undefined) return
	demoLiveSequence++
	const nextBlock = String(payload.blockNumber ?? BigInt(network.indexed_block) + 1n)
	const nextHash = `0x${BigInt(demoLiveSequence).toString(16).padStart(64, '0')}`
	const timestamp = new Date().toISOString()
	network.indexed_block = nextBlock
	network.indexed_hash = nextHash
	network.indexed_timestamp = timestamp
	network.observed_block = nextBlock
	network.finalized_block = String(BigInt(nextBlock) - 64n)
	network.last_poll_at = timestamp
	network.last_success_at = timestamp
	const template = demoLogs.find((item) => item.chain_id === chainId) ?? requiredArrayItem(demoLogs, 0, 'Demo live log template')
	demoLogs.unshift({
		...template,
		block_number: nextBlock,
		block_hash: nextHash,
		block_timestamp: timestamp,
		transaction_index: 0,
		log_index: demoLiveSequence,
		tx_hash: `0x${(BigInt(demoLiveSequence) + 10_000n).toString(16).padStart(64, '0')}`,
		event_name: demoLiveSequence % 2 === 0 ? 'PoolAccountingCheckpoint' : 'Transfer',
		summary: demoLiveSequence % 2 === 0 ? 'New pool accounting checkpoint' : 'New token transfer',
	})
	if (demoLogs.length > 120) demoLogs.length = 120
	const account = demoRichList.find((item) => item.chain_id === chainId)
	if (account !== undefined) {
		account.transaction_count = String(Number(account.transaction_count) + 1)
		account.interaction_count = String(Number(account.interaction_count) + 1)
		account.native_balance = (BigInt(account.native_balance) + 10_000_000_000_000_000n).toString()
		account.native_balance_detail = { balance: account.native_balance, blockNumber: nextBlock }
		account.last_balance_refresh = timestamp
	}
	const pool = demoPools.find((item) => item.chain_id === chainId)
	if (pool !== undefined) {
		pool.snapshot_block = nextBlock
		pool.settlement_collateral_atto_eth = (BigInt(pool.settlement_collateral_atto_eth) + 10_000_000_000_000_000n).toString()
	}
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

const short = (value: string | readonly unknown[] | null | undefined, front = 6, back = 4): string =>
	value ? `${value.slice(0, front)}…${value.slice(-back)}` : '—'
const shortIdentifier = (value: string, front = 6, back = 4) => {
	const text = String(value ?? '')
	return text.length > front + back + 1 ? short(text, front, back) : text || '—'
}
const number = (value: string | number | bigint | null | undefined): string =>
	value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(Number(value))
const counted = (value: string | number | bigint | null | undefined, singular: string, plural = `${singular}s`): string =>
	`${number(value)} ${Number(value) === 1 ? singular : plural}`
const time = (value: string | number | Date | null | undefined) =>
	value
		? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(value))
		: '—'
const age = (value: string | number | Date | null | undefined) => {
	if (!value) return 'not indexed'
	const seconds = Math.max(0, Math.floor((Date.now() + serverClockOffsetMs - new Date(value).getTime()) / 1000))
	if (seconds < 60) return `${seconds}s ago`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	return `${Math.floor(seconds / 86400)}d ago`
}
const exactTimestamp = (value: string | number | Date | null | undefined) => (value ? new Date(value).toISOString() : 'No indexed timestamp')
const until = (value: string | number | Date | null | undefined) => {
	if (!value) return 'time unknown'
	const seconds = Math.ceil((new Date(value).getTime() - Date.now()) / 1000)
	return seconds <= 0 ? 'now' : seconds < 60 ? `in ${seconds}s` : `in ${Math.ceil(seconds / 60)}m`
}

const isBooleanRecord = (value: unknown): value is Record<string, boolean> => isRecord(value) && Object.values(value).every((item) => typeof item === 'boolean')
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isNetworkRecord = (value: unknown): value is NetworkRecord => isNetworkRecordValue(value)

const isActivityRecord = (value: unknown): value is ActivityRecord => isActivityRecordValue(value)

const isContractRecord = (value: unknown): value is ContractRecord =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['address']) &&
	isString(value['label']) &&
	isString(value['kind']) &&
	isString(value['provenance']) &&
	isNullableString(value['discovery_block']) &&
	isNullableString(value['discovery_tx_hash']) &&
	isNullableString(value['deployment_block']) &&
	isNullableString(value['deployment_timestamp']) &&
	(value['deployment_block_exact'] === null || typeof value['deployment_block_exact'] === 'boolean') &&
	isNullableString(value['deployment_checked_block']) &&
	isString(value['explorer_base_url'])

const isRichListRecord = (value: unknown): value is RichListRecord => isRichListRecordValue(value)

const isAccountTransaction = (value: unknown): value is AccountTransaction => isAccountTransactionValue(value)

const decodeItemsPage = <T>(value: unknown, itemGuard: (item: unknown) => item is T, label: string): ItemsPage<T> => {
	if (!isRecord(value) || !Array.isArray(value['items']) || !value['items'].every(itemGuard)) throw new Error(`${label} response is malformed`)
	const nextCursor = value['nextCursor']
	const total = value['total']
	const limit = value['limit']
	const offset = value['offset']
	const snapshotBlock = value['snapshotBlock']
	if (nextCursor !== undefined && !isString(nextCursor)) throw new Error(`${label} next cursor is malformed`)
	if (total !== undefined && typeof total !== 'number') throw new Error(`${label} total is malformed`)
	if (limit !== undefined && typeof limit !== 'number') throw new Error(`${label} limit is malformed`)
	if (offset !== undefined && typeof offset !== 'number') throw new Error(`${label} offset is malformed`)
	if (snapshotBlock !== undefined && !isString(snapshotBlock)) throw new Error(`${label} snapshot block is malformed`)
	return {
		items: value['items'],
		...(nextCursor === undefined ? {} : { nextCursor }),
		...(total === undefined ? {} : { total }),
		...(limit === undefined ? {} : { limit }),
		...(offset === undefined ? {} : { offset }),
		...(snapshotBlock === undefined ? {} : { snapshotBlock }),
	}
}

const decodeNetworkResponse = (value: unknown): NetworkResponse => {
	const page = decodeItemsPage(value, isNetworkRecord, 'Network status')
	if (!isRecord(value)) throw new Error('Network status response is malformed')
	const serverTime = value['serverTime']
	const freshnessThresholdMs = value['freshnessThresholdMs']
	const clientClockOffsetMs = value['clientClockOffsetMs']
	if (serverTime !== undefined && !isString(serverTime)) throw new Error('Network server time is malformed')
	if (freshnessThresholdMs !== undefined && (typeof freshnessThresholdMs !== 'number' || !Number.isFinite(freshnessThresholdMs) || freshnessThresholdMs <= 0))
		throw new Error('Network freshness threshold is malformed')
	if (clientClockOffsetMs !== undefined && (typeof clientClockOffsetMs !== 'number' || !Number.isFinite(clientClockOffsetMs)))
		throw new Error('Network client clock offset is malformed')
	return {
		...page,
		...(serverTime === undefined ? {} : { serverTime }),
		...(freshnessThresholdMs === undefined ? {} : { freshnessThresholdMs }),
		...(clientClockOffsetMs === undefined ? {} : { clientClockOffsetMs }),
	}
}

const networkSnapshotCache = createSessionSnapshotCache(
	availableSessionSnapshotStorage(() => window.sessionStorage),
	'augurscan:network-status:v1',
	decodeNetworkResponse,
)

const decodeValue = <T>(value: unknown, guard: (candidate: unknown) => candidate is T, label: string): T => {
	if (!guard(value)) throw new Error(`${label} response is malformed`)
	return value
}

const isAddressIdentity = (value: unknown): value is AddressIdentity => isAddressIdentityValue(value)

const isLogDetail = (value: unknown): value is LogDetail => isLogDetailValue(value)

const isPoolRecord = (value: unknown): value is PoolRecord => isPoolStateEntityValue(value)
const isVaultRecord = (value: unknown): value is VaultRecord => isVaultStateEntityValue(value)
const isQuestionRecord = (value: unknown): value is QuestionRecord => isQuestionStateEntityValue(value)
const isUniverseRecord = (value: unknown): value is UniverseRecord => isUniverseStateEntityValue(value)

type PoolStateRecord = NonNullable<StateCatalog['poolStates']>[number]
const isPoolStateRecord = (value: unknown): value is PoolStateRecord =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['pool_address']) &&
	isString(value['event_name']) &&
	isRecord(value['state']) &&
	Object.values(value['state']).every(isJsonValue) &&
	(value['block_number'] === undefined || isString(value['block_number'])) &&
	(value['log_index'] === undefined || typeof value['log_index'] === 'number')

const decodeStateCatalog = (value: unknown): StateCatalog => {
	if (!isRecord(value)) throw new Error('State catalog response is malformed')
	const pools = value['pools']
	const vaults = value['vaults']
	const questions = value['questions']
	const universes = value['universes']
	if (!Array.isArray(pools) || !pools.every(isPoolRecord)) throw new Error('State catalog pools are malformed')
	if (!Array.isArray(vaults) || !vaults.every(isVaultRecord)) throw new Error('State catalog vaults are malformed')
	if (!Array.isArray(questions) || !questions.every(isQuestionRecord)) throw new Error('State catalog questions are malformed')
	if (!Array.isArray(universes) || !universes.every(isUniverseRecord)) throw new Error('State catalog universes are malformed')
	const poolStates = value['poolStates']
	if (poolStates !== undefined && (!Array.isArray(poolStates) || !poolStates.every(isPoolStateRecord))) {
		throw new Error('State catalog pool states are malformed')
	}
	const truncated = value['truncated']
	const limit = value['limit']
	const totals = value['totals']
	if (truncated !== undefined && !isBooleanRecord(truncated)) throw new Error('State catalog truncation metadata is malformed')
	if (limit !== undefined && typeof limit !== 'number') throw new Error('State catalog limit is malformed')
	if (
		totals !== undefined &&
		(!isRecord(totals) ||
			!['pools', 'questions', 'vaults', 'universes'].every(
				(key) => typeof totals[key] === 'number' && Number.isSafeInteger(totals[key]) && Number(totals[key]) >= 0,
			))
	)
		throw new Error('State catalog totals are malformed')
	const decodedTotals =
		totals === undefined
			? undefined
			: {
					pools: Number(totals['pools']),
					questions: Number(totals['questions']),
					vaults: Number(totals['vaults']),
					universes: Number(totals['universes']),
				}
	return {
		pools,
		vaults,
		questions,
		universes,
		...(poolStates === undefined ? {} : { poolStates }),
		...(truncated === undefined ? {} : { truncated }),
		...(limit === undefined ? {} : { limit }),
		...(decodedTotals === undefined ? {} : { totals: decodedTotals }),
	}
}

const isChartRow = (value: unknown): value is ChartRow => isChartRowValue(value)
const isAmmPrice = (value: unknown): value is ReturnType<typeof demoAmmPriceHistory>[number] => isAmmPriceValue(value)
const isRepEthPrice = (value: unknown): value is ReturnType<typeof demoRepEthPriceHistory>[number] => isRepEthPriceValue(value)
const isUniswapPrice = (value: unknown): value is ReturnType<typeof demoUniswapRepEthPriceHistory>[number] => isUniswapPriceValue(value)

const decodeEntityHistory = (value: unknown): EntityHistory => {
	if (!isRecord(value)) throw new Error('State history response is malformed')
	const snapshots = value['snapshots'] ?? []
	const events = value['events'] ?? []
	const ammPrices = value['ammPrices'] ?? []
	const repEthPrices = value['repEthPrices'] ?? []
	const uniswapRepEthPrices = value['uniswapRepEthPrices'] ?? []
	const openOracleHistory = value['openOracleHistory'] ?? []
	const pools = value['pools'] ?? []
	const forks = value['forks'] ?? []
	if (!Array.isArray(snapshots) || !snapshots.every(isChartRow)) throw new Error('State history snapshots are malformed')
	if (!Array.isArray(events) || !events.every(isChartRow)) throw new Error('State history events are malformed')
	if (!Array.isArray(ammPrices) || !ammPrices.every(isAmmPrice)) throw new Error('AMM price history is malformed')
	if (!Array.isArray(repEthPrices) || !repEthPrices.every(isRepEthPrice)) throw new Error('REP/ETH price history is malformed')
	if (!Array.isArray(uniswapRepEthPrices) || !uniswapRepEthPrices.every(isUniswapPrice)) throw new Error('Uniswap price history is malformed')
	if (!Array.isArray(openOracleHistory) || !openOracleHistory.every(isChartRow)) throw new Error('OpenOracle history is malformed')
	if (!Array.isArray(pools) || !pools.every(isJsonValue)) throw new Error('Question pool history is malformed')
	if (!Array.isArray(forks) || !forks.every(isJsonValue)) throw new Error('Question fork history is malformed')
	const market = value['market']
	const truncated = value['truncated']
	const limit = value['limit']
	const offset = value['offset']
	const coverage = value['coverage']
	if (truncated !== undefined && typeof truncated !== 'boolean') throw new Error('State history truncation metadata is malformed')
	if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0)) throw new Error('State history limit is malformed')
	if (offset !== undefined && (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)) throw new Error('State history offset is malformed')
	if (coverage !== undefined && !isEntityHistoryCoverageValue(coverage)) throw new Error('State history coverage is malformed')
	if (
		market !== undefined &&
		market !== null &&
		(!isRecord(market) ||
			(market['pair_address'] !== undefined && !isNullableString(market['pair_address'])) ||
			(market['fee_bps'] !== undefined && market['fee_bps'] !== null && typeof market['fee_bps'] !== 'string' && typeof market['fee_bps'] !== 'number'))
	)
		throw new Error('State market history is malformed')
	return {
		snapshots,
		events,
		ammPrices,
		repEthPrices,
		uniswapRepEthPrices,
		openOracleHistory,
		pools,
		forks,
		...(market === undefined ? {} : { market }),
		...(truncated === undefined ? {} : { truncated }),
		...(limit === undefined ? {} : { limit }),
		...(offset === undefined ? {} : { offset }),
		...(coverage === undefined ? {} : { coverage }),
	}
}

const demoOperations = (chainId: string, atBlock?: string) => {
	const network = demoNetworks.find((item) => item.chain_id === chainId) ?? demoNetworks[0]
	const historicalBlock = atBlock !== undefined && /^\d+$/.test(atBlock) ? atBlock : undefined
	const historical = historicalBlock !== undefined
	const indexedHead = network?.indexed_block ?? '0'
	const observedHead = network?.observed_block ?? indexedHead
	const selectedBlock = historicalBlock ?? indexedHead
	const nonnegativeDifference = (upper: string, lower: string) => String(BigInt(upper) > BigInt(lower) ? BigInt(upper) - BigInt(lower) : 0n)
	const asOf = {
		blockNumber: selectedBlock,
		blockHash: network?.indexed_hash ?? demoHash,
		blockTimestamp: String(Math.floor(new Date(network?.indexed_timestamp ?? Date.now()).getTime() / 1_000)),
		indexedHead,
		observedHead,
		lagBlocks: nonnegativeDifference(observedHead, selectedBlock),
		historyDepthBlocks: nonnegativeDifference(indexedHead, selectedBlock),
		invalidationId: '0',
		abiSourceHash: 'sha256:demo-abi',
		applicationSourceHash: 'sha256:demo-application',
		projectionSourceHash: 'sha256:demo-projection',
		phase: historical ? 'historical' : (network?.phase ?? 'live'),
		lastSuccessfulRefresh: network?.last_success_at ?? new Date().toISOString(),
		historical,
	}
	const reports = [
		{
			open_oracle_address: '0x529dcaC57677451CBfe766d88CcC133D082500df',
			report_id: '1842',
			observed_rounds: 3,
			block_number: asOf.blockNumber,
			report_data: {
				token1: '0x0000000000000000000000000000000000000000',
				token2: '0x221657776846890989a759ba2973e427dff5c9bb',
				currentAmount1: '1000000000000000000',
				currentAmount2: '233590000000000000000',
				currentReporter: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			},
			lifecycle: { state: 'Dispute window open', clock: 'timestamp', nextTransition: String(Number(asOf.blockTimestamp) + 1_800) },
		},
		{
			open_oracle_address: '0x529dcaC57677451CBfe766d88CcC133D082500df',
			report_id: '1841',
			observed_rounds: 1,
			block_number: String(BigInt(asOf.blockNumber) - 12n),
			report_data: { token1: '0x221657776846890989a759ba2973e427dff5c9bb', token2: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
			lifecycle: { state: 'Settleable', clock: 'block' },
		},
	]
	const escalations = [
		{
			game_address: '0x7777777777777777777777777777777777777777',
			event_name: 'DepositOnOutcome',
			block_number: asOf.blockNumber,
			invalid_stake_atto_rep: '400000000000000000000',
			no_stake_atto_rep: '900000000000000000000',
			yes_stake_atto_rep: '1250000000000000000000',
		},
	]
	const auctions = [
		{
			auction_address: '0x8888888888888888888888888888888888888888',
			status: 'Open',
			bid_count: 18,
			bidder_count: 11,
			block_number: asOf.blockNumber,
			start_data: { attoEthRaiseCap: String(20_000_000_000_000_000_000n), maxAttoRepBeingSold: String(5_000_000_000_000_000_000_000n) },
		},
	]
	const risk = {
		pools: [
			{
				pool_address: '0x9999999999999999999999999999999999999999',
				block_number: asOf.blockNumber,
				read_status: 'success',
				source_method: 'poolAccountingState()',
				protocol_state: '0',
				scanner_severity: 'warning',
				scanner_reason: 'Pool is above the scanner capacity warning band',
				capacity: {
					usedAttoEth: (42n * 10n ** 18n).toString(),
					capacityAttoEth: (50n * 10n ** 18n).toString(),
					availableAttoEth: (8n * 10n ** 18n).toString(),
					utilizationBps: '8400',
				},
			},
		],
		vaults: [
			{
				pool_address: '0x9999999999999999999999999999999999999999',
				vault_address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				block_number: asOf.blockNumber,
				read_status: 'success',
				source_method: 'vaultAccountingState()',
				protocol_state: 'healthy',
				scanner_severity: 'warning',
				scanner_reason: 'Health factor is below the scanner warning threshold',
				risk: { healthFactorBps: '11350', targetHealthFactorBps: '12000', liquidationBoundaryBps: '10000' },
			},
		],
		recentLiquidations: [],
		approvalEvents: [
			{
				event_name: 'LiquidationApprovalConsumed',
				approval_identity: `0x${'a'.repeat(64)}`,
				receiver_vault: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				block_number: asOf.blockNumber,
				transaction_index: 8,
				log_index: 3,
				event_data: {
					operationId: '42',
					consumedDebtAttoEth: (2n * 10n ** 18n).toString(),
					releasedDebtAttoEth: (3n * 10n ** 17n).toString(),
					resultingAvailableDebtAttoEth: (8n * 10n ** 18n).toString(),
					resultingReservedDebtAttoEth: 0n.toString(),
					resultingConsumedDebtAttoEth: (2n * 10n ** 18n).toString(),
				},
			},
			{
				event_name: 'LiquidationApprovalReserved',
				approval_identity: `0x${'a'.repeat(64)}`,
				receiver_vault: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				block_number: asOf.blockNumber,
				transaction_index: 2,
				log_index: 1,
				event_data: { operationId: '42', reservedDebtAttoEth: (2n * 10n ** 18n).toString() },
			},
			{
				event_name: 'LiquidationApprovalNonceInvalidated',
				approval_identity: 'nonce:0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				receiver_vault: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
				block_number: asOf.blockNumber,
				transaction_index: 9,
				log_index: 1,
				event_data: { previousNonce: '41', newNonce: '42' },
			},
		],
		pagination: { poolTotal: 1, poolHasMore: false, vaultTotal: 1, vaultHasMore: false },
	}
	return {
		chainId,
		asOf,
		data: {
			reports,
			escalations,
			auctions,
			risk,
			prices: [{ source_event: 'PriceReported', value: '233590000000000000000', block_number: asOf.blockNumber }],
			forks: [
				{
					universe_identity: '0',
					event_name: 'UniverseForked',
					block_number: asOf.blockNumber,
					child_count: 2,
					migrator_count: 14,
					migrated_atto_rep: '4500000000000000000000',
					obligation_events: 3,
				},
			],
			totals: { reports: reports.length, escalations: escalations.length, auctions: auctions.length, pools: risk.pools.length, vaults: risk.vaults.length },
			recentChanges: [
				{ semantic_event_kind: 'ReportDisputed', entity_identity: '0x529dca…:1842', block_number: asOf.blockNumber },
				{ semantic_event_kind: 'DepositOnOutcome', entity_identity: '0x777777…', block_number: asOf.blockNumber },
			],
		},
	}
}

const demoOperationsDetail = (path: string): unknown => {
	const request = new URL(path, location.origin)
	const parts = request.pathname.split('/').filter(Boolean)
	const domain = parts[3]
	const chainId = (domain === 'risk' ? parts[5] : parts[4]) ?? '1'
	const operations = demoOperations(chainId, request.searchParams.get('atBlock') ?? undefined)
	const identity = parts.slice(5).map(decodeURIComponent)
	const evidence = (eventName: string, eventData: Record<string, unknown>) => ({
		event_name: eventName,
		event_data: eventData,
		block_number: operations.asOf.blockNumber,
		block_hash: operations.asOf.blockHash,
		tx_hash: demoHash,
		log_index: 7,
		canonical: true,
	})
	const evidencePage = (item: Record<string, unknown>) => {
		const continuationFixture = pageUrl.searchParams.get('detailMore') === '1'
		if (continuationFixture && request.searchParams.has('cursor'))
			return {
				items: [{ ...item, block_number: String(BigInt(operations.asOf.blockNumber) - 1n), log_index: 2, tx_hash: `0x${'d'.repeat(64)}` }],
				limit: 100,
				hasMore: false,
			}
		return { items: [item], limit: 100, hasMore: continuationFixture, ...(continuationFixture ? { nextCursor: 'demo-detail-older' } : {}) }
	}
	if (domain === 'reports') {
		const report = operations.data.reports.find(
			(item) => item.open_oracle_address.toLowerCase() === identity[0]?.toLowerCase() && item.report_id === identity[1],
		)
		const current = {
			...evidence('ReportDisputed', report?.report_data ?? {}),
			round_number: '2',
			report_data: report?.report_data ?? {},
			lifecycle: report?.lifecycle ?? { state: 'Awaiting indexed evidence', clock: 'timestamp' },
			comparison: {
				state: 'compared',
				previousRoundNumber: '1',
				previousBlockNumber: String(BigInt(operations.asOf.blockNumber) - 12n),
				changes: [
					{ field: 'currentAmount2', kind: 'changed', before: '230000000000000000000', after: '233590000000000000000' },
					{
						field: 'currentReporter',
						kind: 'changed',
						before: '0x1111111111111111111111111111111111111111',
						after: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					},
				],
			},
		}
		const coordinatorDecision = {
			event_name: 'PriceReportRejected',
			summary: 'Replacement round was required',
			arguments: { reportId: identity[1], reason: 'Report was disputed' },
			emitter_address: '0x7777777777777777777777777777777777777777',
			block_number: operations.asOf.blockNumber,
		}
		const coordinatorDecisions = request.searchParams.has('decisionCursor')
			? { items: [{ ...coordinatorDecision, event_name: 'PendingReportRecovered' }], limit: 100, hasMore: false }
			: {
					items: [coordinatorDecision],
					limit: 100,
					hasMore: pageUrl.searchParams.get('decisionMore') === '1',
					...(pageUrl.searchParams.get('decisionMore') === '1' ? { nextCursor: 'demo-decision-older' } : {}),
				}
		return {
			chainId,
			asOf: operations.asOf,
			data: {
				identity: { openOracleAddress: identity[0], reportId: identity[1] },
				current,
				rounds: evidencePage(current),
				coordinatorDecisions,
			},
		}
	}
	if (domain === 'escalations') {
		const event = evidence('DepositOnOutcome', {
			depositor: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
			outcome: '1',
			attoRepAmount: '1250000000000000000000',
		})
		return {
			chainId,
			asOf: operations.asOf,
			data: {
				identity: identity[0],
				snapshot: {
					entity_identity: identity[0],
					block_number: operations.asOf.blockNumber,
					read_status: 'success',
					source_method: 'lifecycle(), balances(), totalCapital()',
					read_result: { phase: 'Active', requiredNextDepositAttoRep: (500n * 10n ** 18n).toString() },
				},
				deposits: [event],
				claims: [],
				events: evidencePage(event),
			},
		}
	}
	if (domain === 'auctions') {
		const bid = evidence('BidSubmitted', { bidder: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db', tick: '14', bidAmountAttoEth: (3n * 10n ** 18n).toString() })
		return {
			chainId,
			asOf: operations.asOf,
			data: {
				identity: identity[0],
				snapshot: {
					entity_identity: identity[0],
					block_number: operations.asOf.blockNumber,
					read_status: 'success',
					source_method: 'auctionState(), computeClearing()',
					read_result: { state: 'Open' },
				},
				demandCurve: [{ tick: '14', amountAttoEth: (3n * 10n ** 18n).toString(), cumulativeDemandAttoEth: (3n * 10n ** 18n).toString() }],
				events: evidencePage(bid),
			},
		}
	}
	if (domain === 'risk') {
		const kind = parts[4]
		const risk = operations.data.risk
		const entity =
			kind === 'pools'
				? risk.pools.find((item) => item.pool_address.toLowerCase() === parts[6]?.toLowerCase())
				: risk.vaults.find(
						(item) => item.pool_address.toLowerCase() === parts[6]?.toLowerCase() && item.vault_address.toLowerCase() === parts[7]?.toLowerCase(),
					)
		const offset = request.searchParams.has('cursor') ? 100 : 0
		const historyMore = pageUrl.searchParams.get('riskHistoryMore') === '1'
		const historyBlock = String(BigInt(operations.asOf.blockNumber) - BigInt(offset === 0 ? 5 : 500))
		const historyRecord = (eventName: string, logIndex: number) => ({
			event_name: eventName,
			block_number: historyBlock,
			block_hash: `0x${BigInt(90_000 + offset + logIndex)
				.toString(16)
				.padStart(64, '0')}`,
			tx_hash: `0x${BigInt(100_000 + offset + logIndex)
				.toString(16)
				.padStart(64, '0')}`,
			log_index: logIndex,
			canonical: true,
		})
		return {
			chainId: parts[5] ?? chainId,
			asOf: operations.asOf,
			data: {
				...(entity ?? {}),
				approvalEvents: risk.approvalEvents,
				history: {
					stateSnapshots: [historyRecord('TaggedStateRead', 0)],
					accountingSnapshots: [historyRecord('VaultAccountingCheckpoint', 1)],
					lifecycleEvents: [historyRecord(offset === 0 ? 'VaultHealthChecked' : 'VaultDepositTargetHealthFactorRecorded', 2)],
					liquidations: offset === 0 ? [] : [historyRecord('VaultLiquidated', 3)],
					limit: 100,
					offset,
					truncated: historyMore && offset === 0,
					...(historyMore && offset === 0 ? { nextCursor: 'demo-risk-history-older' } : {}),
				},
			},
		}
	}
	if (domain === 'trading') {
		const swap = evidence('Swap', {
			yesForNo: true,
			amountIn: '1000000000000000000',
			amountOut: '970000000000000000',
			feeAmount: '3000000000000000',
			resultingYesReserve: '51000000000000000000',
			resultingNoReserve: '49030000000000000000',
		})
		return {
			chainId,
			asOf: operations.asOf,
			data: {
				market: identity[0],
				summary: {
					swaps_24h: 12,
					swaps_7d: 63,
					input_volume_24h: '18000000000000000000',
					input_volume_7d: '91000000000000000000',
					fees_24h: '54000000000000000',
					fees_7d: '273000000000000000',
				},
				twap24h: { state: 'Available', numerator: '49', denominator: '51', coverageSeconds: '86400', windowSeconds: '86400' },
				twap7d: { state: 'Partial coverage', numerator: '97', denominator: '100', coverageSeconds: '518400', windowSeconds: '604800' },
				candles: [
					{
						bucketStart: String(BigInt(operations.asOf.blockTimestamp) - 3600n),
						open: { numerator: '1', denominator: '1' },
						high: { numerator: '1', denominator: '1' },
						low: { numerator: '49', denominator: '51' },
						close: { numerator: '49', denominator: '51' },
						observations: 12,
					},
				],
				lpPositions: [
					{
						address: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
						balance: '12500000000000000000',
						received_liquidity: '15000000000000000000',
						sent_liquidity: '2500000000000000000',
					},
				],
				events: evidencePage(swap),
			},
		}
	}
	const migration = evidence('MigrationRepSplit', {
		universeId: identity[0],
		childUniverseId: '1',
		outcomeIndex: '1',
		migrator: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
		amountAttoRep: (4_500n * 10n ** 18n).toString(),
	})
	return {
		chainId,
		asOf: operations.asOf,
		data: {
			identity: identity[0],
			summary: {
				migrated_atto_rep: '4500000000000000000000',
				burned_atto_rep: '500000000000000000000',
				migrator_count: 1,
				child_count: 1,
				pool_migration_events: 4,
				obligations_initialized: 2,
				obligations_materialized: 1,
			},
			branches: [{ child_universe_id: '1', outcome_index: '1', migrated_atto_rep: '4500000000000000000000', migrator_count: 1, migration_count: 1 }],
			events: evidencePage(migration),
		},
	}
}

const api = async (path: string, { signal }: { signal?: AbortSignal } = {}): Promise<unknown> => {
	if (isDemo) {
		if (path.startsWith('/api/v1/networks')) {
			if (networkState === 'error') throw new Error('Network status could not be refreshed')
			demoNetworkRequests++
			const items = demoNetworkItems()
			return {
				items:
					pageUrl.searchParams.get('networkFallbackAfterLoad') === '1' && demoNetworkRequests > 1 ? items.filter((network) => network.chain_id !== '1') : items,
			}
		}
		if (path.startsWith('/api/v1/contracts')) {
			const chainId = new URL(path, location.origin).searchParams.get('chainId')
			const items = demoContracts.filter((contract) => contract.chain_id === chainId)
			if (deploymentState === 'bounded' && items[0] !== undefined)
				items[0] = {
					...items[0],
					deployment_block: '0',
					deployment_block_exact: false,
					deployment_timestamp: '2021-10-03T13:24:41.000Z',
				}
			if (deploymentState === 'absent' && items[0] !== undefined)
				items[0] = { ...items[0], deployment_block: null, deployment_block_exact: null, deployment_timestamp: null, deployment_checked_block: '0' }
			return { items }
		}
		if (path.startsWith('/api/v1/operations')) {
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'error') throw new Error('Operations could not be loaded')
			return demoOperations(new URL(path, location.origin).searchParams.get('chainId') ?? '1')
		}
		if (/^\/api\/v1\/state\/risk(?:\?|$)/.test(path)) {
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'error') throw new Error('Risk catalog could not be loaded')
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId') ?? '1'
			const operations = demoOperations(chainId, request.searchParams.get('atBlock') ?? undefined)
			const baseRisk = operations.data.risk
			const more = pageUrl.searchParams.get('catalogMore') === '1'
			const poolCursor = request.searchParams.get('poolCursor')
			const vaultCursor = request.searchParams.get('vaultCursor')
			if ((poolCursor !== null || vaultCursor !== null) && pageUrl.searchParams.get('catalogAppendDelay') === '1')
				await new Promise((resolve) => setTimeout(resolve, 2_500))
			if ((poolCursor !== null || vaultCursor !== null) && pageUrl.searchParams.get('catalogAppendError') === '1')
				throw new Error('Additional risk records could not be loaded')
			const pools =
				poolCursor === null
					? baseRisk.pools
					: baseRisk.pools.map((pool) => ({ ...pool, pool_address: demoAddress('98'), block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }))
			const vaults =
				vaultCursor === null
					? baseRisk.vaults
					: baseRisk.vaults.map((vault) => ({ ...vault, vault_address: demoAddress('c8'), block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }))
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					...baseRisk,
					pools,
					vaults,
					pagination: {
						poolTotal: more ? 2 : pools.length,
						vaultTotal: more ? 2 : vaults.length,
						poolHasMore: more && poolCursor === null,
						vaultHasMore: more && vaultCursor === null,
						...(more && poolCursor === null ? { poolNextCursor: 'demo-pool-older' } : {}),
						...(more && vaultCursor === null ? { vaultNextCursor: 'demo-vault-older' } : {}),
					},
				},
			}
		}
		if (/^\/api\/v1\/state\/(reports|escalations|auctions|forks|trading|timeline|integrity)(?:\?|$)/.test(path)) {
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'error') throw new Error('Operations catalog could not be loaded')
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId') ?? '1'
			const operations = demoOperations(chainId, request.searchParams.get('atBlock') ?? undefined)
			const section = request.pathname.split('/').at(-1)
			const timelineFixture = [
				{
					entity_type: 'open-oracle-report',
					entity_identity: '0x529dcaC57677451CBfe766d88CcC133D082500df:1842',
					semantic_event_kind: 'ReportDisputed',
					source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
					block_number: operations.asOf.blockNumber,
					block_hash: operations.asOf.blockHash,
					tx_hash: demoHash,
					log_index: 7,
					canonical: true,
					evidence_status: demoTimelineEvidenceStatus(true),
				},
				{
					entity_type: 'reporter',
					entity_identity: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
					semantic_event_kind: 'ReportDisputed',
					source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
					block_number: operations.asOf.blockNumber,
					block_hash: operations.asOf.blockHash,
					tx_hash: demoHash,
					log_index: 7,
					canonical: true,
					evidence_status: demoTimelineEvidenceStatus(true),
				},
				{
					entity_type: 'open-oracle-report',
					entity_identity: '0x529dcaC57677451CBfe766d88CcC133D082500df:1842',
					semantic_event_kind: 'ReportDisputed',
					source_contract: '0x529dcaC57677451CBfe766d88CcC133D082500df',
					block_number: operations.asOf.blockNumber,
					block_hash: `0x${'4d'.repeat(32)}`,
					tx_hash: `0x${'9b'.repeat(32)}`,
					log_index: 7,
					canonical: false,
					evidence_status: demoTimelineEvidenceStatus(false, 'chain-reorg'),
					invalidation_reason: 'chain-reorg',
				},
			]
			const fixtureItems =
				section === 'reports'
					? operations.data.reports
					: section === 'escalations'
						? operations.data.escalations
						: section === 'auctions'
							? operations.data.auctions
							: section === 'forks'
								? operations.data.forks
								: section === 'trading'
									? [
											{
												pair_address: demoAddress('fa'),
												pool_address: demoPools[0]?.pool_address,
												question_title: demoPools[0]?.question_title,
												conditional_yes_bps: '5100',
												swap_count: 63,
												lp_holder_count: 4,
												price_block_number: operations.asOf.blockNumber,
											},
										]
									: section === 'timeline'
										? timelineFixture.filter((item) => request.searchParams.get('canonical') === 'all' || item.canonical)
										: [
												{
													id: '1',
													reason: pageUrl.searchParams.get('integrityCombinedCauses') === '1' ? 'projection-rebuild' : 'chain-reorg',
													depth: '2',
													previous_block: operations.asOf.blockNumber,
													previous_hash: demoHash,
													ancestor_block: String(BigInt(operations.asOf.blockNumber) - 2n),
													ancestor_hash: `0x${'1834a6d2b779c501'.repeat(4)}`,
													causes:
														pageUrl.searchParams.get('integrityCombinedCauses') === '1'
															? ['abi-redecode', 'manifest-reset', 'projection-rebuild']
															: ['chain-reorg'],
													occurrence_counts: { block: '2', transaction: '9', log: '24', 'entity-state': '6' },
													indexer_run_id: '1',
													abi_source_hash: demoHash.slice(2),
													application_source_hash: `sha256:${demoHash.slice(2)}`,
													projection_source_hash: `sha256:${demoHash.slice(2)}`,
													detected_at: '2026-08-26T12:34:57.814Z',
												},
											]
			const items = pageUrl.searchParams.get('catalogEmpty') === '1' ? [] : fixtureItems
			const continuationFixture = pageUrl.searchParams.get('catalogMore') === '1'
			const cursor = request.searchParams.get('cursor')
			if (continuationFixture && cursor !== null) {
				if (pageUrl.searchParams.get('catalogAppendDelay') === '1') await new Promise((resolve) => setTimeout(resolve, 2_500))
				if (pageUrl.searchParams.get('catalogAppendError') === '1') throw new Error('Older canonical records could not be loaded')
				const older = items.at(-1)
				return {
					chainId,
					asOf: operations.asOf,
					data: {
						items: older === undefined ? [] : [{ ...older, block_number: String(BigInt(operations.asOf.blockNumber) - 100n) }],
						...(section === 'forks' || section === 'timeline' ? { total: items.length + 1 } : {}),
						limit: 100,
						hasMore: false,
					},
				}
			}
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					items,
					...(section === 'forks' || section === 'timeline' ? { total: items.length + (continuationFixture ? 1 : 0) } : {}),
					limit: 100,
					hasMore: continuationFixture,
					...(continuationFixture ? { nextCursor: 'demo-older' } : {}),
					...(section === 'integrity'
						? {
								migrations: [{ schema_version: '2', description: 'Historical integrity', applied_at: '2026-08-26T12:30:01.042Z' }],
								runs: [
									{
										id: '1',
										schema_version: '2',
										app_version: '0.1.0',
										abi_source_hash: demoHash.slice(2),
										application_source_hash: `sha256:${demoHash.slice(2)}`,
										projection_source_hash: `sha256:${demoHash.slice(2)}`,
										indexer_enabled: true,
										started_at: '2026-08-26T12:31:04.771Z',
										stopped_at: null,
									},
								],
							}
						: {}),
				},
			}
		}
		if (/^\/api\/v1\/state\/(reports|escalations|auctions|forks|trading|risk\/(?:pools|vaults))\//.test(path)) {
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'error') throw new Error('Operations detail could not be loaded')
			const request = new URL(path, location.origin)
			const riskHistoryContinuation = request.pathname.includes('/risk/') && request.searchParams.has('cursor')
			if (riskHistoryContinuation && pageUrl.searchParams.get('riskHistoryAppendDelay') === '1') await new Promise((resolve) => setTimeout(resolve, 2_500))
			if (riskHistoryContinuation && pageUrl.searchParams.get('riskHistoryAppendError') === '1' && !demoRiskHistoryAppendErrorConsumed) {
				demoRiskHistoryAppendErrorConsumed = true
				throw new Error('Older risk history could not be loaded')
			}
			if (request.searchParams.has('cursor') && pageUrl.searchParams.get('detailAppendDelay') === '1')
				await new Promise((resolve) => setTimeout(resolve, 2_500))
			if (request.searchParams.has('cursor') && pageUrl.searchParams.get('detailAppendError') === '1')
				throw new Error('Older canonical evidence could not be loaded')
			return demoOperationsDetail(path)
		}
		if (path.startsWith('/api/v1/state/catalog')) {
			if (demoReorgObserved && pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !demoCanonicalRouteRefreshErrorConsumed) {
				demoCanonicalRouteRefreshErrorConsumed = true
				throw new Error('The system state could not be refreshed')
			}
			if (demoState === 'error' && !demoErrorConsumed) {
				demoErrorConsumed = true
				throw new Error('The state catalog could not be read from the database')
			}
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'delayed') await new Promise((resolve) => setTimeout(resolve, 300))
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			return {
				pools: demoCatalog.pools.filter((item) => !chainId || item.chain_id === chainId),
				vaults: demoCatalog.vaults.filter((item) => !chainId || item.chain_id === chainId),
				questions: demoCatalog.questions.filter((item) => !chainId || item.chain_id === chainId),
				universes: demoCatalog.universes.filter((item) => !chainId || item.chain_id === chainId),
				totals: {
					pools: demoCatalog.pools.filter((item) => !chainId || item.chain_id === chainId).length,
					vaults: demoCatalog.vaults.filter((item) => !chainId || item.chain_id === chainId).length,
					questions: demoCatalog.questions.filter((item) => !chainId || item.chain_id === chainId).length,
					universes: demoCatalog.universes.filter((item) => !chainId || item.chain_id === chainId).length,
				},
			}
		}
		if (path.startsWith('/api/v1/state/address-portfolio')) {
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId') ?? '1'
			const address = request.searchParams.get('address')?.toLowerCase()
			const item = demoRichList.find((candidate) => candidate.chain_id === chainId && candidate.address.toLowerCase() === address)
			const operations = demoOperations(chainId)
			const more = pageUrl.searchParams.get('portfolioMore') === '1'
			const lpCursor = request.searchParams.get('lpCursor')
			const forkCursor = request.searchParams.get('forkCursor')
			const reportCursor = request.searchParams.get('reportCursor')
			const continuationRequested = lpCursor !== null || forkCursor !== null || reportCursor !== null
			if (continuationRequested && pageUrl.searchParams.get('portfolioAppendDelay') === '1') await new Promise((resolve) => setTimeout(resolve, 2_500))
			if (continuationRequested && pageUrl.searchParams.get('portfolioAppendError') === '1' && !demoPortfolioAppendErrorConsumed) {
				demoPortfolioAppendErrorConsumed = true
				throw new Error('Additional account evidence could not be loaded')
			}
			const lpPositions = [
				{
					market_address: lpCursor === null ? demoAddress('a7') : demoAddress('a8'),
					pool_address: demoAddress('7'),
					question_title: 'Will the protocol meet its launch reliability target?',
					balance: '4250000000000000000',
					transfer_count: 6,
				},
			]
			const forkParticipation = [
				{
					universe_identity: forkCursor === null ? '0' : '1',
					event_name: 'MigrationRepAdded',
					block_number: String(BigInt(operations.asOf.blockNumber) - BigInt(forkCursor === null ? 0 : 100)),
					block_hash: demoHash,
					tx_hash: forkCursor === null ? `0x${'a'.repeat(64)}` : `0x${'b'.repeat(64)}`,
					log_index: 1,
				},
			]
			const reportParticipation = [
				{
					open_oracle_address: demoAddress('9'),
					report_id: reportCursor === null ? '1842' : '1841',
					event_name: 'ReportSubmitted',
					round_number: '2',
					block_number: String(BigInt(operations.asOf.blockNumber) - BigInt(reportCursor === null ? 0 : 100)),
					block_hash: demoHash,
					tx_hash: reportCursor === null ? `0x${'c'.repeat(64)}` : `0x${'d'.repeat(64)}`,
					log_index: 2,
				},
			]
			return {
				chainId,
				asOf: operations.asOf,
				data: {
					...(item ?? {
						chain_id: chainId,
						address: address ?? demoAddress('1'),
						availability: 'Awaiting indexed evidence',
					}),
					lp_positions: lpPositions,
					fork_participation: forkParticipation,
					report_participation: reportParticipation,
					portfolioPagination: {
						lp: {
							total: more ? 2 : 1,
							limit: 100,
							offset: lpCursor === null ? 0 : 1,
							hasMore: more && lpCursor === null,
							...(more && lpCursor === null ? { nextCursor: 'demo-lp-older' } : {}),
						},
						forks: {
							total: more ? 2 : 1,
							limit: 100,
							offset: forkCursor === null ? 0 : 1,
							hasMore: more && forkCursor === null,
							...(more && forkCursor === null ? { nextCursor: 'demo-fork-older' } : {}),
						},
						reports: {
							total: more ? 2 : 1,
							limit: 100,
							offset: reportCursor === null ? 0 : 1,
							hasMore: more && reportCursor === null,
							...(more && reportCursor === null ? { nextCursor: 'demo-report-older' } : {}),
						},
					},
				},
			}
		}
		if (path.startsWith('/api/v1/state/')) {
			demoStateDetailRequests++
			const stateHistoryRequest = new URL(path, location.origin)
			const stateHistoryOffset = stateHistoryRequest.searchParams.has('cursor') ? 1000 : 0
			if (stateHistoryOffset > 0 && pageUrl.searchParams.get('stateHistoryAppendDelay') === '1') await new Promise((resolve) => setTimeout(resolve, 2_500))
			if (stateHistoryOffset > 0 && pageUrl.searchParams.get('stateHistoryAppendError') === '1' && !demoStateHistoryAppendErrorConsumed) {
				demoStateHistoryAppendErrorConsumed = true
				throw new Error('Older state history could not be loaded')
			}
			if (detailState === 'error' && !demoDetailErrorConsumed) {
				demoDetailErrorConsumed = true
				throw new Error('Historical checkpoints could not be read')
			}
			if (detailState === 'refresh-error' && demoStateDetailRequests === 2) throw new Error('The newest checkpoint could not be read')
			if (detailState === 'loading') return await new Promise(() => {})
			if (detailState === 'delayed') await new Promise((resolve) => setTimeout(resolve, 800))
			return demoHistory(path)
		}
		if (path.startsWith('/api/v1/address-transactions')) {
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const address = request.searchParams.get('address')?.toLowerCase()
			const cursor = request.searchParams.get('cursor')
			demoTransactionRequests++
			window.__demoTransactionRequests = demoTransactionRequests
			if (pageUrl.searchParams.get('transactionAppendDelay') === '1' && cursor !== null) await new Promise((resolve) => setTimeout(resolve, 1_500))
			if (pageUrl.searchParams.get('transactionAppendErrorOnce') === '1' && cursor !== null && !demoTransactionAppendErrorConsumed) {
				demoTransactionAppendErrorConsumed = true
				throw new Error('The next transaction page could not be read')
			}
			if (
				(pageUrl.searchParams.get('transactionLiveRefreshDelay') === '1' || pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1') &&
				!canonicalRefreshRequired &&
				cursor === null &&
				demoTransactionRequests > 1
			)
				await new Promise((resolve) => setTimeout(resolve, pageUrl.searchParams.get('transactionLiveRefreshDelayLong') === '1' ? 3_500 : 800))
			if (pageUrl.searchParams.get('transactionRestoreDelay') === '1' && canonicalRefreshRequired && cursor === null && demoTransactionRequests > 1)
				await new Promise((resolve) => setTimeout(resolve, 800))
			if (
				pageUrl.searchParams.get('transactionRestoreErrorOnce') === '1' &&
				cursor === null &&
				demoTransactionRequests > 1 &&
				!demoTransactionRestoreErrorConsumed
			) {
				demoTransactionRestoreErrorConsumed = true
				throw new Error('The account transactions could not be restored')
			}
			if (
				cursor !== null &&
				((pageUrl.searchParams.get('transactionCursor409') === '1' && !demoTransactionSnapshotInvalidated) ||
					pageUrl.searchParams.get('transactionCursor409Always') === '1')
			) {
				if (pageUrl.searchParams.get('transactionCursor409Always') !== '1') demoTransactionSnapshotInvalidated = true
				const error = new Error('The transaction snapshot changed after a chain update')
				error.status = 409
				throw error
			}
			if (pageUrl.searchParams.get('transactionRefreshError') === '1' && cursor === null && demoTransactionRequests > 1)
				throw new Error('The newest account transactions could not be read')
			if (demoReorgObserved && pageUrl.searchParams.get('evictTransactionOnReorg') === '1') demoTransactionSnapshotInvalidated = true
			const offset = cursor ? Number(JSON.parse(atob(cursor))) : 0
			const limit = Number(request.searchParams.get('limit') ?? 50)
			const owner = demoRichList.find((item) => item.chain_id === chainId && item.address.toLowerCase() === address)
			const total = Math.max(0, Number(owner?.transaction_count ?? 0) - (demoTransactionSnapshotInvalidated ? 1 : 0))
			const network = demoNetworks.find((item) => item.chain_id === chainId)
			const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, itemIndex) => {
				const index = offset + itemIndex + (demoTransactionSnapshotInvalidated ? 1 : 0)
				const initialTotal = demoInitialTransactionCounts.get(`${chainId}:${address}`) ?? total
				const ordinal = Number(owner?.transaction_count ?? 0) - index - 1
				const liveOrdinal = ordinal - initialTotal
				const baseline = chainId === null ? undefined : demoNetworkBaselines.get(chainId)
				const blockNumber =
					liveOrdinal >= 0
						? (baseline?.blockNumber ?? 0n) + BigInt(liveOrdinal + 1)
						: (baseline?.blockNumber ?? 0n) - BigInt(Math.max(0, initialTotal - ordinal - 1))
				const blockTimestamp = new Date((baseline?.timestamp ?? Date.now()) + (liveOrdinal >= 0 ? liveOrdinal + 1 : -(initialTotal - ordinal - 1)) * 14_000)
				const toAddress = ordinal % 2 === 0 ? '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db' : '0x7777777777777777777777777777777777777777'
				return {
					chain_id: chainId,
					tx_hash: `${demoHash.slice(0, -8)}${ordinal.toString(16).padStart(8, '0')}`,
					block_hash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
					block_number: String(blockNumber),
					block_timestamp: blockTimestamp.toISOString(),
					transaction_index: ordinal % 12,
					from_address: owner?.address,
					to_address: toAddress,
					to_label: ordinal % 2 === 0 ? 'OpenOracle' : 'Security Pool',
					to_kind: ordinal % 2 === 0 ? 'openOracle' : 'securityPool',
					value: ordinal % 4 === 0 ? '125000000000000000' : '0',
					status: 'success',
					gas_used: String(94_000 + ordinal * 117),
					function_name: ordinal % 2 === 0 ? 'report' : 'checkpointPoolAccounting',
					function_signature: ordinal % 2 === 0 ? 'report((...),bool,bool,(...))' : 'checkpointPoolAccounting(uint8)',
					action_summary: ordinal % 2 === 0 ? 'report · reportId=1842' : 'checkpointPoolAccounting · reason=Trade',
					action_arguments:
						ordinal % 2 === 0
							? {
									reporter: '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db',
									recipients: ['0x7777777777777777777777777777777777777777', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
								}
							: { reason: '1' },
					action_display_arguments:
						ordinal % 2 === 0
							? {
									reporter: 'OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)',
									recipients: ['Security Pool (0x7777777777777777777777777777777777777777)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
								}
							: { reason: 'Trade' },
					action_argument_schema:
						ordinal % 2 === 0
							? [
									{ index: 0, name: 'reporter', type: 'address' },
									{ index: 1, name: 'recipients', type: 'address[]' },
								]
							: [{ index: 0, name: 'reason', type: 'uint8' }],
					explorer_base_url: network?.explorer_base_url ?? '',
				}
			})
			const nextOffset = offset + items.length
			return { items, total, limit, snapshotBlock: network?.indexed_block, nextCursor: nextOffset < total ? btoa(JSON.stringify(nextOffset)) : undefined }
		}
		if (path.startsWith('/api/v1/address-interactions')) {
			const transactions = decodeItemsPage(
				await api(path.replace('/address-interactions', '/address-transactions')),
				isAccountTransaction,
				'Address transactions',
			)
			return {
				...transactions,
				items: transactions.items
					.filter((_, index) => index % 3 === 0)
					.map((transaction, index) => ({
						...transaction,
						roles: ['referenced'],
						pool_addresses: index % 2 === 0 ? ['0x7777777777777777777777777777777777777777'] : [],
					})),
			}
		}
		if (path.startsWith('/api/v1/address-identity')) {
			const request = new URL(path, location.origin)
			const chainId = request.searchParams.get('chainId')
			const address = request.searchParams.get('address')?.toLowerCase()
			const owner = demoRichList.find((item) => item.chain_id === chainId && item.address.toLowerCase() === address)
			const fixedIdentities: Record<string, readonly [string, string]> = {
				'0xc9b36e44643fc5d882654ffd9791ae7171b0e9db': ['OpenOracle', 'openOracle'],
				'0x7777777777777777777777777777777777777777': ['Security Pool', 'securityPool'],
			}
			const fixedIdentity = address === undefined ? undefined : fixedIdentities[address]
			const catalogIdentity = [
				...demoPools.flatMap((pool) => [
					[pool.chain_id, pool.pool_address, 'Security Pool', 'securityPool'],
					[pool.chain_id, pool.share_token_address, 'Share token', 'shareToken'],
					[pool.chain_id, pool.coordinator_address, 'Price coordinator', 'priceCoordinator'],
					[pool.chain_id, pool.truth_auction_address, 'Truth auction', 'truthAuction'],
				]),
				...demoUniverses.map((universe) => [
					universe.chain_id,
					universe.reputation_token_address,
					universe.universe_id === '0' ? 'Genesis REP' : `Child REP · universe ${shortIdentifier(universe.universe_id)}`,
					'reputationToken',
				]),
				...demoRichList.flatMap((item) =>
					[...(item.rep_balances ?? []), ...(item.weth_balances ?? [])].map((token) => [
						item.chain_id,
						token.address,
						'contractLabel' in token ? token.contractLabel : token.name,
						'universeId' in token ? 'reputationToken' : 'weth',
					]),
				),
			].find(
				(identity): identity is [string, string, string, string] =>
					identity.length === 4 &&
					typeof identity[0] === 'string' &&
					typeof identity[1] === 'string' &&
					typeof identity[3] === 'string' &&
					identity[0] === chainId &&
					identity[1].toLowerCase() === address,
			)
			return {
				chainId: Number(chainId),
				address: address ?? '',
				label: owner?.label ?? fixedIdentity?.[0] ?? catalogIdentity?.[2],
				kind: owner?.kind ?? fixedIdentity?.[1] ?? catalogIdentity?.[3],
			}
		}
		if (path.startsWith('/api/v1/richlist')) {
			demoRichListRequests++
			const request = new URL(path, location.origin)
			if (
				pageUrl.searchParams.get('richRouteRefreshDelayAfterLoad') === '1' &&
				demoRichListRequests > 1 &&
				Number(request.searchParams.get('offset') ?? 0) === 0
			) {
				demoRouteRequestsInFlight++
				window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
				try {
					await new Promise((resolve) => setTimeout(resolve, 1_500))
				} finally {
					demoRouteRequestsInFlight--
					window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
				}
			}
			const richRefreshErrorRequest = Number(pageUrl.searchParams.get('routeRefreshErrorRequest'))
			if (
				((pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && demoRichListRequests > 1) ||
					(Number.isInteger(richRefreshErrorRequest) && richRefreshErrorRequest > 0 && demoRichListRequests === richRefreshErrorRequest)) &&
				!demoRouteRefreshErrorConsumed
			) {
				demoRouteRefreshErrorConsumed = true
				throw new Error('The newest account rankings could not be read')
			}
			if (demoReorgObserved && pageUrl.searchParams.get('canonicalRouteRefreshError') === '1' && !demoCanonicalRouteRefreshErrorConsumed) {
				demoCanonicalRouteRefreshErrorConsumed = true
				throw new Error('The account state could not be refreshed')
			}
			const chainId = request.searchParams.get('chainId')
			const address = request.searchParams.get('address')?.toLowerCase()
			const offset = Number(request.searchParams.get('offset') ?? 0)
			const limit = Number(request.searchParams.get('limit') ?? 50)
			if (pageUrl.searchParams.get('richAppendDelay') === '1' && offset > 0) await new Promise((resolve) => setTimeout(resolve, 1_500))
			const filtered = demoRichList.filter(
				(item) =>
					(!chainId || item.chain_id === chainId) &&
					(!address || item.address.toLowerCase() === address) &&
					!(demoReorgObserved && pageUrl.searchParams.get('evictAccountOnReorg') === '1' && item.address.toLowerCase() === demoEvictedAddress),
			)
			const ranked =
				pageUrl.searchParams.get('richPaginationDemo') === '1' && address === undefined && filtered.length > 0
					? Array.from({ length: 120 }, (_, index) => ({
							...requiredArrayItem(filtered, index % filtered.length, 'Demo rich-list pagination template'),
							address: `0x${BigInt(index + 1)
								.toString(16)
								.padStart(40, '0')}`,
						}))
					: filtered
			return { items: ranked.slice(offset, offset + limit), total: ranked.length, limit, offset }
		}
		if (path.startsWith('/api/v1/logs/') && path.split('/').length > 7) {
			if (detailState === 'error' && !demoDetailErrorConsumed) {
				demoDetailErrorConsumed = true
				throw new Error('The receipt could not be read from the RPC')
			}
			if (detailState === 'loading') return await new Promise(() => {})
			const [, , , , requestedChainId, , requestedTransactionHash, requestedLogIndex] = path.split('/')
			if (demoReorgObserved && pageUrl.searchParams.get('logRemovedOnReorg') === '1') {
				const error = new Error('The log was replaced after a chain update')
				error.status = 404
				throw error
			}
			const detailLog =
				demoLogs.find(
					(item) => item.chain_id === requestedChainId && item.tx_hash === requestedTransactionHash && item.log_index === Number(requestedLogIndex),
				) ?? requiredArrayItem(demoLogs, 0, 'Demo log detail')
			const detailNetwork = demoNetworks.find((network) => network.chain_id === detailLog.chain_id)
			return {
				...detailLog,
				block_timestamp: detailLog.block_timestamp,
				origin_address: '0x1A620F3dC4Dba34F365C9233C34A22f8F48D2D34',
				to_address: '0x7777777777777777777777777777777777777777',
				value: '0',
				input: '0x4f8b2f2d',
				gas_used: '184220',
				contract_provenance:
					pageUrl.searchParams.get('detailLiveDemo') === '1'
						? `Security Pool Factory.DeploySecurityPool · indexed block ${detailNetwork?.indexed_block}`
						: 'Security Pool Factory.DeploySecurityPool',
				explorer_base_url: detailNetwork?.id === 'sepolia' ? 'https://sepolia.etherscan.io' : 'https://etherscan.io',
				action_arguments: {
					reason: '1',
					route: ['0xc9b36e44643fc5d882654ffd9791ae7171b0e9db', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
				},
				action_display_arguments: {
					reason: 'Trade',
					route: ['OpenOracle (0xc9b36e44643fc5d882654ffd9791ae7171b0e9db)', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'],
				},
				action_argument_schema: [
					{ index: 0, name: 'reason', type: 'uint8' },
					{ index: 1, name: 'route', type: 'address[]' },
				],
				receipt: {
					transactionHash: detailLog.tx_hash,
					blockHash: detailLog.block_hash,
					blockNumber: detailLog.block_number,
					status: 'success',
					gasUsed: '184220',
					logs: demoLogs.slice(0, 4).map(({ emitter_address: address, topics, data, log_index: logIndex }) => ({ address, topics, data, logIndex })),
				},
				event_signature: 'event PoolAccountingCheckpoint(address indexed securityPool, uint256 totalRepBackingUnits)',
				function_signature: 'checkpoint(uint8,address[])',
				action_summary: 'checkpoint(reason=Trade)',
				relatedLogs: demoLogs.slice(0, 4),
			}
		}
		if (path.startsWith('/api/v1/logs')) {
			demoLogRequests++
			const activityRefreshErrorRequest = Number(pageUrl.searchParams.get('routeRefreshErrorRequest'))
			if (
				((pageUrl.searchParams.get('routeRefreshErrorAfterLoad') === '1' && demoLogRequests > 1) ||
					(Number.isInteger(activityRefreshErrorRequest) && activityRefreshErrorRequest > 0 && demoLogRequests === activityRefreshErrorRequest)) &&
				!demoRouteRefreshErrorConsumed
			) {
				demoRouteRefreshErrorConsumed = true
				throw new Error('The newest activity could not be read')
			}
			if (pageUrl.searchParams.get('networkFallbackRouteError') === '1' && selectedChainId() !== '1' && !demoNetworkFallbackErrorConsumed) {
				demoNetworkFallbackErrorConsumed = true
				throw new Error('Activity could not be loaded for the fallback network')
			}
			if (pageUrl.searchParams.get('reorgRefreshError') === '1' && demoLogRequests > 1 && !demoReorgRefreshErrorConsumed) {
				demoReorgRefreshErrorConsumed = true
				throw new Error('Activity could not be refreshed after the chain changed')
			}
			if (demoState === 'error' && !demoErrorConsumed) {
				demoErrorConsumed = true
				throw new Error('RPC history is temporarily unavailable')
			}
			if (demoState === 'loading') return await new Promise(() => {})
			if (demoState === 'delayed-logs') {
				demoRouteRequestsInFlight++
				demoMaxRouteRequestsInFlight = Math.max(demoMaxRouteRequestsInFlight, demoRouteRequestsInFlight)
				window.__demoMaxRouteRequestsInFlight = demoMaxRouteRequestsInFlight
				window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
				try {
					await new Promise((resolve) => setTimeout(resolve, 800))
				} finally {
					demoRouteRequestsInFlight--
					window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
				}
			}
			const request = new URL(path, location.origin)
			if (pageUrl.searchParams.get('logRouteRefreshDelayAfterLoad') === '1' && demoLogRequests > 1 && !request.searchParams.has('cursor')) {
				demoRouteRequestsInFlight++
				window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
				try {
					await new Promise((resolve) => setTimeout(resolve, 1_500))
				} finally {
					demoRouteRequestsInFlight--
					window.__demoRouteRequestsInFlight = demoRouteRequestsInFlight
				}
			}
			const chainId = request.searchParams.get('chainId')
			const event = request.searchParams.get('event')?.toLowerCase()
			const address = request.searchParams.get('address')?.toLowerCase()
			if (pageUrl.searchParams.get('logAppendDelay') === '1' && request.searchParams.has('cursor')) await new Promise((resolve) => setTimeout(resolve, 3_500))
			if (address && !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('Address filter is invalid')
			const filtered =
				demoState === 'empty'
					? []
					: demoLogs.filter(
							(item) =>
								(!chainId || item.chain_id === chainId) &&
								(event === undefined || item.event_name?.toLowerCase().includes(event) === true) &&
								(!address || [item.emitter_address, item.origin_address].some((candidate) => candidate?.toLowerCase() === address)),
						)
			if (pageUrl.searchParams.get('logPaginationDemo') !== '1' || filtered.length === 0) return { items: filtered }
			const expanded = Array.from({ length: 220 }, (_, index) => {
				const ordinal = demoReorgObserved ? (index === 0 ? 10_000 : index - 1) : index
				const template = requiredArrayItem(filtered, ordinal % filtered.length, 'Demo activity pagination template')
				return {
					...template,
					block_number: String(23_184_711 - Math.min(ordinal, 219)),
					block_hash: `0x${BigInt(50_000 + ordinal)
						.toString(16)
						.padStart(64, '0')}`,
					tx_hash: `0x${BigInt(100_000 + ordinal)
						.toString(16)
						.padStart(64, '0')}`,
					log_index: ordinal,
					summary: ordinal === 10_000 ? 'Canonical replacement after chain reorganization' : template.summary,
				}
			})
			const encodedCursor = request.searchParams.get('cursor')
			const offset = encodedCursor === null ? 0 : Number(JSON.parse(atob(encodedCursor)))
			const limit = Number(request.searchParams.get('limit') ?? 100)
			const nextOffset = offset + limit
			return { items: expanded.slice(offset, nextOffset), nextCursor: nextOffset < expanded.length ? btoa(JSON.stringify(nextOffset)) : undefined }
		}
	}
	const timeout = AbortSignal.timeout(15_000)
	const response = await fetch(path, { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) })
	const payload: unknown = await response.json().catch(() => ({}))
	if (!response.ok) {
		const message = isRecord(payload) && typeof payload['error'] === 'string' ? payload['error'] : `Request failed (${response.status})`
		const error = new Error(message)
		error.status = response.status
		throw error
	}
	return payload
}

const renderNetworks = (networks: NetworkRecord[]) => {
	const previouslySelectedNetwork = latestNetworks.find((network) => String(network.chain_id) === selectedChainId())
	let selectedReorgAdvanced = false
	for (const network of networks) {
		const previous = latestNetworks.find((item) => String(item.chain_id) === String(network.chain_id))
		const reorgAdvanced = previous && network.last_reorg_at && previous.last_reorg_at !== network.last_reorg_at
		if (reorgAdvanced) {
			invalidateAddressIdentityCache(network.chain_id)
			if (String(network.chain_id) === selectedChainId()) selectedReorgAdvanced = true
		} else if (previous && previous.indexed_hash !== network.indexed_hash) invalidateAddressIdentityCache(network.chain_id, true)
	}
	latestNetworks = networks
	const selectedNetwork = networks.find((item) => String(item.chain_id) === selectedChainId())
	const currentTime = Date.now() + serverClockOffsetMs
	const selectedHeadFreshness = selectedNetwork === undefined ? undefined : indexerHeadFreshness(selectedNetwork, currentTime)
	const renderedNetworkCard = networkCards.querySelector<HTMLElement>('.network-card[data-live-key]')
	if (selectedReorgAdvanced && activeReorgRecovery !== undefined) activeReorgRecovery.pendingRefresh = true
	else if (selectedReorgAdvanced && polledReorgRefreshTimer === undefined) {
		const chainId = selectedChainId()
		polledReorgRefreshTimer = window.setTimeout(() => {
			polledReorgRefreshTimer = undefined
			if (selectedChainId() === chainId && activeReorgRecovery === undefined)
				void refreshCanonicalViews('Canonical history reset detected', 'Address identities and views are refreshing from the latest indexed generation.')
		}, 0)
	}
	if (
		previouslySelectedNetwork !== undefined &&
		selectedNetwork !== undefined &&
		selectedHeadFreshness !== undefined &&
		canReuseNetworkStatusPresentation(
			previouslySelectedNetwork,
			selectedNetwork,
			renderedNetworkCard?.dataset.liveKey,
			renderedNetworkCard?.dataset.headFreshness,
			String(selectedNetwork.chain_id),
			selectedHeadFreshness.stale ? 'stale' : 'current',
		)
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
		card.dataset.headFreshness = headFreshness.stale ? 'stale' : 'current'
		const title = element('div', 'network-title')
		const badge = element('span', 'badge', headFreshness.stale ? 'stale head' : network.phase)
		title.append(badge)
		const block = element(
			network.indexed_block && network.explorer_base_url ? 'a' : 'p',
			'block-number',
			network.indexed_block ? `#${number(network.indexed_block)}` : 'Awaiting first block',
		)
		if (block instanceof HTMLAnchorElement) {
			block.href = `${String(network.explorer_base_url).replace(/\/$/, '')}/block/${network.indexed_block}`
			block.target = '_blank'
			block.rel = 'noreferrer'
			block.title = `Open block ${network.indexed_block} in the network explorer`
		}
		const meta = element('div', 'block-meta')
		const indexedTime = element(
			'time',
			'',
			network.indexed_timestamp ? `${exactTimestamp(network.indexed_timestamp).slice(0, 10)} · ${time(network.indexed_timestamp)} UTC` : 'No timestamp',
		)
		if (network.indexed_timestamp) indexedTime.dateTime = exactTimestamp(network.indexed_timestamp)
		indexedTime.title = exactTimestamp(network.indexed_timestamp)
		const ageNode = element('span', 'age', age(network.indexed_timestamp))
		ageNode.dataset.time = network.indexed_timestamp ?? ''
		ageNode.title = exactTimestamp(network.indexed_timestamp)
		const lag = indexerLagLabel(network)
		const displaySyncDetails = showIndexerSyncDetails(network, currentTime)
		meta.append(indexedTime, ageNode)
		if (displaySyncDetails) meta.append(element('span', '', lag))
		const progressLabel = headFreshness.stale
			? `${progress.percentage ?? '100.00'}% indexed · RPC head ${age(network.indexed_timestamp).replace(/ ago$/, '')} old (limit 1m)`
			: progress.percentage === undefined
				? progress.eta
				: `${progress.percentage}% complete · ${progress.eta}`
		card.append(title, block, meta)
		if (displaySyncDetails) card.append(element('p', 'network-progress', progressLabel))
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
	networkCards.setAttribute('aria-busy', 'false')
	updateConnectionStatus()
}

const updateFreshness = () => {
	if (activeReorgRecovery !== undefined) return
	const retryCanonical = $('#refresh-stale')
	if (canonicalRefreshRequired) {
		const banner = $('#freshness-banner')
		banner.hidden = false
		retryCanonical.hidden = false
		$('#freshness-title').textContent = 'Chain update refresh incomplete'
		$('#freshness-detail').textContent = 'A chain update was recorded, but the content refresh failed. Retry before debugging current state.'
		return
	}
	if (lastNetworkRequestFailed) {
		$('#freshness-banner').hidden = true
		retryCanonical.hidden = true
		return
	}
	const staleHead = latestNetworks
		.filter((network) => String(network.chain_id) === selectedChainId())
		.find((network) => indexerHeadFreshness(network, Date.now() + serverClockOffsetMs).stale)
	if (staleHead !== undefined) {
		const banner = $('#freshness-banner')
		banner.hidden = false
		retryCanonical.hidden = true
		$('#freshness-title').textContent = 'RPC chain head is stale'
		$('#freshness-detail').textContent = `Newest observed block is ${age(staleHead.indexed_timestamp)}; block-based catch-up status may be misleading.`
		return
	}
	const stale = latestNetworks
		.filter((network) => String(network.chain_id) === selectedChainId())
		.filter(
			(network) => !network.last_success_at || Date.now() + serverClockOffsetMs - new Date(network.last_success_at).getTime() > networkFreshnessThresholdMs,
		)
	const banner = $('#freshness-banner')
	retryCanonical.hidden = true
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
		accountMore.hidden =
			activeAccountTransactions.nextPageCursor === undefined || (activeAccountTransactions.pageError !== undefined && activeAccountTransactions.pageErrorAppend)
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
type PagedOperationsCatalogSection = 'auctions' | 'escalations' | 'forks' | 'integrity' | 'reports' | 'timeline' | 'trading'
type OperationsCatalogSection = PagedOperationsCatalogSection | 'risk'
const operationsCatalogSection = (): OperationsCatalogSection | undefined => {
	const section = location.pathname.split('/')[2]
	return section === 'reports' ||
		section === 'escalations' ||
		section === 'auctions' ||
		section === 'forks' ||
		section === 'trading' ||
		section === 'timeline' ||
		section === 'integrity' ||
		section === 'risk'
		? section
		: undefined
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

const catalogOperationsResponse = (
	response: OperationsResponse,
	section: PagedOperationsCatalogSection,
	items: readonly Record<string, unknown>[],
): OperationsResponse => ({ ...response, data: { ...response.data, [section]: items, _catalogPage: response.data } })

const riskCatalogOperationsResponse = (
	response: OperationsResponse,
	pools: readonly Record<string, unknown>[],
	vaults: readonly Record<string, unknown>[],
): OperationsResponse => ({
	...response,
	data: {
		risk: { ...response.data, pools, vaults },
		_riskCatalogPage: response.data,
		totals: {
			pools: isRecord(response.data['pagination']) ? response.data['pagination']['poolTotal'] : pools.length,
			vaults: isRecord(response.data['pagination']) ? response.data['pagination']['vaultTotal'] : vaults.length,
		},
	},
})

const approvalTransitionSummary = (item: Readonly<Record<string, unknown>>): string => {
	const eventData = isRecord(item['event_data']) ? item['event_data'] : {}
	const receiver = String(item['receiver_vault'] ?? eventData['receiverVault'] ?? '')
	const operation = typeof eventData['operationId'] === 'string' ? `operation ${shortIdentifier(eventData['operationId'])}` : undefined
	const fields = approvalTransitionFields(eventData).map(
		(field) => `${field.label} ${operationNumber(field.value)}${field.unit === '' ? '' : ` ${field.unit}`}`,
	)
	const details = [operation, ...fields, receiver === '' ? undefined : `receiver ${shortIdentifier(receiver, 10, 6)}`].filter(
		(value): value is string => value !== undefined,
	)
	return details.length === 0 ? 'Authorization lifecycle transition' : details.join(' · ')
}

type OperationsRenderContext = {
	readonly focusHref?: string
	readonly focusLoadMore: boolean
	readonly focusDetailCollection?: 'decisions' | 'evidence'
	readonly focusRiskKind?: 'pool' | 'vault'
	readonly focusHistoryMore: boolean
	readonly focusViewportTop?: number
	readonly scrollY: number
}

const captureOperationsRenderContext = (): OperationsRenderContext => {
	const content = $('#operations-content')
	const active = document.activeElement
	return {
		...(active instanceof HTMLAnchorElement && content.contains(active) ? { focusHref: active.href } : {}),
		focusLoadMore:
			active instanceof HTMLElement &&
			(active.classList.contains('operations-catalog-more') ||
				active.classList.contains('operations-detail-more') ||
				active.classList.contains('operations-pagination-complete')),
		...(active instanceof HTMLElement && (active.dataset['detailCollection'] === 'decisions' || active.dataset['detailCollection'] === 'evidence')
			? { focusDetailCollection: active.dataset['detailCollection'] }
			: {}),
		...(active instanceof HTMLElement && (active.dataset['riskKind'] === 'pool' || active.dataset['riskKind'] === 'vault')
			? { focusRiskKind: active.dataset['riskKind'] }
			: {}),
		focusHistoryMore:
			active instanceof HTMLElement && (active.classList.contains('operations-history-more') || active.classList.contains('operations-history-complete')),
		...(active instanceof HTMLElement && content.contains(active) ? { focusViewportTop: active.getBoundingClientRect().top } : {}),
		scrollY: window.scrollY,
	}
}

const restoreOperationsRenderContext = (snapshot: OperationsRenderContext) => {
	const content = $('#operations-content')
	const continuation =
		snapshot.focusDetailCollection === undefined
			? content.querySelector<HTMLButtonElement>('.operations-catalog-more, .operations-detail-more')
			: content.querySelector<HTMLButtonElement>(`[data-detail-collection="${snapshot.focusDetailCollection}"]`)
	const completion = content.querySelector<HTMLElement>('.operations-pagination-complete')
	const historyContinuation = content.querySelector<HTMLButtonElement>('.operations-history-more')
	const historyCompletion = content.querySelector<HTMLElement>('.operations-history-complete')
	const catalogRows = [...content.querySelectorAll<HTMLAnchorElement>('a.operations-row')]
	const riskTarget = snapshot.focusRiskKind === undefined ? undefined : content.querySelector<HTMLElement>(`[data-risk-kind="${snapshot.focusRiskKind}"]`)
	const target =
		riskTarget ??
		(snapshot.focusHref === undefined
			? snapshot.focusHistoryMore
				? (historyContinuation ?? historyCompletion)
				: snapshot.focusLoadMore
					? (continuation ?? completion ?? catalogRows.at(-1))
					: undefined
			: catalogRows.find((candidate) => candidate.href === snapshot.focusHref))
	window.scrollTo({ top: snapshot.scrollY, behavior: 'auto' })
	if (target === undefined || target === null) return
	target.focus({ preventScroll: true })
	if (snapshot.focusViewportTop !== undefined) {
		window.scrollBy({ top: target.getBoundingClientRect().top - snapshot.focusViewportTop, behavior: 'auto' })
		target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	}
}
const operationNumber = (value: unknown): string =>
	typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? number(value) : number(undefined)
const operationCounted = (value: unknown, singular: string, plural?: string): string =>
	typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? counted(value, singular, plural) : counted(undefined, singular, plural)
const operationRatio = (numerator: unknown, denominator: unknown, maximumFraction = 4): string => {
	if (typeof numerator !== 'string' || typeof denominator !== 'string' || !/^\d+$/.test(numerator) || !/^\d+$/.test(denominator) || denominator === '0')
		return 'Unavailable'
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
		evidence.append(element('small', '', `Indexed #${number(block)}`))
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
	input.placeholder = 'Latest indexed block'
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
	const selectedNetwork = latestNetworks.find((network) => String(network.chain_id) === requiredChainId())
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
		operationCard(
			'Indexed head',
			`#${number(typeof asOf['blockNumber'] === 'string' ? asOf['blockNumber'] : undefined)}`,
			shortIdentifier(String(asOf['blockHash'] ?? 'Unavailable')),
		),
		operationCard('Observed head', `#${number(typeof asOf['observedHead'] === 'string' ? asOf['observedHead'] : undefined)}`),
		operationCard('Block lag', number(typeof asOf['lagBlocks'] === 'string' ? asOf['lagBlocks'] : undefined), String(asOf['phase'] ?? 'Unavailable')),
		operationCard(
			'Indexed timestamp',
			asOf['blockTimestamp'] === undefined ? 'Unavailable' : exactTimestamp(Number(asOf['blockTimestamp']) * 1_000).replace('.000Z', 'Z'),
		),
	)
	const metrics = element('div', 'operations-metrics')
	metrics.append(
		operationCard(
			'OpenOracle reports',
			operationNumber(totals['reports'] ?? reports.length),
			counted(reports.filter((item) => isRecord(item['lifecycle']) && item['lifecycle']['state'] === 'Settleable').length, 'settleable'),
		),
		operationCard('Escalation games', operationNumber(totals['escalations'] ?? escalations.length), 'Canonical event projections'),
		operationCard(
			'Truth auctions',
			operationNumber(totals['auctions'] ?? auctions.length),
			counted(auctions.filter((item) => item['status'] === 'Open').length, 'open'),
		),
		operationCard(
			'Pool / vault snapshots',
			`${operationNumber(totals['pools'] ?? pools.length)} / ${operationNumber(totals['vaults'] ?? vaults.length)}`,
			'Latest canonical accounting',
		),
	)
	const reportRows = reports.map((item) => {
		const lifecycle = isRecord(item['lifecycle']) ? item['lifecycle'] : {}
		const reportData = isRecord(item['report_data']) ? item['report_data'] : {}
		return operationRow(
			`Report ${String(item['report_id'] ?? '—')}`,
			`${String(lifecycle['state'] ?? 'Awaiting indexed evidence')} · ${operationCounted(item['observed_rounds'], 'round')} · ${String(reportData['token1'] ?? 'token 1')} / ${String(reportData['token2'] ?? 'token 2')}`,
			`${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`,
			item['block_number'],
			operationsHref(
				`/operations/report/${encodeURIComponent(String(item['open_oracle_address'] ?? ''))}/${encodeURIComponent(String(item['report_id'] ?? ''))}`,
			),
		)
	})
	const escalationRows = escalations.map((item) =>
		operationRow(
			'Escalation game',
			`${String(item['event_name'] ?? 'Active')} · INVALID ${operationNumber(item['invalid_stake_atto_rep'])} · NO ${operationNumber(item['no_stake_atto_rep'])} · YES ${operationNumber(item['yes_stake_atto_rep'])} attoREP`,
			String(item['game_address'] ?? ''),
			item['block_number'],
			operationsHref(`/operations/escalation/${encodeURIComponent(String(item['game_address'] ?? ''))}`),
		),
	)
	const auctionRows = auctions.map((item) =>
		operationRow(
			'Truth auction',
			`${String(item['status'] ?? 'Awaiting indexed evidence')} · ${operationCounted(item['bid_count'], 'bid')} · ${operationCounted(item['bidder_count'], 'bidder')}`,
			String(item['auction_address'] ?? ''),
			item['block_number'],
			operationsHref(`/operations/auction/${encodeURIComponent(String(item['auction_address'] ?? ''))}`),
		),
	)
	const poolRiskRows = pools.map((item) => {
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
	const vaultRiskRows = vaults.map((item) => {
		const itemRisk = isRecord(item['risk']) ? item['risk'] : {}
		const riskPresentation = operationsRiskPresentation('vault', item['protocol_state'], item['scanner_severity'])
		return operationRow(
			'Vault position',
			`${riskPresentation.scannerAssessment} · health ${operationNumber(itemRisk['healthFactorBps'])} bps · ${String(item['scanner_reason'] ?? '')}`,
			String(item['vault_address'] ?? ''),
			item['block_number'],
			operationsHref(
				`/operations/risk/vault/${encodeURIComponent(String(item['pool_address'] ?? ''))}/${encodeURIComponent(String(item['vault_address'] ?? ''))}`,
			),
		)
	})
	const riskRows = [...poolRiskRows, ...vaultRiskRows]
	const approvalRows = approvals.map((item) =>
		operationRow(
			String(item['event_name'] ?? 'Liquidation approval'),
			approvalTransitionSummary(item),
			String(item['approval_identity'] ?? item['receiver_vault'] ?? ''),
			item['block_number'],
		),
	)
	const liquidationRows = recentLiquidations.map((item) =>
		operationRow(
			'Vault liquidation',
			'Canonical liquidation route and resulting debt evidence',
			String(item['entity_identity'] ?? item['source_contract'] ?? ''),
			item['block_number'],
		),
	)
	const tradingRows = trading.map((item) =>
		operationRow(
			String(item['question_title'] ?? 'Augur AMM market'),
			`${item['conditional_yes_bps'] === null || item['conditional_yes_bps'] === undefined ? 'No reserve price' : `${exactUnit(String(item['conditional_yes_bps']), 2, '%', 2)} YES`} · ${operationCounted(item['swap_count'], 'swap')} · ${operationCounted(item['lp_holder_count'], 'LP participant')}`,
			String(item['pair_address'] ?? ''),
			item['price_block_number'],
			operationsHref(`/operations/trading/${encodeURIComponent(String(item['pair_address'] ?? ''))}`),
		),
	)
	const timelineRows = timeline.map((item) => {
		const rawEvidenceStatus = item['evidence_status'] ?? (item['canonical'] === false ? 'noncanonical' : 'canonical')
		const invalidation = item['invalidation_reason'] === undefined ? '' : ` · ${historyInvalidationReasonLabel(item['invalidation_reason'])}`
		return exactEvidenceRow(
			String(item['semantic_event_kind'] ?? 'Protocol transition'),
			`${timelineEntityTypeLabel(item['entity_type'])} · ${evidenceStatusLabel(rawEvidenceStatus)}${invalidation}`,
			[...timelineOccurrenceFields(item), ['Evidence status code', rawEvidenceStatus], ['Invalidation reason code', item['invalidation_reason']]],
		)
	})
	const integrityRows = integrity.map((item) => {
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
	const forkRows = forks.map((item) =>
		operationRow(
			`Universe ${String(item['universe_identity'] ?? '—')} fork`,
			`${operationsForkChildCount(operationNumber(item['child_count']), item['child_count'])} · ${operationCounted(item['migrator_count'], 'migrator')} · ${exactUnit(String(item['migrated_atto_rep'] ?? '0'), 18, 'REP', 3)} migrated · ${operationCounted(item['obligation_events'], 'escalation obligation')}`,
			undefined,
			item['block_number'],
			operationsHref(`/operations/fork/${encodeURIComponent(String(item['universe_identity'] ?? ''))}`),
		),
	)
	const changeRows = changes.map((item) =>
		operationRow(
			String(item['semantic_event_kind'] ?? 'Protocol transition'),
			'Canonical semantic evidence',
			String(item['entity_identity'] ?? ''),
			item['block_number'],
		),
	)
	const priceRows = prices.map((item) =>
		operationRow(
			'Coordinator REP / ETH',
			`${operationNumber(item['value'])} scaled 1e18 · ${String(item['source_event'] ?? 'Unavailable')}`,
			String(item['source_contract'] ?? ''),
			item['block_number'],
		),
	)
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
		if (['Open', 'Awaiting finalization', 'Bid settlements outstanding'].includes(String(item['status'] ?? '')) && row !== undefined)
			activeAuctionRows.push(row)
	}
	const riskPoolPanel = operationsPanel('Pool risk evidence', poolRiskRows, 'No canonical pool accounting snapshots have been indexed.', {
		label: `${operationCounted(pools.length, 'pool')} shown · ${operationCounted(riskPagination['poolTotal'], 'pool')} indexed total`,
	})
	const riskVaultPanel = operationsPanel('Vault risk evidence', vaultRiskRows, 'No canonical vault accounting snapshots have been indexed.', {
		label: `${operationCounted(vaults.length, 'vault')} shown · ${operationCounted(riskPagination['vaultTotal'], 'vault')} indexed total`,
	})
	const panels =
		selected === 'reports'
			? [operationsPanel('OpenOracle reports', reportRows, 'No canonical report evidence has been indexed.')]
			: selected === 'escalations'
				? [operationsPanel('Escalation games', escalationRows, 'No canonical escalation evidence has been indexed.')]
				: selected === 'auctions'
					? [operationsPanel('Truth auctions', auctionRows, 'No canonical auction evidence has been indexed.')]
					: selected === 'risk'
						? [
								riskPoolPanel,
								riskVaultPanel,
								operationsPanel('Liquidation approval lifecycle', approvalRows, 'No liquidation approval evidence has been indexed.'),
								operationsPanel('Recent liquidations', liquidationRows, 'No vault liquidations have been indexed.'),
							]
						: selected === 'trading'
							? [operationsPanel('Augur AMM markets', tradingRows, 'No Augur AMM markets have been indexed.')]
							: selected === 'timeline'
								? [
										operationsPanel('Cross-protocol historical timeline', timelineRows, 'No semantic evidence matches these filters.', {
											label: `${operationCounted(selectedCatalogPage?.['total'], 'matching transition')} · canonical status and invalidation provenance included`,
										}),
									]
								: selected === 'forks'
									? [
											operationsPanel('Zoltar forks and migration progress', forkRows, 'No universe forks have been indexed.', {
												label: `${operationCounted(forkRows.length, 'fork')} shown · ${operationCounted(selectedCatalogPage?.['total'], 'fork')} indexed total`,
											}),
										]
									: selected === 'integrity'
										? [
												operationsPanel('Selected-chain replacements', integrityRows, 'No chain reorganizations have been recorded.', {
													label: selectedNetworkScope,
												}),
												operationsPanel(
													'Scanner-wide schema migration history',
													operationRecords(data['migrations']).map((item) =>
														exactEvidenceRow(`Schema ${String(item['schema_version'] ?? '')}`, String(item['description'] ?? ''), [
															['Applied at', item['applied_at']],
														]),
													),
													'No migration records are available.',
													{ label: 'Scanner-wide · all configured networks', scannerWide: true },
												),
												operationsPanel(
													'Scanner-wide indexer provenance',
													operationRecords(data['runs']).map((item) =>
														exactEvidenceRow(
															`augurScan ${String(item['app_version'] ?? '')}`,
															`Schema ${String(item['schema_version'] ?? '')} · process run ${String(item['id'] ?? 'not recorded')}`,
															[
																['ABI source hash', item['abi_source_hash']],
																['Application source hash', item['application_source_hash']],
																['Projection source hash', item['projection_source_hash']],
																['Indexer enabled', item['indexer_enabled']],
																['Started at', item['started_at']],
																['Stopped at', item['stopped_at']],
															],
														),
													),
													'No indexer-run provenance is available.',
													{ label: 'Scanner-wide · latest 25 process runs across all networks', scannerWide: true },
												),
												operationsPanel(
													'Selected-chain historical exports',
													[
														operationRow(
															'Export semantic timeline',
															'Snapshot-bound canonical NDJSON with exact event data; response headers identify an opaque continuation cursor.',
															undefined,
															undefined,
															operationsHref('/api/v1/export?dataset=timeline&canonical=canonical&limit=50000'),
														),
														operationRow(
															'Export canonical and orphan logs',
															'Occurrence-level NDJSON including decoded arguments and canonical flags.',
															undefined,
															undefined,
															operationsHref('/api/v1/export?dataset=logs&canonical=all&limit=50000'),
														),
													],
													'',
													{ label: selectedNetworkScope },
												),
											]
										: [
												operationsPanel('Needs attention · reports', attentionReportRows.slice(0, 5), 'No reports need attention.'),
												operationsPanel('Active escalations', activeEscalationRows, 'No escalation games are active.'),
												operationsPanel('Active auctions', activeAuctionRows, 'No auctions are active.'),
												operationsPanel('Pool and vault risk', riskRows, 'No risk snapshots are available.'),
												operationsPanel('Fork and migration progress', forkRows, 'No fork or migration evidence has been indexed.'),
												operationsPanel('Price provenance', priceRows, 'No accepted coordinator price is available.'),
												operationsPanel('Recent semantic changes', changeRows, 'No semantic changes have been indexed.'),
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
				const complete = element('p', 'activity-summary operations-pagination-complete', `All indexed ${kind} records are shown.`)
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
	if (catalogPage !== undefined && catalogSection !== undefined && catalogSection !== 'risk')
		operationsCatalogState = { chainId: requiredChainId(), section: catalogSection, items: operationsCatalogRecords(catalogSection, data[catalogSection]) }
	if (catalogPage?.['hasMore'] === true && typeof catalogPage['nextCursor'] === 'string' && selected !== 'overview') {
		const loadMore = document.createElement('button')
		loadMore.type = 'button'
		loadMore.className = 'secondary operations-catalog-more'
		loadMore.textContent = 'Show more indexed records'
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
		const completeStatus = element('p', 'activity-summary', 'All indexed records are shown.')
		completeStatus.setAttribute('role', 'status')
		completeStatus.setAttribute('aria-live', 'polite')
		grid.append(completeStatus)
	}
	if (selected === 'overview') content.replaceChildren(...(historical ? [freshness] : []), metrics, grid)
	else {
		content.replaceChildren(
			...(asOf['historical'] === true || asOf['phase'] === 'historical'
				? [element('p', 'operations-route-freshness', operationsRouteFreshness(asOf, connection.classList.contains('live')))]
				: []),
			...(selected === 'timeline' ? [operationsTimelineFilters()] : selected === 'risk' ? [operationsRiskSnapshotFilter()] : []),
			grid,
		)
	}
	content.setAttribute('aria-busy', 'false')
	$('#operations-status').hidden = true
	restoreOperationsRenderContext(renderContext)
}

type OperationsDetailRoute = {
	readonly kind: 'auction' | 'escalation' | 'fork' | 'pool' | 'report' | 'trading' | 'vault'
	readonly identity: readonly string[]
}

const operationsDetailRoute = (): OperationsDetailRoute | undefined => {
	const parts = location.pathname.split('/').filter(Boolean)
	if (parts[0] !== 'operations') return undefined
	const kind = parts[1]
	if (kind === 'report' && parts.length === 4) return { kind, identity: [decodeURIComponent(parts[2] ?? ''), decodeURIComponent(parts[3] ?? '')] }
	if ((kind === 'auction' || kind === 'escalation' || kind === 'fork') && parts.length === 3) return { kind, identity: [decodeURIComponent(parts[2] ?? '')] }
	if (kind === 'trading' && parts.length === 3) return { kind, identity: [decodeURIComponent(parts[2] ?? '')] }
	if (kind === 'risk' && parts[2] === 'pool' && parts.length === 4) return { kind: 'pool', identity: [decodeURIComponent(parts[3] ?? '')] }
	if (kind === 'risk' && parts[2] === 'vault' && parts.length === 5)
		return { kind: 'vault', identity: [decodeURIComponent(parts[3] ?? ''), decodeURIComponent(parts[4] ?? '')] }
	return undefined
}

const operationsDetailEndpoint = (route: OperationsDetailRoute, cursor?: string, limit = 100, decisionCursor?: string, decisionLimit = 100): string => {
	const chainId = encodeURIComponent(requiredChainId())
	const identity = route.identity.map(encodeURIComponent).join('/')
	const resource =
		route.kind === 'report'
			? 'reports'
			: route.kind === 'escalation'
				? 'escalations'
				: route.kind === 'auction'
					? 'auctions'
					: route.kind === 'pool'
						? 'risk/pools'
						: route.kind === 'vault'
							? 'risk/vaults'
							: route.kind === 'trading'
								? 'trading'
								: 'forks'
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
const operationsHistoryOffset = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

const rawEvidence = (value: unknown) => {
	const disclosure = document.createElement('details')
	disclosure.className = 'operations-raw-evidence'
	disclosure.append(element('summary', '', 'Raw chain evidence'))
	const raw = document.createElement('pre')
	raw.textContent = JSON.stringify(value, null, 2) ?? 'Unavailable'
	disclosure.append(raw)
	return disclosure
}

const detailEvidenceRows = (items: readonly Record<string, unknown>[]) =>
	items.map((item) => {
		const eventName = String(item['event_name'] ?? item['semantic_event_kind'] ?? 'Protocol evidence')
		const block = item['block_number']
		const row = operationRow(eventName, `Canonical event · log ${String(item['log_index'] ?? '—')}`, String(item['tx_hash'] ?? ''), block)
		row.append(rawEvidence(item))
		return row
	})

const tradingEvidenceRows = (items: readonly Record<string, unknown>[]) =>
	items.map((item) => {
		const eventName = String(item['event_name'] ?? 'AMM event')
		const data = isRecord(item['event_data']) ? item['event_data'] : {}
		const analytics = isRecord(item['analytics']) ? item['analytics'] : {}
		let summary = 'Canonical AMM lifecycle evidence'
		if (eventName === 'Swap')
			summary = `${String(analytics['direction'] ?? 'Swap')} · ${exactUnit(String(analytics['amountIn'] ?? '0'), 18, String(analytics['baseAsset'] ?? 'shares'), 4)} in → ${exactUnit(String(analytics['amountOut'] ?? '0'), 18, String(analytics['quoteAsset'] ?? 'shares'), 4)} out · ${exactUnit(String(analytics['feeAmount'] ?? '0'), 18, 'shares', 6)} fee${isRecord(analytics['priceImpact']) && analytics['priceImpact']['bps'] !== undefined ? ` · ${exactUnit(String(analytics['priceImpact']['bps']), 2, '%', 2)} impact` : ''}`
		else if (eventName === 'Sync')
			summary = `${exactUnit(String(data['yesReserve'] ?? '0'), 18, 'YES', 4)} · ${exactUnit(String(data['noReserve'] ?? '0'), 18, 'NO', 4)} reserves`
		else if (eventName === 'Transfer')
			summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares', 4)} · ${shortIdentifier(String(data['from'] ?? ''))} → ${shortIdentifier(String(data['to'] ?? ''))}`
		else if (eventName === 'Approval')
			summary = `${exactUnit(String(data['amount'] ?? '0'), 18, 'LP shares', 4)} · ${shortIdentifier(String(data['owner'] ?? ''))} approved ${shortIdentifier(String(data['spender'] ?? ''))}`
		else if (eventName.startsWith('Liquidity'))
			summary = `${exactUnit(String(data['yesAmount'] ?? '0'), 18, 'YES', 4)} · ${exactUnit(String(data['noAmount'] ?? '0'), 18, 'NO', 4)} · ${exactUnit(String(data['liquidity'] ?? '0'), 18, 'LP shares', 4)}`
		const row = operationRow(eventName, summary, String(data['provider'] ?? data['sender'] ?? item['tx_hash'] ?? ''), item['block_number'])
		row.append(rawEvidence(item))
		return row
	})

const reportEvidenceRows = (items: readonly Record<string, unknown>[]) =>
	items.map((item) => {
		const data = isRecord(item['report_data']) ? item['report_data'] : {}
		const token1 = String(data['token1'] ?? 'token 1')
		const token2 = String(data['token2'] ?? 'token 2')
		const values =
			data['currentAmount1'] === undefined && data['currentAmount2'] === undefined
				? 'No round amounts'
				: `${operationNumber(data['currentAmount1'])} ${shortIdentifier(token1)} · ${operationNumber(data['currentAmount2'])} ${shortIdentifier(token2)}`
		const comparison = isRecord(item['comparison']) ? item['comparison'] : {}
		const changes = operationRecords(comparison['changes'])
		const row = operationRow(
			`${String(item['event_name'] ?? 'Report round')} · round ${String(item['round_number'] ?? '—')}`,
			`${values} · reporter ${shortIdentifier(String(data['currentReporter'] ?? 'unknown'))}`,
			String(item['tx_hash'] ?? ''),
			item['block_number'],
		)
		const changeDetails = document.createElement('details')
		changeDetails.className = 'operations-round-changes'
		changeDetails.append(
			element(
				'summary',
				'',
				comparison['state'] === 'initial'
					? `Initial indexed values (${changes.length})`
					: `Changes from round ${String(comparison['previousRoundNumber'] ?? '—')} (${changes.length})`,
			),
		)
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

const detailPageRecord = (data: Record<string, unknown>, key: string): Record<string, unknown> => (isRecord(data[key]) ? data[key] : {})

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
	const title = element(
		'h2',
		'',
		route.kind === 'report'
			? `OpenOracle report ${route.identity[1]}`
			: `${route.kind[0]?.toUpperCase()}${route.kind.slice(1)} ${shortIdentifier(titleIdentity ?? '')}`,
	)
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
	summary.append(
		operationCard(summaryPresentation.label, summaryPresentation.value),
		operationCard('Evidence source', taggedEvidence ? 'Tagged contract read' : 'Canonical events'),
		operationCard('Entity identity', route.identity.join(' · ')),
	)

	const panels: HTMLElement[] = []
	let loadedRiskHistoryOffset = 0
	const decisionPage = route.kind === 'report' ? detailPageRecord(data, 'coordinatorDecisions') : {}
	const decisionItems = operationRecords(decisionPage['items'])
	const approvalEvents = operationRecords(data['approvalEvents']).sort(compareCanonicalEventPosition)
	if (approvalEvents.length > 0)
		panels.push(
			operationsPanel(
				'Liquidation approval lifecycle',
				approvalEvents.map((item) =>
					operationRow(
						String(item['event_name'] ?? 'Liquidation approval'),
						approvalTransitionSummary(item),
						String(item['approval_identity'] ?? ''),
						item['block_number'],
					),
				),
				'No approval transitions are related to this risk entity.',
			),
		)
	if (snapshot !== undefined)
		panels.push(
			operationsPanel(
				'Current-state snapshot',
				[
					operationRow('Tagged block read', String(snapshot['read_status']), String(snapshot['entity_identity'] ?? ''), snapshot['block_number']),
					rawEvidence(snapshot),
				],
				'Snapshot unavailable',
			),
		)
	if (current !== undefined)
		panels.push(
			operationsPanel(
				'Current report',
				[
					operationRow(
						String(lifecycle?.['state'] ?? current['event_name'] ?? 'Report'),
						'Latest canonical report evidence',
						route.identity.join(':'),
						current['block_number'],
					),
					rawEvidence(current),
				],
				'Current report unavailable',
			),
		)
	if (route.kind === 'pool' || route.kind === 'vault') {
		const riskPresentation = operationsRiskPresentation(route.kind, data['protocol_state'], data['scanner_severity'])
		const protocolStateRow = operationRow('Protocol state', riskPresentation.protocolState, route.identity.join(':'), data['block_number'])
		protocolStateRow.classList.add('operations-risk-protocol')
		const scannerAssessmentRow = operationRow(
			'Scanner assessment',
			`${riskPresentation.scannerAssessment} · ${String(data['scanner_reason'] ?? 'Current-state evidence unavailable')}`,
			undefined,
			data['block_number'],
		)
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
					operationRow(
						'24-hour activity',
						`${operationCounted(tradingSummary['swaps_24h'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_24h'] ?? '0'), 18, 'input shares', 4)} · ${exactUnit(String(tradingSummary['fees_24h'] ?? '0'), 18, 'fee shares', 6)}`,
						route.identity[0] ?? '',
						undefined,
					),
					operationRow(
						'Seven-day activity',
						`${operationCounted(tradingSummary['swaps_7d'], 'swap')} · ${exactUnit(String(tradingSummary['input_volume_7d'] ?? '0'), 18, 'input shares', 4)} · ${exactUnit(String(tradingSummary['fees_7d'] ?? '0'), 18, 'fee shares', 6)}`,
						route.identity[0] ?? '',
						undefined,
					),
					operationRow(
						'24-hour TWAP',
						`${String(twap24h['state'] ?? 'Unavailable')} · ${operationRatio(twap24h['numerator'], twap24h['denominator'])} NO per YES · ${operationNumber(twap24h['coverageSeconds'])} covered seconds`,
						'NO per YES',
						undefined,
					),
					operationRow(
						'Seven-day TWAP',
						`${String(twap7d['state'] ?? 'Unavailable')} · ${operationRatio(twap7d['numerator'], twap7d['denominator'])} NO per YES · ${operationNumber(twap7d['coverageSeconds'])} covered seconds`,
						'NO per YES',
						undefined,
					),
				],
				'No trading observations are available.',
			),
		)
		const lpPositions = operationRecords(data['lpPositions'])
		panels.push(
			operationsPanel(
				'Current LP-share ownership',
				lpPositions.map((position) =>
					operationRow(
						'LP holder',
						`${exactUnit(String(position['balance'] ?? '0'), 18, 'LP shares', 5)} current · ${exactUnit(String(position['received_liquidity'] ?? '0'), 18, '', 5)} received · ${exactUnit(String(position['sent_liquidity'] ?? '0'), 18, '', 5)} sent`,
						String(position['address'] ?? ''),
						undefined,
					),
				),
				'No LP-share ownership evidence has been indexed. Transfer history begins when this scanner started indexing the pair.',
			),
		)
		const candles = operationRecords(data['candles'])
		panels.push(
			operationsPanel(
				'Hourly NO-per-YES candles',
				candles.map((candle) => {
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
			decisionItems.map((decision) => {
				const argumentsValue = isRecord(decision['arguments']) ? decision['arguments'] : {}
				return operationRow(
					String(decision['event_name'] ?? 'Coordinator decision'),
					String(argumentsValue['reason'] ?? decision['summary'] ?? 'Linked coordinator evidence'),
					String(decision['emitter_address'] ?? ''),
					decision['block_number'],
				)
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
			const completeStatus = element('p', 'activity-summary operations-pagination-complete', 'All indexed coordinator decisions are shown.')
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
		const historyCollections = Object.fromEntries(operationsRiskHistoryKeys.map((key) => [key, operationRecords(history[key])]))
		for (const [key, label] of [
			['stateSnapshots', 'Tagged risk history'],
			['accountingSnapshots', 'Accounting checkpoint history'],
			['lifecycleEvents', 'Risk lifecycle events'],
			['liquidations', 'Liquidation history'],
		] as const) {
			const records = historyCollections[key] ?? []
			panels.push(operationsPanel(label, detailEvidenceRows(records), `No ${label.toLowerCase()} has been indexed.`))
		}
		const historySummary = summarizeHistoryCollections(historyCollections, operationsRiskHistoryKeys)
		const historyBlockRange =
			historySummary.oldestBlock === undefined || historySummary.newestBlock === undefined
				? 'No block-numbered evidence is loaded'
				: historySummary.oldestBlock === historySummary.newestBlock
					? `Loaded block #${historySummary.oldestBlock.toLocaleString('en-US')}`
					: `Loaded blocks #${historySummary.oldestBlock.toLocaleString('en-US')}–#${historySummary.newestBlock.toLocaleString('en-US')}`
		const historyCounts = [
			`tagged state ${historySummary.counts['stateSnapshots'] ?? 0}`,
			`accounting ${historySummary.counts['accountingSnapshots'] ?? 0}`,
			`lifecycle ${historySummary.counts['lifecycleEvents'] ?? 0}`,
			`liquidations ${historySummary.counts['liquidations'] ?? 0}`,
		].join(' · ')
		const nextHistoryCursor = history['nextCursor']
		if (history['truncated'] === true && typeof nextHistoryCursor !== 'string') throw new Error('Risk history continuation is malformed')
		if (history['truncated'] === true && typeof nextHistoryCursor === 'string') {
			const nextHistoryOffset = loadedRiskHistoryOffset + (operationsHistoryOffset(history['limit']) ?? 100)
			const coveragePanel = operationsPanel(
				'History coverage',
				[operationRow('Older evidence remains', `${historyBlockRange} · ${historyCounts}.`, undefined, undefined)],
				'',
			)
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
			const complete = operationsPanel(
				'History coverage',
				[operationRow('All indexed risk history is shown', `${historyBlockRange} · ${historyCounts}.`, undefined, undefined)],
				'',
			)
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
		const demandRows = demand.map((point) =>
			operationRow(
				`Tick ${String(point['tick'])}`,
				`${operationNumber(point['amountAttoEth'])} attoETH · cumulative ${operationNumber(point['cumulativeDemandAttoEth'])}`,
				String(point['tick']),
				undefined,
			),
		)
		panels.push(operationsPanel('Demand curve data', demandRows, 'No bids have been indexed.'))
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
				branches.map((branch) =>
					operationRow(
						`Child ${String(branch['child_universe_id'])}`,
						`Outcome ${String(branch['outcome_index'] ?? '—')} · ${operationNumber(branch['migrated_atto_rep'])} attoREP · ${operationCounted(branch['migrator_count'], 'migrator')}`,
						String(branch['child_universe_id']),
						undefined,
					),
				),
				'No child branches have been indexed.',
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
		const evidencePanel = operationsPanel(
			route.kind === 'report' ? 'Report rounds' : 'Lifecycle timeline',
			route.kind === 'trading'
				? tradingEvidenceRows(evidenceItems)
				: route.kind === 'report'
					? reportEvidenceRows(evidenceItems)
					: detailEvidenceRows(evidenceItems),
			'No canonical evidence is available.',
		)
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
			const completeStatus = element('p', 'activity-summary operations-pagination-complete', 'All indexed evidence is shown.')
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
		(item) => operationsCatalogRecordKey(section, item),
	)
	if (first === undefined || last === undefined) throw new Error('Operations catalog returned no page')
	return catalogOperationsResponse(
		{ ...first, data: { ...last.data, hasMore: snapshot.nextCursor !== undefined, nextCursor: snapshot.nextCursor } },
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
			if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity)
				throw new Error('Risk catalog changed while older evidence was loading; retry from the current indexed head')
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
		(item) => String(item['pool_address'] ?? ''),
		(item) => `${String(item['pool_address'] ?? '')}:${String(item['vault_address'] ?? '')}`,
	)
	if (first === undefined || last === undefined) throw new Error('Risk catalog returned no page')
	const pagination = isRecord(last.data['pagination']) ? last.data['pagination'] : {}
	return riskCatalogOperationsResponse(
		{
			...first,
			data: {
				...last.data,
				pagination: {
					...pagination,
					poolHasMore: collected.leftNextCursor !== undefined,
					poolNextCursor: collected.leftNextCursor,
					vaultHasMore: collected.rightNextCursor !== undefined,
					vaultNextCursor: collected.rightNextCursor,
				},
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
		async (cursor) => {
			const response = decodeOperationsResponse(await api(operationsDetailEndpoint(route, cursor, 100)))
			const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
			if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity)
				throw new Error('Risk history changed while older evidence was loading; retry from the current indexed head')
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
				nextCursor: collected.nextCursor,
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
		const response = decodeOperationsResponse(
			await api(
				operationsDetailEndpoint(
					route,
					collection === 'rounds' ? cursor : undefined,
					collection === 'rounds' ? limit : 1,
					collection === 'decisions' ? cursor : undefined,
					collection === 'decisions' ? limit : 1,
				),
			),
		)
		const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
		if (snapshotIdentity !== undefined && responseIdentity !== snapshotIdentity)
			throw new Error('Report evidence changed while older evidence was loading; retry from the current indexed head')
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
	const [rounds, decisions] = await Promise.all([
		collectCanonicalPages((cursor, limit = 100) => fetchPage(cursor, limit, 'rounds'), roundTargetCount, operationsDetailRecordKey),
		collectCanonicalPages((cursor, limit = 100) => fetchPage(cursor, limit, 'decisions'), decisionTargetCount, operationsDetailRecordKey),
	])
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

const loadOperationsDetail = async (
	route: OperationsDetailRoute,
	retainedCount: number,
	riskHistoryThroughOffset = 0,
	decisionTargetCount = 0,
): Promise<OperationsResponse> => {
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
		catalogTargetCount !== undefined ||
			riskPoolTargetCount !== undefined ||
			riskVaultTargetCount !== undefined ||
			detailTargetCount !== undefined ||
			decisionTargetCount !== undefined ||
			historyTargetOffset !== undefined,
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
				const retainedCatalogCount =
					catalogSection !== undefined &&
					catalogSection !== 'risk' &&
					operationsCatalogState?.chainId === requiredChainId() &&
					operationsCatalogState.section === catalogSection
						? operationsCatalogState.items.length
						: 0
				const retainedRiskPoolCount =
					catalogSection === 'risk' && operationsRiskCatalogState?.chainId === requiredChainId() ? operationsRiskCatalogState.pools.length : 0
				const retainedRiskVaultCount =
					catalogSection === 'risk' && operationsRiskCatalogState?.chainId === requiredChainId() ? operationsRiskCatalogState.vaults.length : 0
				const retainedDetailCount =
					detailRoute !== undefined &&
					operationsDetailState?.chainId === requiredChainId() &&
					operationsDetailState.routeKey === operationsDetailRouteKey(detailRoute)
						? operationsDetailState.items.length
						: 0
				const retainedRiskHistoryOffset =
					detailRoute !== undefined &&
					(detailRoute.kind === 'pool' || detailRoute.kind === 'vault') &&
					operationsDetailState?.chainId === requiredChainId() &&
					operationsDetailState.routeKey === operationsDetailRouteKey(detailRoute)
						? operationsDetailState.riskHistoryOffset
						: 0
				const retainedDecisionCount =
					detailRoute?.kind === 'report' &&
					operationsDetailState?.chainId === requiredChainId() &&
					operationsDetailState.routeKey === operationsDetailRouteKey(detailRoute)
						? operationsDetailState.decisionItems.length
						: 0
				const response =
					detailRoute !== undefined
						? await loadOperationsDetail(
								detailRoute,
								detailTargetCount ?? retainedDetailCount,
								historyTargetOffset ?? retainedRiskHistoryOffset,
								decisionTargetCount ?? retainedDecisionCount,
							)
						: catalogSection === undefined
							? decodeOperationsResponse(await api(`/api/v1/operations?chainId=${encodeURIComponent(requiredChainId())}`))
							: catalogSection === 'risk'
								? await loadOperationsRiskCatalog(riskPoolTargetCount ?? retainedRiskPoolCount, riskVaultTargetCount ?? retainedRiskVaultCount)
								: await loadOperationsCatalog(catalogSection, catalogTargetCount ?? retainedCatalogCount)
				if (requestVersion !== operationsRequestVersion) return false
				if (detailRoute === undefined) renderOperations(response, preservedContext)
				else renderOperationsDetail(response, detailRoute, preservedContext)
				return true
			} catch (error) {
				if (requestVersion !== operationsRequestVersion) return false
				if (preserveRenderedContent) {
					status.className = 'system-status'
					status.dataset.errorDetail = error instanceof Error ? error.message : 'Unknown operations refresh failure'
					renderRetryStatus(status, 'Could not refresh protocol operations. Existing indexed evidence remains visible.', () => loadOperations({ live: true }))
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
	globalNetworkFilter.value = [...globalNetworkFilter.options].some((option) => option.value === selected) ? selected : String(items[0]?.chain_id ?? '')
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
	const canonicalGeneration = canonicalDataGeneration
	const run = (async () => {
		try {
			const { items, serverTime, freshnessThresholdMs } = decodeNetworkResponse(await api('/api/v1/networks'))
			if (!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return false
			if (serverTime) serverClockOffsetMs = new Date(serverTime).getTime() - Date.now()
			networkSnapshotCache.write({ items, ...(freshnessThresholdMs === undefined ? {} : { freshnessThresholdMs }), clientClockOffsetMs: serverClockOffsetMs })
			if (freshnessThresholdMs !== undefined && Number.isFinite(freshnessThresholdMs) && freshnessThresholdMs > 0)
				networkFreshnessThresholdMs = freshnessThresholdMs
			const previousNetwork = selectedChainId()
			reconcileNetworkOptions(items)
			if (previousNetwork !== selectedChainId()) resetSelectedNetworkContext()
			renderNetworks(items)
			lastNetworkRequestFailed = false
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

type LogReference = Pick<ActivityRecord, 'chain_id' | 'block_hash' | 'tx_hash' | 'log_index'>
const logKeyFor = (log: LogReference) => `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`

const rowFor = (log: ActivityRecord) => {
	const key = logKeyFor(log)
	const row = setLiveRecord(element('article', 'log-row'), key, {
		contractLabel: log.contract_label,
		eventName: log.event_name,
		summary: log.summary,
		origin: log.origin_address,
	})
	const chain = element('span', 'cell chain-block')
	const openCue = element('span', 'row-open-cue', '›')
	openCue.setAttribute('aria-hidden', 'true')
	chain.append(element('span', '', `#${number(log.block_number)}`), openCue)
	const timestamp = element('time', 'cell cell-time', `${time(log.block_timestamp)} · ${age(log.block_timestamp)}`)
	timestamp.dataset.time = log.block_timestamp
	timestamp.dateTime = exactTimestamp(log.block_timestamp)
	timestamp.title = exactTimestamp(log.block_timestamp)
	const contract = element('span', 'cell')
	contract.append(
		protocolAddressLink(log.emitter_address, {
			knownLabel: log.contract_label,
			chainId: log.chain_id,
			className: 'contract-name address-link',
			compact: true,
		}),
		element('span', 'contract-address', short(log.emitter_address)),
	)
	const event = element('button', 'cell event-name', log.event_name ?? 'Unknown event')
	event.type = 'button'
	event.setAttribute('aria-label', `Open ${log.event_name ?? 'unknown event'} log details from block ${log.block_number}`)
	const tx = explorerLink(log.explorer_base_url, 'tx', log.tx_hash, `${short(log.tx_hash, 7, 5)} · ${log.log_index}`)
	tx.className = 'cell cell-tx'
	const origin = protocolAddressLink(log.origin_address, { chainId: log.chain_id, className: 'cell cell-origin address-link', compact: true })
	row.append(chain, timestamp, contract, event, tx, origin)
	row.addEventListener('click', (clickEvent: MouseEvent) => {
		if (clickEvent.target instanceof HTMLAnchorElement) return
		openDetail(log)
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
	const anchor =
		live && window.scrollY >= 420
			? [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].find((row) => row.getBoundingClientRect().bottom > 0)
			: undefined
	const anchorKey = anchor?.dataset.liveKey
	const anchorTop = anchor?.getBoundingClientRect().top
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
		feedState.textContent = hadRows ? 'Refreshing indexed activity…' : 'Loading indexed activity…'
	}
	if (presentation.loadingState && !append && !hadRows) feed.replaceChildren(...Array.from({ length: 6 }, () => element('div', 'loading-line')))
	try {
		const payload =
			!append && replaceDepth !== undefined
				? await collectCanonicalPages(
						async (cursor, limit) => decodeItemsPage(await api(queryPath(cursor ?? '', limit), { signal: requestSignal }), isActivityRecord, 'Activity'),
						replaceDepth,
						logKeyFor,
					)
				: decodeItemsPage(await api(queryPath(append ? (nextCursor ?? '') : '')), isActivityRecord, 'Activity')
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		if (!append) feed.replaceChildren()
		const refreshedKeys = new Set(
			append
				? [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].flatMap((row) => (row.dataset.liveKey === undefined ? [] : [row.dataset.liveKey]))
				: [],
		)
		for (const log of payload.items) {
			const row = rowFor(log)
			const rowKey = row.dataset.liveKey
			if (rowKey !== undefined && refreshedKeys.has(rowKey)) continue
			if (rowKey !== undefined) refreshedKeys.add(rowKey)
			feed.append(row)
		}
		applyLiveChanges(feed, previousRows, { live, selector: '.log-row[data-live-key]' })
		if (anchorKey !== undefined && anchorTop !== undefined) {
			const currentAnchor = [...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')].find((row) => row.dataset.liveKey === anchorKey)
			if (currentAnchor !== undefined) window.scrollBy(0, currentAnchor.getBoundingClientRect().top - anchorTop)
		}
		nextCursor = payload.nextCursor
		$('#more').hidden = !retainedPaginationAvailable(nextCursor !== undefined, canonicalRefreshRequired)
		paginationStatus.hidden = true
		paginationStatus.replaceChildren()
		feedState.hidden = feed.childElementCount > 0
		if (feed.childElementCount === 0) feedState.textContent = 'No project logs match these filters yet.'
		$('#activity-summary').textContent =
			feed.childElementCount === 0 ? 'No logs shown' : `${feed.childElementCount} log${feed.childElementCount === 1 ? '' : 's'} shown`
		return true
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') return false
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, logsRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		if (!append && !hadRows) feed.replaceChildren()
		$('#more').hidden = !retainedPaginationAvailable(nextCursor !== undefined, canonicalRefreshRequired)
		const retryAction = () => (canonicalRefreshRequired ? requestRouteRefresh(1, true) : loadLogs({ append }))
		if (append) {
			feedState.hidden = feed.childElementCount > 0
			$('#activity-summary').textContent = `${feed.childElementCount} logs shown · could not load more`
			renderRetryStatus(paginationStatus, `Could not load more activity; showing indexed logs: ${errorMessage(error)}`, retryAction)
			moreButton.hidden = true
		} else {
			feedState.hidden = false
			const message = element('span', '', hadRows ? `Showing last known activity: ${errorMessage(error)}` : `Activity unavailable: ${errorMessage(error)}`)
			$('#activity-summary').textContent = hadRows ? `${feed.childElementCount} logs shown · refresh failed` : ''
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
		const replaceDepth = retainVisibleDepth
			? resolveActivityRefreshDepth(loadOptions.replaceDepth, pendingCanonicalActivityCount, feed.querySelectorAll<HTMLElement>('.log-row').length)
			: loadOptions.replaceDepth
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

const addressDetailCard = (
	term: string,
	address: string | null | undefined,
	{ knownLabel, chainId, wide = false }: { knownLabel?: string | null; chainId?: string; wide?: boolean } = {},
) => {
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

const usableAddressLabel = (label: unknown): string | undefined =>
	typeof label === 'string' && label.length > 0 && !label.toLowerCase().startsWith('unknown') ? label : undefined

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
		.then((value) => decodeValue(value, isAddressIdentity, 'Address identity'))
		.then((identity) => {
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

interface ProtocolAddressLinkOptions {
	knownLabel?: unknown
	chainId?: string
	className?: string
	compact?: boolean
}

const protocolAddressLink = (
	address: string | null,
	{ knownLabel, chainId = selectedChainId(), className = 'address-link', compact = false }: ProtocolAddressLinkOptions = {},
) => {
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
		void resolveAddressLabel(chainId, resolvedAddress).then((resolvedLabel) => {
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

const evidenceText = (value: unknown): string =>
	value === undefined || value === null ? '—' : typeof value === 'string' ? value : (JSON.stringify(value) ?? '—')

const decodedArgumentsTable = (
	schema: ArgumentDefinition[] | null | undefined,
	rawArguments: Record<string, unknown> | null | undefined,
	displayArguments: Record<string, unknown> | null | undefined,
	chainId: string,
) => {
	const raw = rawArguments ?? {}
	const display = displayArguments ?? {}
	const entries: ArgumentDefinition[] = schema?.length
		? schema.toSorted((left, right) => left.index - right.index)
		: Object.keys(raw).map((name, index) => ({ index, name, type: 'unknown' }))
	const table = element('table', 'arguments')
	const head = element('thead')
	const headRow = element('tr')
	for (const label of ['# / Name', 'Solidity type', 'Display value', 'Raw value']) headRow.append(element('th', '', label))
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
		displayCell.dataset.label = 'Display value'
		displayCell.append(decodedValueNode(rawValue, display[entry.name], chainId))
		const rawCell = element('td', '', evidenceText(rawValue))
		rawCell.dataset.label = 'Raw value'
		row.append(nameCell, typeCell, displayCell, rawCell)
		body.append(row)
	}
	table.append(head, body)
	return table
}

interface DetailContextSnapshot {
	scrollTop: number
	focusIndex: number
	focusKey?: string
	focusKeyOccurrence?: number
	focusTop?: number
}

const detailFocusKey = (node: HTMLElement): string =>
	`${node.tagName}:${node instanceof HTMLAnchorElement ? node.href : ''}:${node.getAttribute('aria-label') ?? node.textContent ?? ''}`

const closeEventDrawer = ({ clearUrl = true, restoreFocus = false } = {}) => {
	const drawer = document.querySelector<HTMLElement>('.event-detail-drawer')
	const triggerKey = drawer?.dataset.triggerKey
	detailContextVersion++
	detailRequestVersion++
	activeLog = undefined
	pendingCanonicalLog = undefined
	if (activeReorgRecovery !== undefined) activeReorgRecovery.logToRefresh = undefined
	drawer?.remove()
	if (clearUrl) clearDetailUrl()
	if (restoreFocus && triggerKey)
		[...feed.querySelectorAll<HTMLElement>('.log-row[data-live-key]')]
			.find((row) => row.dataset.liveKey === triggerKey)
			?.querySelector<HTMLElement>('button')
			?.focus({ preventScroll: true })
}

const captureDetailContext = (): DetailContextSnapshot => {
	const drawer = document.querySelector<HTMLElement>('.event-detail-drawer')
	if (!drawer) return { scrollTop: window.scrollY, focusIndex: -1 }
	const focusable = [...drawer.querySelectorAll<HTMLElement>('a, button, summary')]
	const focusIndex = document.activeElement instanceof HTMLElement ? focusable.indexOf(document.activeElement) : -1
	return {
		scrollTop: window.scrollY,
		focusIndex,
		focusKey: focusIndex >= 0 ? detailFocusKey(requiredArrayItem(focusable, focusIndex, 'Focused detail control')) : undefined,
		focusKeyOccurrence:
			focusIndex >= 0
				? focusable
						.slice(0, focusIndex + 1)
						.filter((candidate) => detailFocusKey(candidate) === detailFocusKey(requiredArrayItem(focusable, focusIndex, 'Focused detail control'))).length - 1
				: undefined,
		focusTop: focusIndex >= 0 ? requiredArrayItem(focusable, focusIndex, 'Focused detail control').getBoundingClientRect().top : undefined,
	}
}

const restoreDetailContext = (snapshot: DetailContextSnapshot) => {
	const drawer = document.querySelector<HTMLElement>('.event-detail-drawer')
	if (!drawer) return
	window.scrollTo({ top: snapshot.scrollTop })
	if (snapshot.focusIndex < 0) return
	const focusable = [...drawer.querySelectorAll<HTMLElement>('a, button, summary')]
	const keyedCandidates = snapshot.focusKey ? focusable.filter((candidate) => detailFocusKey(candidate) === snapshot.focusKey) : []
	const nextFocus = keyedCandidates[snapshot.focusKeyOccurrence ?? 0] ?? focusable[snapshot.focusIndex]
	if (nextFocus === undefined) return
	if (snapshot.focusTop !== undefined) window.scrollBy(0, nextFocus.getBoundingClientRect().top - snapshot.focusTop)
	nextFocus.focus({ preventScroll: true })
}

const detailContextIsUnchanged = (snapshot: DetailContextSnapshot): boolean => {
	if (Math.abs(window.scrollY - snapshot.scrollTop) > 1) return false
	if (snapshot.focusIndex < 0) return true
	const drawer = document.querySelector<HTMLElement>('.event-detail-drawer')
	const focusable = drawer ? [...drawer.querySelectorAll<HTMLElement>('a, button, summary')] : []
	return document.activeElement === focusable[snapshot.focusIndex]
}

const performOpenDetail = async (
	log: ActivityRecord | LogReference,
	{ live = false, canonicalRecovery = false, contextVersion }: DetailOptions = {},
): Promise<boolean> => {
	if (contextVersion !== detailContextVersion) return false
	const canonicalGeneration = canonicalDataGeneration
	const requestVersion = ++detailRequestVersion
	const previousContext = live ? captureDetailContext() : undefined
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
	const existingDrawer = document.querySelector<HTMLElement>('.event-detail-drawer')
	const drawer = existingDrawer ?? element('section', 'event-detail-drawer')
	drawer.setAttribute('aria-label', 'Event details')
	const drawerContent = existingDrawer?.querySelector<HTMLElement>('.event-detail-content') ?? element('div', 'event-detail-content')
	if (!existingDrawer) {
		const header = element('header', 'event-detail-header')
		const heading = element('div')
		heading.append(element('h3', '', 'Event details'))
		const close = element('button', 'icon-button', '×')
		close.type = 'button'
		close.setAttribute('aria-label', 'Close event details')
		close.addEventListener('click', () => closeEventDrawer({ restoreFocus: true }))
		header.append(heading, close)
		const canonicalStatus = element('div', 'detail-canonical-status event-detail-canonical-status')
		canonicalStatus.hidden = true
		canonicalStatus.setAttribute('role', 'status')
		canonicalStatus.setAttribute('aria-live', 'polite')
		drawer.append(header, canonicalStatus, drawerContent)
	}
	drawer.dataset.triggerKey = logKeyFor(log)
	const feedShell = feed.closest<HTMLElement>('.feed-shell')
	if (feedShell && drawer.previousElementSibling !== feedShell) feedShell.after(drawer)
	syncCanonicalDialogStatus()
	drawerContent.setAttribute('aria-busy', String(refreshPresentation({ live }).busy))
	if (!live) {
		const loading = element('p', 'detail-status', 'Loading event details…')
		loading.setAttribute('role', 'status')
		drawerContent.replaceChildren(loading, element('div', 'loading-line'))
		drawer.tabIndex = -1
		drawer.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
		drawer.focus({ preventScroll: true })
	}
	const url = new URL(location.href)
	url.searchParams.delete('account')
	url.searchParams.set('log', `${log.chain_id}:${log.block_hash}:${log.tx_hash}:${log.log_index}`)
	history.replaceState(null, '', url)
	try {
		const detail = decodeValue(await api(`/api/v1/logs/${log.chain_id}/${log.block_hash}/${log.tx_hash}/${log.log_index}`), isLogDetail, 'Log detail')
		if (
			!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		activeLog = detail
		const deployedContractAddress = typeof detail.receipt['contractAddress'] === 'string' ? detail.receipt['contractAddress'] : undefined
		const grid = element('div', 'detail-grid')
		grid.append(
			detailCard('Block', `#${number(detail.block_number)} · ${exactTimestamp(detail.block_timestamp)}`),
			addressDetailCard('Contract', detail.emitter_address, { knownLabel: detail.contract_label, chainId: detail.chain_id }),
			detailCard('Contract identity', `${detail.contract_kind ?? 'unknown kind'} · ${detail.contract_provenance ?? 'unknown provenance'}`),
			detailCard('Event signature', detail.event_signature ?? 'No matching ABI'),
			detailCard('Block hash', detail.block_hash),
			detailCard('Occurrence position', `transaction ${number(detail.transaction_index)} · log ${number(detail.log_index)}`),
			detailCard('Transaction', detail.tx_hash),
			addressDetailCard('msg.origin', detail.origin_address, { chainId: detail.chain_id }),
			addressDetailCard('To', detail.to_address, { chainId: detail.chain_id }),
			detailCard('Gas used', number(detail.gas_used)),
			detailCard(
				'Decoded action',
				decodedActionLabel(detail.action_summary, detail.to_address, detail.contract_label, detail.emitter_address, deployedContractAddress),
			),
		)
		const tools = element('div', 'detail-card wide detail-tools')
		tools.append(
			explorerLink(detail.explorer_base_url, 'block', detail.block_hash, 'Open block'),
			explorerLink(detail.explorer_base_url, 'tx', detail.tx_hash, 'Open transaction'),
			explorerLink(detail.explorer_base_url, 'address', detail.emitter_address, 'Open contract'),
		)
		grid.append(tools)
		const argumentsCard = element('div', 'detail-card wide')
		argumentsCard.append(element('p', 'eyebrow', 'Decoded arguments'))
		argumentsCard.append(decodedArgumentsTable(detail.argument_schema, detail.arguments, detail.display_arguments, detail.chain_id))
		grid.append(argumentsCard)
		const action = element('div', 'detail-card wide')
		action.append(element('p', 'eyebrow', 'Transaction calldata and decoded action'))
		if (detail.action_arguments && Object.keys(detail.action_arguments).length > 0)
			action.append(decodedArgumentsTable(detail.action_argument_schema, detail.action_arguments, detail.action_display_arguments, detail.chain_id))
		action.append(
			element('pre', 'raw', JSON.stringify({ input: detail.input, function: detail.function_signature, arguments: detail.action_arguments }, null, 2)),
		)
		grid.append(action)
		const raw = element('div', 'detail-card wide')
		raw.append(element('p', 'eyebrow', 'Complete raw transaction receipt'), element('pre', 'raw', JSON.stringify(detail.receipt, null, 2)))
		grid.append(raw)
		const contextToRestore = drawerContent.contains(document.activeElement) ? captureDetailContext() : undefined
		drawerContent.replaceChildren(grid)
		if (contextToRestore) restoreDetailContext(contextToRestore)
		if (canonicalRecovery) pendingCanonicalLog = undefined
		return true
	} catch (error) {
		if (
			!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		const noncanonical = isNoncanonicalDetailFailure(canonicalRecovery, error instanceof Error ? error.status : undefined)
		if (canonicalRecovery && !noncanonical && canonicalRefreshRequired) {
			drawerContent.querySelector<HTMLElement>('.detail-refresh-error')?.remove()
			if (previousContext && detailContextIsUnchanged(previousContext)) restoreDetailContext(previousContext)
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
			const contextToRestore = drawerContent.contains(document.activeElement) ? captureDetailContext() : undefined
			drawerContent.querySelector<HTMLElement>('.detail-refresh-error')?.remove()
			drawerContent.prepend(alert)
			if (contextToRestore) restoreDetailContext(contextToRestore)
		} else drawerContent.replaceChildren(alert)
		if (noncanonical) pendingCanonicalLog = undefined
		return noncanonical
	} finally {
		if (isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion)) drawerContent.setAttribute('aria-busy', 'false')
	}
}

const openDetail = (log: ActivityRecord | LogReference, options: DetailOptions = {}): Promise<boolean> => {
	if (options.live !== true && options.canonicalRecovery !== true) {
		detailContextVersion++
		detailRequestVersion++
	}
	const contextVersion = detailContextVersion
	const operation = () => performOpenDetail(log, { ...options, contextVersion })
	return options.live === true ? detailRefreshGate.runBackground(operation) : detailRefreshGate.runForeground(operation)
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
	const anchorCard = focusedCard ?? cards.find((card) => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
	return {
		loadedCount: activeAccountTransactions.loaded.length,
		expandedKeys: [...detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].flatMap((action) => {
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
	const availableKeys = new Set(
		[...detailContent.querySelectorAll<HTMLElement>('.account-transaction[data-live-key]')].flatMap((card) =>
			card.dataset.liveKey === undefined ? [] : [card.dataset.liveKey],
		),
	)
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

const performOpenAccountTransactions = async (
	account: AccountReference,
	{ live = false, restoreSnapshot, canonicalRecovery = false, contextVersion }: AccountDetailOptions = {},
): Promise<boolean> => {
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
	const stagedSnapshot = canonicalRecovery ? restoreSnapshot : stagedLiveRefresh ? captureAccountDialogSnapshot() : undefined
	const refreshPrevious = stagedRefresh ? liveSnapshot(detailContent, '.account-transaction[data-live-key]') : undefined
	activeLog = undefined
	document.querySelector('.event-detail-drawer')?.remove()
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
		const anchorCard = focusedCard ?? visibleCards.find((card) => card.getBoundingClientRect().bottom > dialog.getBoundingClientRect().top)
		const anchorKey = anchorCard?.dataset.liveKey
		const anchorTop = anchorCard?.getBoundingClientRect().top
		const openTransactionKeys = new Set(
			[...detailContent.querySelectorAll<HTMLElement>('.account-transaction-action[open]')].map(
				(action) => action.closest<HTMLElement>('.account-transaction[data-live-key]')?.dataset.liveKey,
			),
		)
		const header = element('div', 'account-transactions-header')
		header.append(
			element('p', 'eyebrow', 'Sent transactions'),
			element('h3', '', state.account.label ?? state.account.address),
			element('code', '', state.account.address),
			element('p', 'data-note', `${number(state.loaded.length)} of ${number(state.total)} sent transactions`),
		)
		const list = element('div', 'account-transactions')
		for (const transaction of state.loaded) {
			const transactionKey = `${transaction.chain_id}:${transaction.tx_hash}`
			const card = setLiveRecord(element('article', 'account-transaction'), transactionKey, transaction)
			const cardHeader = element('div', 'account-transaction-header')
			cardHeader.append(
				explorerLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 12, 8)),
				element('span', `badge${transaction.status === 'success' ? '' : ' transaction-failed'}`, transaction.status ?? 'unknown'),
			)
			const destination = transaction.to_label
				? `${transaction.to_label} · ${short(transaction.to_address, 8, 6)}`
				: (transaction.to_address ?? 'Contract creation')
			const detailGrid = element('dl', 'account-transaction-fields')
			for (const [term, value] of [
				[
					'Block',
					`#${number(transaction.block_number)} · ${exactTimestamp(transaction.block_timestamp).slice(0, 10)} · ${time(transaction.block_timestamp)} UTC`,
				],
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
				argumentsContent.append(
					decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id),
				)
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
	const performLoadPage = async (
		append = false,
		{ liveRefresh = false, background = false, stageOnly = false, limit = 50, restartInvalidSnapshot = true }: AccountPageOptions = {},
	) => {
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
			if (
				contextVersion !== detailContextVersion ||
				!isCurrentLiveRequest(requestVersion, detailRequestVersion, state.account.chain_id, selectedChainId()) ||
				!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
			) {
				state.pageLoading = false
				return false
			}
			const retained = append ? previousLoaded : liveRefresh ? previousLoaded : []
			state.loaded = mergeUniqueRecords(
				append ? retained : result.items,
				append ? result.items : retained,
				(transaction) => `${transaction.chain_id}:${transaction.tx_hash}`,
			)
			state.total = reconcilePaginatedTotal(state.total, result.total ?? state.total, append)
			state.nextPageCursor = liveRefresh && previousCursor !== undefined ? previousCursor : result.nextCursor
			if (state.loaded.length >= state.total) state.nextPageCursor = undefined
			state.pageLoading = false
			if (!stageOnly) render({ previous, highlight: liveRefresh })
			return true
		} catch (error) {
			if (
				!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) ||
				!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
			) {
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
				state.pageError = append
					? `Could not load more transactions; showing the last known activity: ${recoveryError ?? errorMessage(error)}`
					: `Could not refresh sent transactions; showing the last known activity: ${recoveryError ?? errorMessage(error)}`
				if (!stageOnly) render()
				return false
			}
			state.pageLoading = false
			state.pageErrorAppend = append
			state.pageError =
				state.loaded.length > 0
					? append
						? `Could not load more transactions; showing the last known activity: ${errorMessage(error)}`
						: `Could not refresh sent transactions; showing the last known activity: ${errorMessage(error)}`
					: `Could not load sent transactions: ${errorMessage(error)}`
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
		return options.background === true
			? accountPageRefreshGate.runBackground(() => performLoadPage(append, options))
			: accountPageRefreshGate.runForeground(() => performLoadPage(append, options))
	}
	const loadMore = () => loadPage(true)
	let releaseStagedRefresh: (() => void) | undefined
	const stagedRefreshCompleted = stagedRefresh
		? new Promise<void>((resolve) => {
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
		while (restoreSnapshot && shouldContinueTransactionRestore(loaded, state.loaded.length, restoreSnapshot.loadedCount, state.nextPageCursor))
			loaded = await loadPage(true)
	}
	if (
		!isCurrentContextRequest(contextVersion, detailContextVersion, requestVersion, detailRequestVersion) ||
		!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
	) {
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
	if (
		loaded &&
		canonicalRecovery &&
		pendingCanonicalAccount &&
		String(pendingCanonicalAccount.chain_id) === String(state.account.chain_id) &&
		pendingCanonicalAccount.address.toLowerCase() === state.account.address.toLowerCase()
	)
		pendingCanonicalAccount = undefined
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
		const current = richListItems.find(
			(item) => String(item.chain_id) === String(pending.chain_id) && item.address.toLowerCase() === pending.address.toLowerCase(),
		)
		restored = await openAccountTransactions(current ?? pending, {
			live: dialog.open,
			restoreSnapshot: pendingAccountDialogSnapshot,
			canonicalRecovery: true,
		})
	} else if (
		isAddress &&
		currentAddressProfile &&
		String(currentAddressProfile.chain_id) === String(pending.chain_id) &&
		currentAddressProfile.address.toLowerCase() === pending.address.toLowerCase()
	)
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
	document.querySelector('.event-detail-drawer')?.remove()
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

const chartNumericValue = (value: unknown): string | number | bigint | null | undefined =>
	typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value === null || value === undefined ? value : undefined

const chartTimestamp = (value: string): number => {
	const parsed = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value)
	return Number.isFinite(parsed) ? parsed : 0
}

const lineChart = <T extends { timestamp: string }>(
	rows: T[],
	definitions: ChartDefinition<T>[],
	{ sharedRange, axisUnit = '' }: { sharedRange?: readonly [number, number]; axisUnit?: string } = {},
) => {
	const width = 760
	const height = 190
	const margin = { left: 48, right: 14, top: 12, bottom: 28 }
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('class', 'time-chart')
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	svg.setAttribute('role', 'img')
	svg.setAttribute('aria-label', `${definitions.map(({ label }) => label).join(', ')} value over indexed time`)
	const series = definitions.map(({ key, decimals = 18 }) => {
		const raw = rows.map((row) => (row[key] === undefined ? Number.NaN : compactValue(chartNumericValue(row[key]), decimals)))
		return raw
	})
	const timestamps = rows.map((row) => chartTimestamp(row.timestamp))
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
		emptyMessage = 'No checkpoints have been indexed for this entity yet.',
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
				const latest = rows.findLast((row) => row[key] !== undefined)
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
		const caption = element('caption', '', `${title} exact indexed observations`)
		const head = document.createElement('thead')
		const headerRow = document.createElement('tr')
		headerRow.append(element('th', '', 'Indexed time'))
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
		card.append(
			viewport,
			element(
				'p',
				'data-note',
				`${note}${independentlyScaled ? ' Each line is independently scaled to its observed range so every trend remains visible; exact latest values are listed above.' : ''}`,
			),
			dataDisclosure,
		)
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
	const list = $('#contract-list')
	if (contractItems.length === 0) {
		list.replaceChildren(element('div', 'state-placeholder', 'No system contracts are registered for this network.'))
		list.setAttribute('aria-busy', 'false')
		return
	}
	const sectionOrder: readonly ContractRegistrySection[] = ['Protocol contracts', 'System dependencies', 'Discovered contracts']
	const displayedContractItems = [...contractItems].sort(
		(left, right) => sectionOrder.indexOf(contractRegistrySection(left)) - sectionOrder.indexOf(contractRegistrySection(right)),
	)
	const scrollLeft = list.scrollLeft
	const scrollTop = list.scrollTop
	const focusedContractAddress =
		document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('.contract-row')?.dataset.contractAddress : undefined
	const focusedAction =
		document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-contract-action]')?.dataset.contractAction : undefined
	const groupScrollPositions = new Map(
		[...list.querySelectorAll<HTMLElement>('.contract-group[data-contract-group]')].flatMap((group) => {
			const name = group.dataset.contractGroup
			const rows = group.querySelector<HTMLElement>('.contract-group-rows')
			return name === undefined || rows === null ? [] : [[name, rows.scrollLeft] as const]
		}),
	)
	const existingRows = new Map([...list.querySelectorAll<HTMLElement>('.contract-row[data-contract-address]')].map((row) => [row.dataset.contractAddress, row]))
	const groupedRows = new Map<ContractRegistrySection, HTMLElement[]>()
	for (const contract of displayedContractItems) {
		const status = contractDeploymentStatus(contract)
		const addressKey = contract.address.toLowerCase()
		const row = existingRows.get(addressKey) ?? element('article', 'contract-row')
		row.dataset.contractAddress = addressKey
		const head = element('span', 'contract-row-head')
		head.append(element('strong', '', contract.label), element('span', `deployment-status ${status.tone}`, status.label))
		const facts = element('div', 'contract-row-facts')
		facts.append(
			detailCard(
				contract.deployment_block_exact === false ? 'Search boundary block' : 'Deployment block',
				contract.deployment_block === null ? 'Not observed' : `#${number(contract.deployment_block)}`,
			),
			detailCard(contractDeploymentTimestampLabel(contract), contract.deployment_timestamp ? exactTimestamp(contract.deployment_timestamp) : 'Not observed'),
		)
		const actions = element('div', 'detail-tools')
		const openContract = explorerLink(contract.explorer_base_url, 'address', contract.address, 'Open contract ↗')
		openContract.dataset.contractAction = `${addressKey}:open-contract`
		actions.append(openContract)
		if (contract.deployment_block) {
			const openDeployment = explorerLink(contract.explorer_base_url, 'block', contract.deployment_block, contractDeploymentBlockActionLabel(contract))
			openDeployment.dataset.contractAction = `${addressKey}:open-deployment`
			actions.append(openDeployment)
		}
		if (contract.discovery_tx_hash) {
			const openDiscovery = explorerLink(contract.explorer_base_url, 'tx', contract.discovery_tx_hash, 'Open discovery transaction ↗')
			openDiscovery.dataset.contractAction = `${addressKey}:open-discovery`
			actions.append(openDiscovery)
		}
		row.replaceChildren(head, element('code', '', contract.address), element('span', 'eyebrow', contract.kind), facts, actions)
		const section = contractRegistrySection(contract)
		const rows = groupedRows.get(section) ?? []
		rows.push(row)
		groupedRows.set(section, rows)
	}
	const sections = sectionOrder.flatMap((sectionName) => {
		const rows = groupedRows.get(sectionName)
		if (rows === undefined || rows.length === 0) return []
		const section = element('section', 'contract-group')
		section.dataset.contractGroup = sectionName
		const rowList = element('div', 'contract-group-rows')
		rowList.append(...rows)
		section.append(element('h3', 'contract-group-heading', sectionName), rowList)
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
	if (focusedAction !== undefined) document.querySelector<HTMLElement>(`[data-contract-action="${focusedAction}"]`)?.focus()
	else if (focusedContractAddress !== undefined)
		list.querySelector<HTMLElement>(`[data-contract-address="${focusedContractAddress}"]`)?.querySelector<HTMLElement>('a')?.focus()
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
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, contractRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		contractItems = result.items
		renderContracts()
		if (presentation.loadingState) {
			status.className = 'system-status sr-only'
			status.textContent = 'System contracts updated.'
		} else status.hidden = true
		return true
	} catch (error) {
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, contractRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		$('#contract-list').setAttribute('aria-busy', 'false')
		renderRetryStatus(
			status,
			contractItems.length === 0
				? `Contract registry unavailable: ${errorMessage(error)}`
				: `Refresh failed; showing the last registry: ${errorMessage(error)}`,
			() => retryCanonicalViewOr(loadContracts),
		)
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
	const openDetailKeys = new Set([...rows.querySelectorAll<HTMLElement>('details[open][data-detail-key]')].map((details) => details.dataset.detailKey))
	const focusedDetailKey =
		document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('details[data-detail-key]')?.dataset.detailKey : undefined
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
		wallet.append(
			richFieldLabel(`${itemNativeSymbol} / WETH`),
			element('strong', '', hasNative ? richBalance(item.native_balance, itemNativeSymbol) : `${itemNativeSymbol} pending`),
			element('span', '', wethComplete ? richBalance(item.weth_balance, 'WETH') : `${richBalance(item.weth_balance, 'WETH')} · partial`),
		)
		const transactions = element('button', 'rich-count rich-transactions')
		transactions.type = 'button'
		transactions.setAttribute('aria-label', `View ${number(item.transaction_count)} transactions sent by ${item.label ?? item.address}`)
		transactions.append(richFieldLabel('Transactions'), element('strong', '', number(item.transaction_count)))
		transactions.addEventListener('click', () => openAccountTransactions(item))
		const positions = element('div', 'rich-count')
		positions.append(
			richFieldLabel('Protocol involvement'),
			element('strong', '', counted(item.pool_count, 'pool')),
			element('span', '', `${counted(item.active_vault_count, 'active vault')} / ${counted(item.vault_count, 'known vault')}`),
		)
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
			if (token.universeId !== null && token.universeId !== undefined)
				tokenIdentity.append(document.createTextNode(` · universe ${shortIdentifier(token.universeId)}`))
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
		involvement.open =
			openDetailKeys.has(involvement.dataset.detailKey) ||
			(isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
		involvement.append(element('summary', '', `${counted(item.pool_count, 'pool association')} · ${counted(item.vault_count, 'vault position')}`))
		const involvementGrid = element('div', 'rich-position-grid')
		for (const pool of poolAssociations) {
			const card = element('div', 'rich-position')
			const link = protocolAddressLink(pool.address, {
				knownLabel: pool.label,
				chainId: item.chain_id,
				className: 'rich-token-address address-link',
			})
			card.append(
				element('span', 'rich-position-kind', 'Pool association'),
				element('strong', '', pool.questionTitle ?? pool.label ?? 'Associated security pool'),
				element('span', '', pool.label ?? 'Observed in the same protocol transaction'),
				link,
			)
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
		if (poolAssociations.length < Number(item.pool_count) || vaultPositions.length < Number(item.vault_count))
			involvementGrid.append(element('span', 'data-note', 'Showing the first 100 associations or positions.'))
		involvement.append(involvementGrid)
		if (Number(item.pool_count) > 0 || Number(item.vault_count) > 0) article.append(involvement)
		rows.append(article)
	}
	if (focusedDetailKey) {
		const focusedDetails = [...rows.querySelectorAll<HTMLElement>('details[data-detail-key]')].find((details) => details.dataset.detailKey === focusedDetailKey)
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
			const remainingPages = await Promise.all(remainingOffsets.map((offset) => fetchPage(offset, Math.min(100, targetCount - offset))))
			return { ...firstPage, items: [firstPage, ...remainingPages].flatMap((page) => page.items).slice(0, targetCount) }
		}
		let replace = !append
		let result = append ? await fetchPage(nextOffset, 50) : await fetchSnapshot(Math.max(50, richListItems.length))
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		if (append && paginatedSnapshotWasReplaced(richListItems.length, result.total ?? result.items.length)) {
			result = await fetchSnapshot(Math.max(1, richListItems.length))
			if (
				!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion) ||
				!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
			)
				return false
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
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, richListRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		$('#richlist-rows').setAttribute('aria-busy', 'false')
		const failureStatus = append ? paginationStatus : status
		renderRetryStatus(
			failureStatus,
			append
				? `Could not load more; showing known rankings: ${errorMessage(error)}`
				: richListItems.length === 0
					? `Rich list unavailable: ${errorMessage(error)}`
					: `Refresh failed; showing last known rankings: ${errorMessage(error)}`,
			() => retryCanonicalViewOr(() => loadRichList({ append })),
		)
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

const renderAddressProfile = (
	item: RichListRecord,
	transactions: AccountTransaction[],
	interactions: AccountTransaction[],
	{ live = false, portfolioFocusKind }: { live?: boolean; portfolioFocusKind?: 'forks' | 'lp' | 'reports' } = {},
) => {
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
	nativeCard.append(
		element('strong', '', item.native_balance_detail ? exactUnit(item.native_balance_detail.balance, 18, itemNativeSymbol, 2) : `${itemNativeSymbol} pending`),
		element('span', '', item.native_balance_detail ? `Block #${number(item.native_balance_detail.blockNumber)}` : 'No balance snapshot yet'),
	)
	balanceGrid.append(nativeCard)
	for (const token of [...(item.weth_balances ?? []), ...(item.rep_balances ?? [])]) {
		const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
		const card = element('div', 'rich-token')
		card.append(
			element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP', 2)),
			element(
				'span',
				'',
				`${token.universeId === undefined || token.universeId === null ? 'Token' : `Universe ${shortIdentifier(token.universeId)}`} · block #${number(token.blockNumber)}`,
			),
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
		card.append(
			element('span', 'rich-position-kind', 'Pool'),
			element('strong', '', pool.questionTitle ?? pool.label ?? 'Security pool'),
			protocolAddressLink(pool.address, { knownLabel: pool.label, chainId, className: 'rich-token-address address-link' }),
		)
		involvementGrid.append(card)
	}
	for (const position of item.vault_positions ?? []) {
		const card = element('div', 'rich-position')
		card.append(
			element('span', 'rich-position-kind', 'Vault'),
			element('strong', '', position.questionTitle ?? 'Vault position'),
			element(
				'span',
				'',
				`${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP', 2)} capacity · ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol, 2)} claimable`,
			),
			protocolAddressLink(position.poolAddress, { chainId, className: 'rich-token-address address-link' }),
		)
		involvementGrid.append(card)
	}
	if (involvementGrid.childElementCount === 0) involvementGrid.append(element('p', 'data-note', 'No pool or vault involvement has been indexed.'))
	involvement.append(involvementGrid)
	setLiveRecord(involvement, 'involvement', { pools: item.pool_associations, vaults: item.vault_positions })
	const escalationClaims = operationsPanel(
		'Escalation interactions',
		(item.escalation_claims ?? []).map((claim) =>
			operationRow(
				String(claim['type'] ?? 'Escalation position'),
				`${String(claim['provenance'] ?? 'historical interaction')} · current claimability is unavailable`,
				String(claim['entity'] ?? ''),
				claim['blockNumber'],
			),
		),
		'No escalation interactions are associated with this address.',
	)
	const auctionClaims = operationsPanel(
		'Auction interactions',
		(item.auction_claims ?? []).map((claim) =>
			operationRow(
				String(claim['type'] ?? 'Auction position'),
				`${String(claim['provenance'] ?? 'historical interaction')} · current entitlement is unavailable`,
				String(claim['entity'] ?? ''),
				claim['blockNumber'],
			),
		),
		'No truth-auction interactions are associated with this address.',
	)
	const lpPositions = operationsPanel(
		'AMM liquidity positions',
		operationRecords(item['lp_positions']).map((position) =>
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
		operationRecords(item['fork_participation']).map((event) =>
			operationRow(
				String(event['event_name'] ?? 'Fork migration'),
				'Canonical event evidence naming this address as migrator, vault, or recipient',
				String(event['universe_identity'] ?? ''),
				event['block_number'],
				operationsHref(`/operations/fork/${encodeURIComponent(String(event['universe_identity'] ?? ''))}`),
			),
		),
		'No fork or migration participation has been indexed for this address.',
	)
	const reportParticipation = operationsPanel(
		'OpenOracle reporting participation',
		operationRecords(item['report_participation']).map((event) =>
			operationRow(
				`${String(event['event_name'] ?? 'Report')} · report ${String(event['report_id'] ?? '—')}`,
				`Round ${String(event['round_number'] ?? '—')} · canonical reporter evidence`,
				String(event['open_oracle_address'] ?? ''),
				event['block_number'],
				operationsHref(
					`/operations/report/${encodeURIComponent(String(event['open_oracle_address'] ?? ''))}/${encodeURIComponent(String(event['report_id'] ?? ''))}`,
				),
			),
		),
		'No OpenOracle rounds identify this address as the current reporter.',
	)
	const appendPortfolioPagination = (kind: 'forks' | 'lp' | 'reports', panel: HTMLElement) => {
		const page = portfolioPage(item, kind)
		const items = portfolioItems(item, kind)
		const singular = kind === 'lp' ? 'position' : kind === 'forks' ? 'fork event' : 'report event'
		const total = typeof page['total'] === 'number' ? page['total'] : undefined
		panel
			.querySelector('h3')
			?.after(element('p', 'operations-panel-scope', `${operationCounted(items.length, singular)} shown · ${operationCounted(total, singular)} indexed total`))
		if (page['hasMore'] === true && typeof page['nextCursor'] === 'string') {
			const button = element(
				'button',
				'secondary compact portfolio-history-more',
				`Show more ${kind === 'lp' ? 'positions' : kind === 'forks' ? 'fork events' : 'report events'}`,
			)
			button.type = 'button'
			button.dataset['portfolioKind'] = kind
			const status = element('p', 'activity-summary')
			status.setAttribute('role', 'status')
			status.setAttribute('aria-live', 'polite')
			button.addEventListener('click', async () => {
				const scrollY = window.scrollY
				button.disabled = true
				button.setAttribute('aria-busy', 'true')
				button.textContent = `Showing more ${kind === 'lp' ? 'positions' : kind === 'forks' ? 'fork events' : 'report events'}…`
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
					button.textContent = `Retry more ${kind === 'lp' ? 'positions' : kind === 'forks' ? 'fork events' : 'report events'}`
					status.textContent = 'Additional account evidence could not be loaded.'
					status.classList.remove('sr-only')
					button.focus({ preventScroll: true })
				}
			})
			panel.append(button, status)
		} else if (portfolioFocusKind === kind) {
			const complete = element('p', 'activity-summary operations-pagination-complete', `All indexed ${singular}${singular.endsWith('s') ? '' : 's'} are shown.`)
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
	if (transactions.length === 0) transactionList.append(element('p', 'data-note', 'No sent transactions have been indexed.'))
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
			argumentsContent.append(
				decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id),
			)
			action.append(element('summary', '', 'Decoded arguments'), argumentsContent)
			row.append(action)
		}
		interactionList.append(row)
	}
	if (interactions.length === 0) interactionList.append(element('p', 'data-note', 'No protocol references have been indexed.'))
	interactionPanel.append(interactionList)
	setLiveRecord(interactionPanel, 'references', interactions)
	setLiveRecord(activity, 'transactions', transactions)
	content.replaceChildren(
		header,
		metrics,
		balances,
		involvement,
		lpPositions,
		forkParticipation,
		reportParticipation,
		escalationClaims,
		auctionClaims,
		interactionPanel,
		activity,
	)
	applyLiveChanges(content, previousSections, { live })
	content.setAttribute('aria-busy', 'false')
}

const portfolioPage = (data: Record<string, unknown>, kind: 'forks' | 'lp' | 'reports'): Record<string, unknown> => {
	const pagination = isRecord(data['portfolioPagination']) ? data['portfolioPagination'] : {}
	return isRecord(pagination[kind]) ? pagination[kind] : {}
}

const portfolioItems = (data: Record<string, unknown>, kind: 'forks' | 'lp' | 'reports'): Record<string, unknown>[] =>
	operationRecords(data[kind === 'lp' ? 'lp_positions' : kind === 'forks' ? 'fork_participation' : 'report_participation'])

const portfolioItemKey = (kind: 'forks' | 'lp' | 'reports', item: Readonly<Record<string, unknown>>): string => {
	if (kind === 'lp') return String(item['market_address'] ?? '')
	return `${String(item['block_hash'] ?? '')}:${String(item['tx_hash'] ?? '')}:${String(item['log_index'] ?? '')}:${
		kind === 'forks' ? String(item['universe_identity'] ?? '') : `${String(item['open_oracle_address'] ?? '')}:${String(item['report_id'] ?? '')}`
	}`
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
			query.set(kind === 'lp' ? 'lpCursor' : kind === 'forks' ? 'forkCursor' : 'reportCursor', pages[kind]['nextCursor'])
			const response = decodeOperationsResponse(await api(`/api/v1/state/address-portfolio?${query.toString()}`))
			const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
			if (responseIdentity !== snapshotIdentity)
				throw new Error('Portfolio history changed while older evidence was loading; retry from the current indexed head')
			collections[kind] = mergeUniqueRecords(collections[kind], portfolioItems(response.data, kind), (item) => portfolioItemKey(kind, item))
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
	if (presentation.loadingState && !hadProfile)
		content.replaceChildren(element('p', 'detail-status', 'Loading address activity…'), element('div', 'loading-line'))
	try {
		const retainedPortfolioDepths =
			currentAddressPortfolioDepths?.chainId === requiredChainId() && currentAddressPortfolioDepths.address === address
				? currentAddressPortfolioDepths
				: { chainId: requiredChainId(), address, forks: 0, lp: 0, reports: 0 }
		const portfolioTargets = {
			forks: portfolioTarget?.kind === 'forks' ? portfolioTarget.count : retainedPortfolioDepths.forks,
			lp: portfolioTarget?.kind === 'lp' ? portfolioTarget.count : retainedPortfolioDepths.lp,
			reports: portfolioTarget?.kind === 'reports' ? portfolioTarget.count : retainedPortfolioDepths.reports,
		}
		const [portfolio, identity, transactions, interactions] = await Promise.all([
			loadAddressPortfolioSnapshot(address, portfolioTargets),
			api(`/api/v1/address-identity?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}`).then((value) =>
				decodeValue(value, isAddressIdentity, 'Address identity'),
			),
			api(`/api/v1/address-transactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then((value) =>
				decodeItemsPage(value, isAccountTransaction, 'Address transactions'),
			),
			api(`/api/v1/address-interactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then((value) =>
				decodeItemsPage(value, isAccountTransaction, 'Address interactions'),
			),
		])
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, addressProfileRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		const network = latestNetworks.find((candidate) => String(candidate.chain_id) === selectedChainId())
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
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, addressProfileRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		if (hadProfile && canonicalRefreshRequired) {
			content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
			content.setAttribute('aria-busy', 'false')
			return false
		}
		const alert = element('div', `detail-error${hadProfile ? ' address-refresh-error' : ''}`)
		alert.setAttribute('role', 'alert')
		alert.append(
			element(
				'p',
				'',
				hadProfile ? `Refresh failed; showing last known address state: ${errorMessage(error)}` : `Could not load address: ${errorMessage(error)}`,
			),
		)
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
	if (type === 'vaults' && 'vault_address' in item)
		return decodeEntityHistory(await api(`/api/v1/state/vaults/${item.chain_id}/${item.pool_address}/${item.vault_address}${suffix}`))
	if (type === 'questions' && 'question_id' in item)
		return decodeEntityHistory(await api(`/api/v1/state/questions/${item.chain_id}/${item.question_id}${suffix}`))
	if ('universe_id' in item) return decodeEntityHistory(await api(`/api/v1/state/universes/${item.chain_id}/${item.universe_id}${suffix}`))
	throw new Error(`State entity does not match the selected ${type} tab`)
}

const fetchEntityHistory = async (type: StateTab, item: StateEntity, throughOffset = 0): Promise<EntityHistory> => {
	let firstPage: EntityHistory | undefined
	let anchor: EntityHistoryCoverageValue | undefined
	const collected = await collectCursorCollections<unknown>(
		async (cursor) => {
			const page = await fetchEntityHistoryPage(type, item, cursor)
			const coverage = page.coverage
			if (coverage === undefined) throw new Error('State history response is missing coverage metadata')
			if (page.truncated === true && coverage.nextCursor === undefined) throw new Error('State history continuation is malformed')
			if (page.truncated === false && coverage.nextCursor !== undefined) throw new Error('State history completion is malformed')
			if (anchor === undefined) anchor = coverage
			else if (
				coverage.requestedFromBlock !== anchor.requestedFromBlock ||
				coverage.requestedToBlock !== anchor.requestedToBlock ||
				coverage.indexedFromBlock !== anchor.indexedFromBlock ||
				coverage.indexedThroughBlock !== anchor.indexedThroughBlock ||
				coverage.indexedThroughHash !== anchor.indexedThroughHash
			)
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
	const chronological = (records: readonly unknown[]) =>
		records.toSorted((left, right) => (isRecord(left) && isRecord(right) ? compareCanonicalEventPosition(left, right) : 0))
	const collections = Object.fromEntries(entityHistoryCollectionKeys.map((key) => [key, chronological(collected.collections[key] ?? [])]))
	const series = Object.fromEntries(entityHistoryCollectionKeys.filter((key) => key in anchoredCoverage.series).map((key) => [key, collections[key].length]))
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
	if (coverage === undefined) {
		notice.append(element('strong', '', 'History coverage unavailable'), element('span', '', 'This response did not include an indexed range boundary.'))
		return notice
	}
	const collections = entityHistoryCollections(history)
	const recordCollections = Object.fromEntries(entityHistoryCollectionKeys.map((key) => [key, collections[key].filter(isRecord)]))
	const summary = summarizeHistoryCollections(recordCollections, entityHistoryCollectionKeys)
	const loadedRange =
		summary.oldestBlock === undefined || summary.newestBlock === undefined
			? 'No block-numbered records loaded'
			: summary.oldestBlock === summary.newestBlock
				? `Loaded block #${summary.oldestBlock.toLocaleString('en-US')}`
				: `Loaded blocks #${summary.oldestBlock.toLocaleString('en-US')}–#${summary.newestBlock.toLocaleString('en-US')}`
	const seriesCounts = Object.entries(coverage.series)
		.map(([key, count]) => `${historySeriesLabel(key)} ${number(count)}`)
		.join(' · ')
	const indexedRange = `#${number(coverage.indexedFromBlock)}–${coverage.indexedThroughBlock === undefined ? 'pending' : `#${number(coverage.indexedThroughBlock)}`}`
	const requestedRange = `#${number(coverage.requestedFromBlock)}–#${number(coverage.requestedToBlock)}`
	notice.append(
		element(
			'strong',
			'',
			coverage.nextCursor !== undefined
				? 'More indexed history available'
				: coverage.rangeCovered === false
					? 'Requested range is partially indexed'
					: 'Indexed history loaded',
		),
		element(
			'span',
			'',
			`${loadedRange} · ${seriesCounts || 'no historical series'}. Requested ${requestedRange}; scanner coverage ${indexedRange}.${
				coverage.rangeCovered === false ? ' Narrow the requested range or backfill the missing blocks.' : ''
			}`,
		),
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
	fragment.append(
		stateHeader(
			'Security pool',
			poolItem.question_title ?? 'Unknown question',
			`${poolItem.pool_address} · universe ${shortIdentifier(poolItem.universe_id, 8, 6)}`,
			'Latest indexed',
		),
	)
	fragment.append(historyCoverageNotice(history, 'pools', poolItem))
	fragment.append(
		operationsPanel(
			'OpenOracle coordinator state and history',
			openOracleHistory.map((observation) =>
				operationRow(
					String(observation['event_name'] ?? 'Coordinator transition'),
					String(observation['summary'] ?? 'Canonical OpenOracle coordinator evidence'),
					String(observation['coordinator_address'] ?? poolItem.coordinator_address),
					observation['block_number'],
				),
			),
			'No OpenOracle coordinator state transitions have been indexed for this pool.',
		),
	)
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard(
			'Settlement collateral',
			exactUnit(poolItem.settlement_collateral_atto_eth ?? poolItem.initial_settlement_collateral_atto_eth, 18, poolNativeSymbol, 2),
		),
		metricCard('Capacity ownership', exactUnit(poolItem.total_capacity_ownership_atto_rep, 18, 'REP', 2)),
		metricCard('Claimable vault fees', exactUnit(poolItem.total_claimable_vault_fees_atto_eth, 18, poolNativeSymbol, 3)),
		metricCard('Indexed vaults', number(poolItem.vault_count)),
		metricCard('Conditional YES', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_yes_bps, 2, '%', 2)),
		metricCard('Conditional NO', latestAmmPrice === undefined ? 'No AMM price' : exactUnit(latestAmmPrice.conditional_no_bps, 2, '%', 2)),
		metricCard('REP / ETH', latestRepEthPrice === undefined ? 'No coordinator price' : exactUnit(latestRepEthPrice.rep_per_eth_1e18, 18, 'REP/ETH', 4)),
		metricCard(
			'Latest Uniswap spot',
			latestUniswapPrice === undefined ? 'No Uniswap price' : exactUnit(latestUniswapPrice.rep_per_eth_1e18, 18, `REP/${latestUniswapPrice.quote_symbol}`, 4),
			latestUniswapPrice === undefined ? undefined : uniswapPriceProvenance(latestUniswapPrice),
		),
		metricCard('AMM market', history.market === undefined ? 'Not indexed' : `${number(ammPrices.length)} observations`),
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
				emptyMessage: 'No Uniswap REP / ETH or REP / USDC pool observations have been indexed for this universe.',
			},
		),
		chartCard(
			'Uniswap liquidity over time',
			uniswapLiquidity.rows,
			uniswapLiquidity.definitions,
			'V2 points preserve the exact reserve product. V3 and V4 points preserve the exact active-liquidity integer emitted by Swap. Each venue is raw protocol evidence and is not silently normalized across token decimal systems.',
			{ emptyMessage: 'No Uniswap liquidity observations have been indexed for this universe.' },
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
			{ sharedRange: [0, 100], axisUnit: '%', emptyMessage: 'No Augur AMM reserve observations have been indexed for this pool.' },
		),
		chartCard(
			'REP / ETH coordinator price history',
			repEthPrices,
			[
				{
					key: 'rep_per_eth_1e18',
					label: 'REP per ETH',
					unit: 'REP/ETH',
					pointShape: (row) => (row.event_name === 'RepEthPriceSet' ? 'diamond' : 'circle'),
					pointLabel: (row) => (row.event_name === 'RepEthPriceSet' ? 'Initialization seed' : 'Accepted settlement'),
				},
			],
			'Coordinator price state. RepEthPriceSet records initialization and does not establish timestamp-based oracle validity; PriceReported points are accepted settlements.',
			{
				legendItems: [{ label: 'Initialization', className: 'initialization' }],
				emptyMessage: 'No REP / ETH coordinator price observations have been indexed for this pool.',
			},
		),
	)
	const currentCard = element('section', 'static-card')
	currentCard.append(element('h4', '', 'Latest indexed accounting and lifecycle'))
	const currentGrid = element('div', 'static-grid')
	const systemStates = ['Operational', 'Pool forked', 'Fork migration', 'Fork truth auction']
	const currentState = poolItem.current_state ?? {}
	currentGrid.append(
		staticField(
			'System state',
			currentState.systemState === undefined
				? 'No lifecycle event yet'
				: (systemStates[Number(currentState.systemState)] ?? `State ${currentState.systemState}`),
		),
		staticField(
			'Awaiting fork continuation',
			currentState.awaitingForkContinuation === undefined ? 'No checkpoint' : currentState.awaitingForkContinuation ? 'Yes' : 'No',
		),
		staticField(
			'Total REP backing units',
			currentState.totalRepBackingUnits === undefined ? 'No checkpoint' : exactUnit(chartNumericValue(currentState.totalRepBackingUnits), 18, '', 3),
		),
		staticField(
			'Share-token supply',
			currentState.shareTokenSupplyAttoShares === undefined
				? 'No checkpoint'
				: exactUnit(chartNumericValue(currentState.shareTokenSupplyAttoShares), 18, 'shares', 3),
		),
		staticField('Fee-eligible capacity ownership', exactUnit(poolItem.fee_eligible_capacity_ownership_atto_rep, 18, 'REP', 3)),
		staticField('Unallocated accrued fees', exactUnit(poolItem.unallocated_accrued_fees_atto_eth, 18, poolNativeSymbol, 5)),
		staticField('Current retention rate', exactUnit(poolItem.current_retention_rate, 18, '', 9)),
		typeof currentState.escalationGame === 'string' && currentState.escalationGame !== ''
			? staticAddressField('Escalation game', currentState.escalationGame, poolItem.chain_id)
			: staticField('Escalation game', 'Not set'),
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
		history.market === undefined || history.market === null
			? staticField('Augur AMM pair', 'Not indexed')
			: staticAddressField('Augur AMM pair', history.market.pair_address, poolItem.chain_id),
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

const renderVaultDetail = async (
	vaultItem: VaultRecord,
	requestVersion: number,
	canonicalGeneration: number,
	suppliedHistory?: EntityHistory,
): Promise<void> => {
	const history = suppliedHistory ?? (await fetchEntityHistory('vaults', vaultItem))
	if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
	const vaultNativeSymbol = nativeSymbol(vaultItem.chain_id)
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Security vault', vaultItem.vault_address, `Pool ${vaultItem.pool_address}`, 'Latest indexed'))
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

const renderQuestionDetail = async (
	question: QuestionRecord,
	requestVersion: number,
	canonicalGeneration: number,
	suppliedHistory?: EntityHistory,
): Promise<void> => {
	const history = suppliedHistory ?? (await fetchEntityHistory('questions', question))
	if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
	const kind = question.outcome_options.length === 0 ? 'Scalar' : 'Categorical'
	const fragment = document.createDocumentFragment()
	fragment.append(stateHeader('Immutable question', question.title, `ID ${short(question.question_id, 10, 8)}`, `${kind} · ${questionStatus(question)}`))
	fragment.append(historyCoverageNotice(history, 'questions', question))
	const metrics = element('div', 'metric-grid')
	metrics.append(
		metricCard('Status', questionStatus(question)),
		metricCard('Linked pools', number(question.pool_count)),
		metricCard('Universe forks', number(question.fork_count)),
		metricCard('Answer type', kind),
	)
	fragment.append(metrics)
	const definition = element('section', 'static-card')
	definition.append(element('h4', '', 'Question definition — immutable after creation'), element('p', 'question-description', question.description))
	const outcomes = element('div', 'outcomes')
	const labels =
		question.outcome_options.length > 0
			? ['Invalid', ...question.outcome_options]
			: [
					`${exactUnit(question.display_value_min, 18, question.answer_unit)} → ${exactUnit(question.display_value_max, 18, question.answer_unit)}`,
					`${number(question.num_ticks)} ticks`,
				]
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
	grid.append(
		staticField('Pool deployments', String(history.pools.length)),
		staticField('Universe forks using this question', String(history.forks.length)),
		staticField('Question ID', question.question_id),
		staticField('Created block evidence', `#${number(question.block_number)}`),
	)
	usage.append(
		grid,
		element(
			'p',
			'data-note',
			'Question metadata has no mutable onchain fields. Pool deployments and universe forks are tracked separately as historical usage.',
		),
	)
	fragment.append(usage)
	$('#state-detail').replaceChildren(fragment)
}

const renderLineage = (universes: UniverseRecord[], selected: UniverseRecord): SVGSVGElement => {
	const byKey = new Map(universes.map((universe) => [`${universe.chain_id}:${universe.universe_id}`, universe]))
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
	const maximumMembers = Math.max(1, ...[...levels.values()].map((members) => members.length))
	const nodeWidth = 210
	const columnGap = 285
	const rowGap = 70
	const width = 60 + maximumLevel * columnGap + nodeWidth
	const height = 40 + maximumMembers * rowGap
	const renderedWidth = Math.max(900, width)
	const renderedHeight = Math.round((height * renderedWidth) / width)
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
	svg.setAttribute('class', 'lineage-graph')
	svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	svg.setAttribute('width', String(renderedWidth))
	svg.setAttribute('height', String(renderedHeight))
	svg.setAttribute('role', 'img')
	svg.setAttribute('aria-label', 'Returned Zoltar universe parent and child relationships')
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

const renderUniverseDetail = async (
	universe: UniverseRecord,
	requestVersion: number,
	canonicalGeneration: number,
	suppliedHistory?: EntityHistory,
): Promise<void> => {
	const history = suppliedHistory ?? (await fetchEntityHistory('universes', universe))
	if (requestVersion !== stateDetailRequestVersion || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)) return
	const fragment = document.createDocumentFragment()
	const title = universe.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(universe.universe_id, 12, 8)}`
	fragment.append(
		stateHeader(
			'Zoltar universe',
			title,
			`Outcome ${universe.forking_outcome_index} · parent ${shortIdentifier(universe.parent_universe_id, 8, 6)}`,
			universe.active_fork_time ? 'Forked' : 'Active',
		),
	)
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
			history.events.filter((event) => event['theoretical_supply_atto_rep'] !== null),
			[{ key: 'theoretical_supply_atto_rep', label: 'Theoretical REP', unit: 'REP' }],
			'Supply changes are recorded from initialization, fork, burn, and migration events.',
		),
	)
	const lineage = element('section', 'lineage-card')
	const heading = element('div', 'chart-heading')
	const catalog = stateData
	if (catalog === undefined) throw new Error('System state catalog is unavailable')
	heading.append(element('h4', '', 'Returned Zoltar universes'), element('span', 'data-note', `${catalog.universes.length} returned records`))
	const scroll = element('div', 'lineage-scroll')
	scroll.append(renderLineage(catalog.universes, universe))
	lineage.append(heading, scroll, element('p', 'data-note', 'Each edge links a child universe to the parent fork and outcome that created it.'))
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
	if (type === 'pools' && 'settlement_collateral_atto_eth' in item)
		return [
			item.question_title ?? short(item.pool_address),
			`${counted(item.vault_count, 'vault')} · ${exactUnit(item.settlement_collateral_atto_eth, 18, nativeSymbol(item.chain_id), 1)}`,
		]
	if (type === 'vaults' && 'vault_address' in item)
		return [short(item.vault_address, 10, 6), `${exactUnit(item.capacity_ownership_atto_rep, 18, 'REP', 1)} capacity`]
	if (type === 'questions' && 'outcome_options' in item) return [item.title, `${questionStatus(item)} · ${counted(item.pool_count, 'pool')}`]
	if ('universe_id' in item && 'pool_count' in item)
		return [
			item.universe_id === '0' ? 'Genesis universe' : `Universe ${shortIdentifier(item.universe_id, 9, 6)}`,
			`${counted(item.child_count, 'child', 'children')} · ${counted(item.pool_count, 'pool')}`,
		]
	throw new Error(`State entity does not match the selected ${type} tab`)
}

const performSelectEntity = async (
	item: StateEntity,
	{ preserveDetail = false, quiet = false, pagination = false, historyTargetOffset, contextVersion, suppliedHistory }: SelectEntityOptions = {},
): Promise<boolean> => {
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
		if (activeStateType === 'pools' && 'settlement_collateral_atto_eth' in item)
			await renderPoolDetail(item, requestVersion, canonicalGeneration, loadedHistory)
		if (activeStateType === 'vaults' && 'vault_address' in item) await renderVaultDetail(item, requestVersion, canonicalGeneration, loadedHistory)
		if (activeStateType === 'questions' && 'outcome_options' in item) await renderQuestionDetail(item, requestVersion, canonicalGeneration, loadedHistory)
		if (activeStateType === 'universes' && 'reputation_token_address' in item)
			await renderUniverseDetail(item, requestVersion, canonicalGeneration, loadedHistory)
		const current =
			isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion) &&
			isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		if (current) selectedEntityHistoryOffset = loadedHistory.loadedOffset ?? 0
		return current
	} catch (error) {
		if (
			isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion) &&
			isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		) {
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
		if (
			isCurrentContextRequest(contextVersion, stateDetailContextVersion, requestVersion, stateDetailRequestVersion) &&
			isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			$('#state-detail').setAttribute('aria-busy', 'false')
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

const renderEntityList = async ({
	refreshSelected = false,
	live = false,
	selectedHistory,
	detailGateReserved = false,
}: RenderEntityListOptions = {}): Promise<boolean> => {
	const query = $('#entity-search').value.trim().toLowerCase()
	if (stateData === undefined) throw new Error('System state catalog is unavailable')
	const catalogItems = stateItems(stateData, activeStateType)
	const items = catalogItems.filter((item) => !query || entityCopy(activeStateType, item).join(' ').toLowerCase().includes(query))
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
	const selected = items.find((item) => entityKey(activeStateType, item) === selectedEntityKey)
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
	} else {
		stateDetailContextVersion++
		stateDetailRequestVersion++
		selectedEntityKey = undefined
		$('#state-detail').setAttribute('aria-busy', 'false')
		$('#state-detail').replaceChildren(element('div', 'state-placeholder', `No indexed ${activeStateType} match this view.`))
	}
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
	const previousDetail = $('#state-detail').textContent
	const presentation = refreshPresentation({ live })
	if (presentation.loadingState) {
		alert.hidden = true
		alert.replaceChildren()
		status.hidden = false
		status.textContent = hadData ? 'Refreshing indexed registry…' : 'Loading indexed registry…'
	}
	setSystemControlsDisabled(presentation.busy)
	$('#state-stats').setAttribute('aria-busy', String(presentation.busy))
	$('#entity-list').setAttribute('aria-busy', String(presentation.busy))
	try {
		const nextStateData = decodeStateCatalog(await api(`/api/v1/state/catalog?chainId=${requiredChainId()}`))
		if (
			!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) ||
			!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		)
			return false
		for (const poolItem of nextStateData.pools) poolItem.current_state = {}
		const orderedPoolStates = (nextStateData.poolStates ?? []).toSorted(
			(left, right) => Number(left.block_number) - Number(right.block_number) || Number(left.log_index) - Number(right.log_index),
		)
		for (const state of orderedPoolStates) {
			const poolItem = nextStateData.pools.find(
				(candidate) => String(candidate.chain_id) === String(state.chain_id) && candidate.pool_address === state.pool_address,
			)
			if (poolItem?.current_state !== undefined) Object.assign(poolItem.current_state, state.state)
		}
		const stagedStateType = activeStateType
		const stagedDetailContext = stateDetailContextVersion
		const query = $('#entity-search').value.trim().toLowerCase()
		const visibleItems = stateItems(nextStateData, stagedStateType).filter(
			(item) => !query || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(query),
		)
		const selectedItem = visibleItems.find((item) => entityKey(stagedStateType, item) === selectedEntityKey) ?? visibleItems[0]
		const stagedSelectedKey = selectedItem === undefined ? undefined : entityKey(stagedStateType, selectedItem)
		const selectedHistory = selectedItem === undefined ? undefined : await fetchEntityHistory(stagedStateType, selectedItem, selectedEntityHistoryOffset)
		const currentQuery = $('#entity-search').value.trim().toLowerCase()
		const currentVisibleItems = stateItems(nextStateData, stagedStateType).filter(
			(item) => !currentQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(currentQuery),
		)
		const currentSelectedItem = currentVisibleItems.find((item) => entityKey(stagedStateType, item) === selectedEntityKey) ?? currentVisibleItems[0]
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
			const reservedVisibleItems = stateItems(nextStateData, stagedStateType).filter(
				(item) => !reservedQuery || entityCopy(stagedStateType, item).join(' ').toLowerCase().includes(reservedQuery),
			)
			const reservedSelectedItem = reservedVisibleItems.find((item) => entityKey(stagedStateType, item) === selectedEntityKey) ?? reservedVisibleItems[0]
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
			stateData = nextStateData
			renderStateStats({ live })
			const detailRefreshed = await renderEntityList({ refreshSelected: true, live, selectedHistory, detailGateReserved: true })
			if (
				!isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) ||
				!isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
			)
				return false
			if (live && previousDetail !== $('#state-detail').textContent) animateLiveNode($('#state-detail'), 'live-changed')
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
		if (
			isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) &&
			isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		) {
			$('#state-stats').setAttribute('aria-busy', 'false')
			$('#entity-list').setAttribute('aria-busy', 'false')
			$('#state-detail').setAttribute('aria-busy', 'false')
			alert.hidden = false
			alert.replaceChildren()
			status.hidden = true
			alert.append(
				element('span', '', hadData ? `Refresh failed; showing last known state: ${errorMessage(error)}` : `System state unavailable: ${errorMessage(error)}`),
			)
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
		if (
			isCurrentContextRequest(contextVersion, viewContextVersion, requestVersion, catalogRequestVersion) &&
			isCurrentCanonicalGeneration(canonicalGeneration, canonicalDataGeneration)
		) {
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
	if (stateData !== undefined) renderEntityList()
}

const resetActivityFilterContext = () => {
	feed.replaceChildren()
	feed.setAttribute('aria-busy', 'true')
	nextCursor = undefined
	$('#activity-summary').textContent = ''
	feedState.hidden = false
	feedState.textContent = 'Loading indexed activity…'
	$('#more').hidden = true
	$('#activity-more-status').hidden = true
	$('#activity-more-status').replaceChildren()
	setLogControlsBusy(true)
}

$('#filters').addEventListener('submit', (event) => {
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
	loadLogs()
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
	loadLogs()
})
$('#address-filter').addEventListener('input', () => validateAddressFilter())
$('#filters').addEventListener('input', () => {
	$('#clear-filters').disabled = !hasActivityFilters()
})
const retryCanonicalRefresh = async (button: HTMLButtonElement) => {
	if (button.disabled) return
	button.disabled = true
	button.setAttribute('aria-busy', 'true')
	button.textContent = 'Retrying…'
	try {
		if (canonicalRefreshRequired) {
			const refreshed = await requestRouteRefresh(1, true)
			if (refreshed) completeCanonicalRefresh()
			else updateFreshness()
		} else {
			await loadNetworks({ refreshAfterCurrent: true })
			if (isSystem) await loadSystemState()
			else if (isOperations) await loadOperations()
			else if (isContracts) await loadContracts()
			else if (isRichList) await loadRichList()
			else if (isAddress) await loadAddressProfile()
			else await loadLogs()
		}
	} finally {
		button.disabled = false
		button.removeAttribute('aria-busy')
		button.textContent = 'Retry now'
	}
}
$('#refresh-stale').addEventListener('click', () => retryCanonicalRefresh($('#refresh-stale')))
$('#detail-canonical-retry').addEventListener('click', () => retryCanonicalRefresh($('#detail-canonical-retry')))
$('#more').addEventListener('click', () => loadLogs({ append: true }))
$('#close-detail').addEventListener('click', () => closeDetail())
dialog.addEventListener('click', (event) => {
	if (event.target === dialog) closeDetail()
})
dialog.addEventListener('cancel', (event) => {
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
const isStateTab = (value: string | undefined | null): value is StateTab =>
	value === 'pools' || value === 'vaults' || value === 'questions' || value === 'universes'

const historyRangeForm = document.querySelector<HTMLFormElement>('#history-range')
const historyFromBlock = document.querySelector<HTMLInputElement>('#history-from-block')
const historyToBlock = document.querySelector<HTMLInputElement>('#history-to-block')
const historyRangeClear = document.querySelector<HTMLButtonElement>('#history-range-clear')
if (historyRangeForm === null || historyFromBlock === null || historyToBlock === null || historyRangeClear === null)
	throw new Error('History range controls are missing')
historyFromBlock.value = pageUrl.searchParams.get('fromBlock') ?? ''
historyToBlock.value = pageUrl.searchParams.get('toBlock') ?? ''
historyRangeForm.addEventListener('submit', (event) => {
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
	tab.addEventListener('keydown', (event) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
		event.preventDefault()
		const current = stateTabs.indexOf(tab)
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? stateTabs.length - 1
					: (current + (event.key === 'ArrowRight' ? 1 : -1) + stateTabs.length) % stateTabs.length
		const nextTab = stateTabs[next]
		if (nextTab === undefined) return
		nextTab.focus()
		if (isStateTab(nextTab.dataset.stateTab)) setStateTab(nextTab.dataset.stateTab)
	})
}
$('#entity-search').addEventListener('input', () => {
	stateDetailContextVersion++
	stateDetailRequestVersion++
	if (stateData !== undefined) renderEntityList()
})
$('#entity-search').addEventListener('keydown', (event) => {
	const input = event.currentTarget
	if (!(input instanceof HTMLInputElement) || event.key !== 'Escape' || input.value === '') return
	event.preventDefault()
	input.value = ''
	stateDetailContextVersion++
	stateDetailRequestVersion++
	if (stateData !== undefined) renderEntityList()
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
	document.querySelector('.event-detail-drawer')?.remove()
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
	loadRichList()
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
			const refreshedAccount = richListItems.find(
				(item) => String(item.chain_id) === String(account.chain_id) && item.address.toLowerCase() === account.address.toLowerCase(),
			)
			await openAccountTransactions(refreshedAccount ?? account, { live: true })
		}
		const canonicalDetailRefreshed =
			contentRefreshed && pendingCanonicalAccount && activeReorgRecovery === undefined ? await restorePendingCanonicalAccount() : true
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
		const canonicalDetailRefreshed =
			contentRefreshed && pendingCanonicalAccount && activeReorgRecovery === undefined ? await restorePendingCanonicalAccount() : true
		const fullyRefreshed = contentRefreshed && canonicalDetailRefreshed
		if (fullyRefreshed && canonicalRefreshRequired && activeReorgRecovery === undefined) completeCanonicalRefresh()
		return fullyRefreshed
	}
	const activityRetention = activityRefreshRetention(
		canonicalRefreshRequired,
		pendingCanonicalActivityCount,
		feed.querySelectorAll<HTMLElement>('.log-row').length,
	)
	const contentRefreshed = await loadLogs({
		live: true,
		...activityRetention,
	})
	if (contentRefreshed && activeReorgRecovery === undefined && pendingCanonicalLog === undefined && activeLog && document.querySelector('.event-detail-drawer'))
		await openDetail(activeLog, { live: true })
	const canonicalDetailRefreshed = contentRefreshed && pendingCanonicalLog && activeReorgRecovery === undefined ? await restorePendingCanonicalLog() : true
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
	nextStream.addEventListener('block', (event) => {
		const payload = eventPayload(event, 'Block update')
		if (payload === undefined) return
		applyDemoBlock(payload)
		invalidateAddressIdentityCache(String(payload.chainId), true)
		if (String(payload.chainId) === selectedChainId()) liveUpdate(event)
	})
	nextStream.addEventListener('status', liveUpdate)
	nextStream.addEventListener('reorg', async (event) => {
		const payload = eventPayload(event, 'Reorganization')
		if (payload === undefined) return
		if (payload.reason === undefined) {
			console.error('Reorganization notification could not be decoded (missing history invalidation reason)')
			return
		}
		if (isDemo) {
			demoReorgObserved = true
			demoEvictedAddress = activeAccount?.address.toLowerCase()
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
let restoredCachedNetworkSnapshot = false
if (cachedNetworkSnapshot?.items.some((network) => String(network.chain_id) === initialChainId)) {
	if (cachedNetworkSnapshot.clientClockOffsetMs !== undefined) serverClockOffsetMs = cachedNetworkSnapshot.clientClockOffsetMs
	if (cachedNetworkSnapshot.freshnessThresholdMs !== undefined) networkFreshnessThresholdMs = cachedNetworkSnapshot.freshnessThresholdMs
	reconcileNetworkOptions(cachedNetworkSnapshot.items)
	renderNetworks(cachedNetworkSnapshot.items)
	updateFreshness()
	restoredCachedNetworkSnapshot = true
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
addEventListener('pageshow', async (event: PageTransitionEvent) => {
	if (!event.persisted) return
	connectStream()
	await requestRouteRefresh(1, true)
})

setInterval(() => {
	for (const node of document.querySelectorAll<HTMLElement>('[data-time]'))
		node.textContent = node.classList.contains('cell-time') ? `${time(node.dataset.time)} · ${age(node.dataset.time)}` : age(node.dataset.time)
}, 1000)
setInterval(() => {
	if (document.hidden) return
	if (isDemo) loadNetworks()
	else void refreshRouteAlongsideNetworkStatus(loadNetworks, () => requestRouteRefresh(1))
}, 12_000)
document.addEventListener('visibilitychange', () => {
	if (!document.hidden) void requestRouteRefresh(1)
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
	$('.skip-link').href = isSystem
		? '#system'
		: isOperations
			? '#operations'
			: isContracts
				? '#contracts'
				: isRichList
					? '#richlist'
					: isAddress
						? '#address-profile'
						: '#activity'
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a')) {
		const current = new URL(link.href).pathname === location.pathname || (isOperations && new URL(link.href).pathname === '/operations')
		if (current) link.setAttribute('aria-current', 'page')
		else link.removeAttribute('aria-current')
	}
	for (const link of document.querySelectorAll<HTMLAnchorElement>('.operations-nav a')) {
		if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page')
		else link.removeAttribute('aria-current')
	}
}
syncVisibleRoute()

const requestedTab = pageUrl.searchParams.get('tab')
if (isSystem) setStateTab(isStateTab(requestedTab) ? requestedTab : 'pools')
if (isSystem) selectedEntityKey = pageUrl.searchParams.get('entity') ?? undefined

const initialNetworkStatusLoad = loadInitialNetworkStatus(restoredCachedNetworkSnapshot, () => loadNetworks({ synchronizeActivity: false }))
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
type OperationsRoutePosition = { readonly scrollY: number; readonly focusedIndex?: number }
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
			const item = richListItems.find((candidate) => candidate.chain_id === chainId && candidate.address.toLowerCase() === address.toLowerCase())
			const network = latestNetworks.find((candidate) => String(candidate.chain_id) === chainId)
			await openAccountTransactions(item ?? { chain_id: chainId, address, explorer_base_url: network?.explorer_base_url })
			return
		}
		currentUrl.searchParams.delete('account')
		history.replaceState(null, '', currentUrl)
		pageUrl = currentUrl
	}
}
for (const link of document.querySelectorAll<HTMLAnchorElement>('.product-nav a, .operations-nav a')) {
	link.addEventListener('click', (event) => {
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
			if (!target.searchParams.has(name) && !['log', 'account', 'contract', 'entity', 'tab', 'fromBlock', 'toBlock'].includes(name))
				target.searchParams.set(name, value)
		}
		void navigateInPlace(target)
	})
}
document.addEventListener('click', (event) => {
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
	if (historyChainId !== null && historyChainId !== selectedChainId() && [...globalNetworkFilter.options].some((option) => option.value === historyChainId)) {
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
