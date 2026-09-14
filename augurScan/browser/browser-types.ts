import type { UniswapPriceObservation } from './chart-values.ts'

export interface AmmPriceHistoryRecord {
	timestamp: string
	block_number: string
	conditional_yes_bps: string
	conditional_no_bps: string
	yes_reserve_atto_shares: string
	no_reserve_atto_shares: string
}

export interface RepEthPriceHistoryRecord {
	timestamp: string
	settlement_timestamp: string | null
	block_number: string
	event_name: string
	report_id: string | null
	rep_per_eth_1e18: string
}

import { type EntityHistoryCoverageValue, type JsonRecord, type JsonValue } from './api-validation.ts'

import { type ActivityDetailFocusSnapshot, type HistoryInvalidationReason } from './live-update.ts'

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

export type StateTab = 'pools' | 'vaults' | 'questions' | 'universes'

export interface NetworkRecord {
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

export interface ContractRecord {
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

export interface ActivityRecord {
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
	function_name?: string | null
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

export interface RichListRecord {
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
	escalation_claims?: JsonRecord[]
	auction_claims?: JsonRecord[]
	lp_positions?: JsonRecord[]
	fork_participation?: JsonRecord[]
	report_participation?: JsonRecord[]
	portfolioPagination?: JsonRecord
}

export type PoolRecord = {
	chain_id: string
	network_id: string
	pool_address: string
	parent_address: string
	universe_id: string
	question_id: string
	question_title: string
	truth_auction_address: string
	coordinator_address: string
	share_token_address: string
	security_multiplier_bps: string
	initial_priority_fee_atto_eth_per_gas: string
	initial_retention_rate: string
	initial_settlement_collateral_atto_eth: string
	settlement_collateral_atto_eth: string
	total_capacity_ownership_atto_rep: string
	fee_eligible_capacity_ownership_atto_rep: string
	total_claimable_vault_fees_atto_eth: string
	unallocated_accrued_fees_atto_eth: string
	current_retention_rate: string
	vault_count: string
	child_count: string
	snapshot_block: string
} & { current_state?: Record<string, JsonValue> | undefined }

export type VaultRecord = {
	chain_id: string
	network_id: string
	pool_address: string
	vault_address: string
	question_title: string
	rep_backing_units: string
	capacity_ownership_atto_rep: string
	claimable_fees_atto_eth: string
	fee_index: string
	vault_fee_remainder: string
	resulting_total_rep_backing_units: string
	resulting_fee_eligible_capacity_ownership_atto_rep: string
	block_number: string
}

export type QuestionRecord = {
	chain_id: string
	network_id: string
	question_id: string
	title: string
	description: string
	created_timestamp: string
	start_time: string
	end_time: string
	num_ticks: string
	display_value_min: string
	display_value_max: string
	answer_unit: string
	outcome_options: string[]
	pool_count: string
	fork_count: string
} & { block_number?: string | undefined }

export type UniverseRecord =
	| {
			chain_id: string
			network_id: string
			universe_id: string
			parent_universe_id: string
			forking_outcome_index: string
			reputation_token_address: string
			theoretical_supply_atto_rep: string
			active_fork_question_id: string
			active_fork_time: string
			forker_address: string
			fork_threshold_atto_rep: string
			migration_rep_balance_atto_rep: string
			child_count: string
			pool_count: string
	  }
	| {
			chain_id: string
			network_id: string
			universe_id: string
			parent_universe_id: string
			forking_outcome_index: string
			reputation_token_address: string
			theoretical_supply_atto_rep: string
			active_fork_question_id: null
			active_fork_time: null
			child_count: string
			pool_count: string
			forker_address?: undefined
			fork_threshold_atto_rep?: undefined
			migration_rep_balance_atto_rep?: undefined
	  }

export type StateEntity = PoolRecord | VaultRecord | QuestionRecord | UniverseRecord

type SerializedAtomicInteger = string | number

export interface StateCatalog {
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

export interface AccountReference {
	chain_id: string
	address: string
	label?: string | null
	explorer_base_url?: string
}

export interface AccountTransaction extends AccountReference {
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

export interface ArgumentDefinition {
	index: number
	name: string
	type: string
	indexed?: boolean
}

export interface AccountTransactionState {
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

export interface DialogSnapshot {
	loadedCount: number
	expandedKeys: string[]
	anchorKey?: string
	anchorTop?: number
	focusKey?: string
	focusIndex: number
	outsideFocus?: string
	scrollTop: number
}

export interface CanonicalRecovery {
	title: string
	detail: string
	pendingRefresh: boolean
	logToRefresh?: ActivityRecord
	accountToRefresh?: AccountReference
	promise: Promise<boolean>
	chainId?: string
	accountDialogSnapshot?: DialogSnapshot
}

export interface AddressIdentity {
	chainId: number
	address: string
	label?: string
	kind?: string
}

export interface ChartRow {
	timestamp: string
	[key: string]: JsonValue | undefined
}

export interface ChartDefinition<T extends { timestamp: string }> {
	key: Extract<keyof T, string>
	label: string
	decimals?: number
	unit?: string
	className?: string
	pointShape?: (row: T) => 'circle' | 'diamond'
	pointLabel?: (row: T) => string
}

export interface EntityHistory {
	snapshots: ChartRow[]
	events: ChartRow[]
	ammPrices: AmmPriceHistoryRecord[]
	repEthPrices: RepEthPriceHistoryRecord[]
	uniswapRepEthPrices: UniswapPriceObservation[]
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

export interface ItemsPage<T> {
	items: T[]
	nextCursor?: string
	total?: number
	limit?: number
	offset?: number
	snapshotBlock?: string
}

export interface NetworkResponse extends ItemsPage<NetworkRecord> {
	serverTime?: string
	freshnessThresholdMs?: number
	clientClockOffsetMs?: number
	writtenAt?: number
}

interface RelatedLogRecord {
	log_index: number
	emitter_address: string
	event_name: string | null
	summary: string
}

export interface LogDetail extends ActivityRecord {
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

export interface SelectEntityOptions {
	preserveDetail?: boolean
	quiet?: boolean
	pagination?: boolean
	historyTargetOffset?: number
	contextVersion?: number
	suppliedHistory?: EntityHistory
}

export interface RenderEntityListOptions {
	refreshSelected?: boolean
	live?: boolean
	selectedHistory?: EntityHistory
	detailGateReserved?: boolean
}

export interface LiveChangeOptions {
	live?: boolean
	selector?: string
}

export interface LoadOptions {
	append?: boolean
	live?: boolean
	replaceDepth?: number
	contextVersion?: number
	retainVisibleDepth?: boolean
	portfolioTarget?: { readonly kind: 'forks' | 'lp' | 'reports'; readonly count: number }
}

export interface DetailOptions {
	live?: boolean
	canonicalRecovery?: boolean
	contextVersion?: number
}

export interface AccountDetailOptions extends DetailOptions {
	restoreSnapshot?: DialogSnapshot
}

export interface LiveEventPayload {
	chainId: string | number
	blockNumber?: string | number
	depth?: string | number
	reason?: HistoryInvalidationReason
}

export type PoolStateRecord = NonNullable<StateCatalog['poolStates']>[number]

export type PagedOperationsCatalogSection = 'auctions' | 'escalations' | 'forks' | 'integrity' | 'reports' | 'timeline' | 'trading'

export type OperationsCatalogSection = PagedOperationsCatalogSection | 'risk'

export type OperationsRenderContext = {
	readonly focusHref?: string
	readonly focusLoadMore: boolean
	readonly focusDetailCollection?: 'decisions' | 'evidence'
	readonly focusRiskKind?: 'pool' | 'vault'
	readonly focusHistoryMore: boolean
	readonly focusViewportTop?: number
	readonly scrollY: number
}

export type OperationsDetailRoute = {
	readonly kind: 'auction' | 'escalation' | 'fork' | 'pool' | 'report' | 'trading' | 'vault'
	readonly identity: readonly string[]
}

export type LogReference = Pick<ActivityRecord, 'chain_id' | 'block_hash' | 'tx_hash' | 'log_index'>

export interface ProtocolAddressLinkOptions {
	knownLabel?: unknown
	chainId?: string
	className?: string
	compact?: boolean
}

export interface DetailContextSnapshot extends ActivityDetailFocusSnapshot {
	scrollTop: number
}

export type PortfolioData = JsonRecord | Pick<RichListRecord, 'lp_positions' | 'fork_participation' | 'report_participation' | 'portfolioPagination'>

export type OperationsRoutePosition = { readonly scrollY: number; readonly focusedIndex?: number }
