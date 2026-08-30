import { expect, test } from 'bun:test'
import {
	isAccountTransactionValue,
	isActivityRecordValue,
	isAddressIdentityValue,
	isAmmPriceValue,
	isChartRowValue,
	isEntityHistoryCoverageValue,
	isLogDetailValue,
	isNetworkRecordValue,
	isPoolStateEntityValue,
	isQuestionStateEntityValue,
	isRepEthPriceValue,
	isRichListRecordValue,
	isUniswapPriceValue,
	isUniverseStateEntityValue,
	isVaultStateEntityValue,
} from '../browser/api-validation.ts'

test('validates state-history range and completeness metadata', () => {
	const coverage = {
		requestedFromBlock: '0',
		requestedToBlock: '100',
		indexedFromBlock: '5',
		indexedThroughBlock: '100',
		indexedThroughHash: `0x${'1'.repeat(64)}`,
		limit: 1000,
		offset: 0,
		series: { snapshots: 10, events: 2 },
		complete: false,
		nextCursor: 'opaque-page-2',
	}
	expect(isEntityHistoryCoverageValue(coverage)).toBeTrue()
	expect(isEntityHistoryCoverageValue({ ...coverage, complete: 'yes' })).toBeFalse()
	expect(isEntityHistoryCoverageValue({ ...coverage, series: { snapshots: -1 } })).toBeFalse()
})

const activity = {
	chain_id: '1',
	network_id: 'mainnet',
	block_number: '12',
	block_hash: `0x${'1'.repeat(64)}`,
	block_timestamp: '2026-08-19T00:00:00.000Z',
	transaction_index: 2,
	log_index: 3,
	tx_hash: `0x${'2'.repeat(64)}`,
	emitter_address: `0x${'3'.repeat(40)}`,
	contract_label: null,
	contract_kind: null,
	event_name: null,
	summary: 'Unknown log',
	decode_status: 'unknown',
	canonical: true,
	finalized: false,
	topics: [],
	data: '0x',
	arguments: null,
	display_arguments: null,
	argument_schema: null,
	origin_address: null,
	explorer_base_url: 'https://example.test',
}

const accountTransaction = {
	chain_id: '1',
	tx_hash: `0x${'2'.repeat(64)}`,
	block_hash: `0x${'1'.repeat(64)}`,
	block_number: '12',
	block_timestamp: '2026-08-19T00:00:00.000Z',
	transaction_index: 2,
	from_address: `0x${'4'.repeat(40)}`,
	to_address: null,
	to_label: null,
	to_kind: null,
	value: '0',
	status: '1',
	gas_used: '21000',
	function_name: null,
	function_signature: null,
	action_summary: null,
	action_arguments: null,
	action_display_arguments: null,
	action_argument_schema: null,
	explorer_base_url: 'https://example.test',
}

const richListRecord = {
	chain_id: '1',
	network_id: 'mainnet',
	explorer_base_url: 'https://example.test',
	address: `0x${'4'.repeat(40)}`,
	label: null,
	kind: null,
	transaction_count: '1',
	interaction_count: '2',
	pool_count: '0',
	vault_count: '0',
	rep_balances: [],
	weth_balances: [],
	native_balance_detail: null,
	pool_associations: [],
	vault_positions: [],
}

test('accepts production-shaped unknown logs, unknown calldata, partial related logs, and pending balances', () => {
	expect(isActivityRecordValue(activity)).toBeTrue()
	expect(isActivityRecordValue({ ...activity, chain_id: 1 })).toBeFalse()
	expect(isActivityRecordValue({ ...activity, log_index: '3' })).toBeFalse()
	expect(isAccountTransactionValue(accountTransaction)).toBeTrue()
	expect(isAccountTransactionValue({ ...accountTransaction, roles: ['referenced'], pool_addresses: null })).toBeTrue()
	expect(isRichListRecordValue(richListRecord)).toBeTrue()
	expect(
		isLogDetailValue({
			...activity,
			origin_address: `0x${'4'.repeat(40)}`,
			to_address: null,
			value: '0',
			input: '0x',
			gas_used: '21000',
			contract_provenance: null,
			event_signature: null,
			function_signature: null,
			action_summary: null,
			action_arguments: null,
			action_display_arguments: null,
			action_argument_schema: null,
			receipt: { status: '0x1', logs: [] },
			relatedLogs: [{ log_index: 3, emitter_address: activity.emitter_address, event_name: null, summary: 'Unknown log' }],
		}),
	).toBeTrue()
})

test('accepts production address identities and network startup states', () => {
	expect(isAddressIdentityValue({ chainId: 1, address: `0x${'4'.repeat(40)}` })).toBeTrue()
	expect(isAddressIdentityValue({ chainId: '1', address: `0x${'4'.repeat(40)}` })).toBeFalse()
	const startupNetwork = {
		chain_id: '1',
		id: 'mainnet',
		name: 'Mainnet',
		start_block: '100',
		indexed_block: null,
		indexed_hash: null,
		indexed_timestamp: null,
		observed_block: null,
		finalized_block: null,
		phase: 'starting',
		last_poll_at: null,
		last_success_at: null,
		consecutive_failures: 0,
		last_reorg_at: null,
		next_retry_at: null,
		last_error: null,
		explorer_base_url: 'https://example.test',
	}
	expect(isNetworkRecordValue(startupNetwork)).toBeTrue()
	expect(isNetworkRecordValue({ ...startupNetwork, last_reorg_at: 12 })).toBeFalse()
	expect(isNetworkRecordValue({ ...startupNetwork, next_retry_at: false })).toBeFalse()
})

test('validates nested state rows and complete specialized price records', () => {
	expect(isChartRowValue({ timestamp: '2026-08-19T00:00:00.000Z', state: { systemState: '2', awaitingForkContinuation: true } })).toBeTrue()
	const amm = {
		timestamp: '2026-08-19T00:00:00.000Z',
		block_number: '12',
		conditional_yes_bps: '5100',
		conditional_no_bps: '4900',
		yes_reserve_atto_shares: '49',
		no_reserve_atto_shares: '51',
	}
	const repEth = {
		timestamp: '2026-08-19T00:00:00.000Z',
		block_number: '12',
		event_name: 'RepEthPriceSet',
		report_id: null,
		rep_per_eth_1e18: '18000000000000000000',
		settlement_timestamp: null,
	}
	const uniswap = {
		timestamp: '2026-08-19T00:00:00.000Z',
		block_number: '12',
		venue: 'v3',
		market_id: `0x${'1'.repeat(40)}`,
		contract_address: `0x${'2'.repeat(40)}`,
		fee_hundredths_bip: '500',
		quote_symbol: 'WETH',
		event_name: 'Swap',
		rep_per_eth_1e18: '18000000000000000000',
	}
	expect(isAmmPriceValue(amm)).toBeTrue()
	expect(isRepEthPriceValue(repEth)).toBeTrue()
	expect(isUniswapPriceValue(uniswap)).toBeTrue()
	expect(isAmmPriceValue({ ...amm, yes_reserve_atto_shares: undefined })).toBeFalse()
	expect(isRepEthPriceValue({ ...repEth, event_name: null })).toBeFalse()
	expect(isUniswapPriceValue({ ...uniswap, block_number: 12 })).toBeFalse()
})

test('rejects malformed nested records before rendering', () => {
	expect(isActivityRecordValue({ ...activity, argument_schema: [null] })).toBeFalse()
	expect(
		isLogDetailValue({
			...activity,
			to_address: null,
			value: '0',
			input: '0x',
			gas_used: '21000',
			contract_provenance: null,
			event_signature: null,
			function_signature: 12,
			action_summary: null,
			action_arguments: null,
			action_display_arguments: null,
			action_argument_schema: null,
			receipt: {},
			relatedLogs: [],
		}),
	).toBeFalse()
	expect(isAccountTransactionValue({ ...accountTransaction, action_argument_schema: [null] })).toBeFalse()
	expect(isRichListRecordValue({ ...richListRecord, rep_balances: [null] })).toBeFalse()
	expect(isRichListRecordValue({ ...richListRecord, vault_positions: [null] })).toBeFalse()
	expect(isRichListRecordValue({ ...richListRecord, pool_associations: [{ address: null }] })).toBeFalse()
	expect(isRichListRecordValue({ ...richListRecord, native_balance_detail: { balance: '1', blockNumber: null } })).toBeFalse()
})

test('requires complete, renderable state catalog entities', () => {
	const pool = {
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: 'pool',
		parent_address: 'parent',
		universe_id: '0',
		question_id: 'question',
		question_title: null,
		truth_auction_address: 'auction',
		coordinator_address: 'coordinator',
		share_token_address: 'shares',
		security_multiplier_bps: '15000',
		initial_priority_fee_atto_eth_per_gas: '1',
		initial_retention_rate: '2',
		initial_settlement_collateral_atto_eth: '3',
		settlement_collateral_atto_eth: null,
		total_capacity_ownership_atto_rep: null,
		fee_eligible_capacity_ownership_atto_rep: null,
		total_claimable_vault_fees_atto_eth: null,
		unallocated_accrued_fees_atto_eth: null,
		current_retention_rate: null,
		vault_count: '0',
		child_count: '0',
		snapshot_block: null,
	}
	const vault = {
		chain_id: '1',
		network_id: 'mainnet',
		pool_address: 'pool',
		vault_address: 'vault',
		question_title: null,
		rep_backing_units: '1',
		capacity_ownership_atto_rep: '2',
		claimable_fees_atto_eth: '3',
		fee_index: '4',
		vault_fee_remainder: '5',
		resulting_total_rep_backing_units: '6',
		resulting_fee_eligible_capacity_ownership_atto_rep: '7',
		block_number: '8',
	}
	const question = {
		chain_id: '1',
		network_id: 'mainnet',
		question_id: 'question',
		title: 'Question',
		description: 'Description',
		created_timestamp: '2026-01-01T00:00:00Z',
		start_time: '2026-01-01T00:00:00Z',
		end_time: '2027-01-01T00:00:00Z',
		num_ticks: '0',
		display_value_min: '0',
		display_value_max: '0',
		answer_unit: '',
		outcome_options: ['Yes', 'No'],
		pool_count: '1',
		fork_count: '0',
	}
	const universe = {
		chain_id: '1',
		network_id: 'mainnet',
		universe_id: '0',
		parent_universe_id: '0',
		forking_outcome_index: '0',
		reputation_token_address: 'rep',
		theoretical_supply_atto_rep: '1',
		active_fork_question_id: null,
		active_fork_time: null,
		forker_address: null,
		fork_threshold_atto_rep: null,
		migration_rep_balance_atto_rep: null,
		child_count: '0',
		pool_count: '0',
	}

	expect(isPoolStateEntityValue(pool)).toBeTrue()
	expect(isVaultStateEntityValue(vault)).toBeTrue()
	expect(isQuestionStateEntityValue(question)).toBeTrue()
	expect(isUniverseStateEntityValue(universe)).toBeTrue()
	expect(isPoolStateEntityValue({ ...pool, share_token_address: null })).toBeFalse()
	expect(isVaultStateEntityValue({ ...vault, fee_index: undefined })).toBeFalse()
	expect(isQuestionStateEntityValue({ ...question, outcome_options: [null] })).toBeFalse()
	expect(isUniverseStateEntityValue({ ...universe, reputation_token_address: null })).toBeFalse()
})
