export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const isString = (value: unknown): value is string => typeof value === 'string'
export const isNullableString = (value: unknown): value is string | null => value === null || isString(value)
export const isStringOrNumber = (value: unknown): value is string | number => isString(value) || typeof value === 'number'
export const isJsonValue = (value: unknown): value is JsonValue => {
	if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
	if (Array.isArray(value)) return value.every(isJsonValue)
	return isRecord(value) && Object.values(value).every(isJsonValue)
}
export const isJsonRecord = (value: unknown): value is Record<string, JsonValue> => isRecord(value) && Object.values(value).every(isJsonValue)
export const isNullableJsonRecord = (value: unknown): value is Record<string, JsonValue> | null => value === null || isJsonRecord(value)

export const isNetworkRecordValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['id']) &&
	isString(value['name']) &&
	isString(value['start_block']) &&
	isNullableString(value['indexed_block']) &&
	isNullableString(value['indexed_hash']) &&
	isNullableString(value['indexed_timestamp']) &&
	isNullableString(value['observed_block']) &&
	isNullableString(value['finalized_block']) &&
	isString(value['phase']) &&
	isNullableString(value['last_poll_at']) &&
	isNullableString(value['last_success_at']) &&
	typeof value['consecutive_failures'] === 'number' &&
	(value['last_reorg_at'] === undefined || isNullableString(value['last_reorg_at'])) &&
	(value['next_retry_at'] === undefined || isNullableString(value['next_retry_at'])) &&
	isNullableString(value['last_error']) &&
	isString(value['explorer_base_url'])

export const isAddressIdentityValue = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value['chainId'] === 'number' &&
	Number.isSafeInteger(value['chainId']) &&
	isString(value['address']) &&
	(value['label'] === undefined || isString(value['label'])) &&
	(value['kind'] === undefined || isString(value['kind']))

export const isChartRowValue = (value: unknown): boolean =>
	isRecord(value) && isString(value['timestamp']) && Object.values(value).every((item) => item === undefined || isJsonValue(item))

export const isAmmPriceValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['timestamp']) &&
	isString(value['block_number']) &&
	isString(value['conditional_yes_bps']) &&
	isString(value['conditional_no_bps']) &&
	isString(value['yes_reserve_atto_shares']) &&
	isString(value['no_reserve_atto_shares'])

export const isRepEthPriceValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['timestamp']) &&
	isString(value['block_number']) &&
	isString(value['event_name']) &&
	isNullableString(value['report_id']) &&
	isString(value['rep_per_eth_1e18']) &&
	isNullableString(value['settlement_timestamp'])

export const isUniswapPriceValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['timestamp']) &&
	isString(value['block_number']) &&
	isString(value['venue']) &&
	isString(value['market_id']) &&
	isString(value['contract_address']) &&
	isString(value['fee_hundredths_bip']) &&
	isString(value['quote_symbol']) &&
	isString(value['event_name']) &&
	isString(value['rep_per_eth_1e18']) &&
	(value['liquidity_value'] === undefined || isNullableString(value['liquidity_value']))

export const isArgumentDefinition = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value['index'] === 'number' &&
	Number.isInteger(value['index']) &&
	isString(value['name']) &&
	isString(value['type']) &&
	(value['indexed'] === undefined || typeof value['indexed'] === 'boolean')

export const isNullableArgumentDefinitions = (value: unknown): boolean => value === null || (Array.isArray(value) && value.every(isArgumentDefinition))

export const isActivityRecordValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['network_id']) &&
	isString(value['block_number']) &&
	isString(value['block_hash']) &&
	isString(value['block_timestamp']) &&
	typeof value['transaction_index'] === 'number' &&
	typeof value['log_index'] === 'number' &&
	isString(value['tx_hash']) &&
	isString(value['emitter_address']) &&
	isNullableString(value['contract_label']) &&
	isNullableString(value['contract_kind']) &&
	isNullableString(value['event_name']) &&
	isString(value['summary']) &&
	isString(value['decode_status']) &&
	typeof value['canonical'] === 'boolean' &&
	typeof value['finalized'] === 'boolean' &&
	Array.isArray(value['topics']) &&
	value['topics'].every(isString) &&
	isString(value['data']) &&
	isNullableJsonRecord(value['arguments']) &&
	isNullableJsonRecord(value['display_arguments']) &&
	isNullableArgumentDefinitions(value['argument_schema']) &&
	isNullableString(value['origin_address']) &&
	isString(value['explorer_base_url'])

export const isRelatedLogRecordValue = (value: unknown): boolean =>
	isRecord(value) &&
	typeof value['log_index'] === 'number' &&
	isString(value['emitter_address']) &&
	isNullableString(value['event_name']) &&
	isString(value['summary'])

export const isLogDetailValue = (value: unknown): boolean =>
	isActivityRecordValue(value) &&
	isRecord(value) &&
	isNullableString(value['to_address']) &&
	isString(value['value']) &&
	isString(value['input']) &&
	isString(value['gas_used']) &&
	isNullableString(value['contract_provenance']) &&
	isNullableString(value['event_signature']) &&
	isNullableString(value['function_signature']) &&
	isNullableString(value['action_summary']) &&
	isNullableJsonRecord(value['action_arguments']) &&
	isNullableJsonRecord(value['action_display_arguments']) &&
	isNullableArgumentDefinitions(value['action_argument_schema']) &&
	isJsonRecord(value['receipt']) &&
	Array.isArray(value['relatedLogs']) &&
	value['relatedLogs'].every(isRelatedLogRecordValue)

export const isAccountTransactionValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['tx_hash']) &&
	isString(value['block_hash']) &&
	isString(value['block_number']) &&
	isString(value['block_timestamp']) &&
	typeof value['transaction_index'] === 'number' &&
	isString(value['from_address']) &&
	isNullableString(value['to_address']) &&
	isNullableString(value['to_label']) &&
	isNullableString(value['to_kind']) &&
	isString(value['value']) &&
	isString(value['status']) &&
	isString(value['gas_used']) &&
	isNullableString(value['function_name']) &&
	isNullableString(value['function_signature']) &&
	isNullableString(value['action_summary']) &&
	isNullableJsonRecord(value['action_arguments']) &&
	isNullableJsonRecord(value['action_display_arguments']) &&
	isNullableArgumentDefinitions(value['action_argument_schema']) &&
	(value['roles'] === undefined || (Array.isArray(value['roles']) && value['roles'].every(isString))) &&
	(value['pool_addresses'] === undefined ||
		value['pool_addresses'] === null ||
		(Array.isArray(value['pool_addresses']) && value['pool_addresses'].every(isString))) &&
	isString(value['explorer_base_url'])

export const isTokenBalanceValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['address']) &&
	isString(value['balance']) &&
	(value['contractLabel'] === undefined || isNullableString(value['contractLabel'])) &&
	(value['name'] === undefined || isNullableString(value['name'])) &&
	(value['universeId'] === undefined || isNullableString(value['universeId'])) &&
	isNullableString(value['symbol']) &&
	(value['decimals'] === null || typeof value['decimals'] === 'number') &&
	isString(value['blockNumber'])

export const isPoolAssociationValue = (value: unknown): boolean =>
	isRecord(value) && isString(value['address']) && isNullableString(value['label']) && isNullableString(value['questionTitle'])

export const isVaultPositionValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['poolAddress']) &&
	isNullableString(value['questionTitle']) &&
	isString(value['repBackingUnits']) &&
	isStringOrNumber(value['capacityOwnershipAttoRep']) &&
	isStringOrNumber(value['claimableFeesAttoEth']) &&
	isString(value['blockNumber'])

export const isNativeBalanceDetailValue = (value: unknown): boolean => isRecord(value) && isString(value['balance']) && isString(value['blockNumber'])

export const isRichListRecordValue = (value: unknown): boolean =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['network_id']) &&
	isString(value['explorer_base_url']) &&
	isString(value['address']) &&
	isNullableString(value['label']) &&
	isNullableString(value['kind']) &&
	isStringOrNumber(value['transaction_count']) &&
	isStringOrNumber(value['interaction_count']) &&
	isStringOrNumber(value['pool_count']) &&
	isStringOrNumber(value['vault_count']) &&
	(value['active_vault_count'] === undefined || isStringOrNumber(value['active_vault_count'])) &&
	(value['weth_balance'] === undefined || isString(value['weth_balance'])) &&
	(value['native_balance'] === undefined || isString(value['native_balance'])) &&
	(value['sampled_native_count'] === undefined || isStringOrNumber(value['sampled_native_count'])) &&
	(value['sampled_rep_token_count'] === undefined || isStringOrNumber(value['sampled_rep_token_count'])) &&
	(value['rep_token_count'] === undefined || isStringOrNumber(value['rep_token_count'])) &&
	(value['sampled_weth_token_count'] === undefined || isStringOrNumber(value['sampled_weth_token_count'])) &&
	(value['weth_token_count'] === undefined || isStringOrNumber(value['weth_token_count'])) &&
	(value['oldest_balance_block'] === undefined || isNullableString(value['oldest_balance_block'])) &&
	(value['last_balance_refresh'] === undefined || isNullableString(value['last_balance_refresh'])) &&
	(value['rep_balances_truncated'] === undefined || typeof value['rep_balances_truncated'] === 'boolean') &&
	(value['weth_balances_truncated'] === undefined || typeof value['weth_balances_truncated'] === 'boolean') &&
	Array.isArray(value['rep_balances']) &&
	value['rep_balances'].every(isTokenBalanceValue) &&
	Array.isArray(value['weth_balances']) &&
	value['weth_balances'].every(isTokenBalanceValue) &&
	(value['native_balance_detail'] === null || isNativeBalanceDetailValue(value['native_balance_detail'])) &&
	Array.isArray(value['pool_associations']) &&
	value['pool_associations'].every(isPoolAssociationValue) &&
	Array.isArray(value['vault_positions']) &&
	value['vault_positions'].every(isVaultPositionValue) &&
	(value['escalation_claims'] === undefined || (Array.isArray(value['escalation_claims']) && value['escalation_claims'].every(isJsonRecord))) &&
	(value['auction_claims'] === undefined || (Array.isArray(value['auction_claims']) && value['auction_claims'].every(isJsonRecord)))

const hasStringFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => fields.every((field) => isString(value[field]))
const hasNullableStringFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => fields.every((field) => isNullableString(value[field]))
const hasOptionalNullableStringFields = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
	fields.every((field) => value[field] === undefined || isNullableString(value[field]))

export const isPoolStateEntityValue = (value: unknown): boolean =>
	isRecord(value) &&
	hasStringFields(value, [
		'chain_id',
		'network_id',
		'pool_address',
		'parent_address',
		'universe_id',
		'question_id',
		'truth_auction_address',
		'coordinator_address',
		'share_token_address',
		'security_multiplier_bps',
		'initial_priority_fee_atto_eth_per_gas',
		'initial_retention_rate',
		'initial_settlement_collateral_atto_eth',
		'vault_count',
		'child_count',
	]) &&
	hasNullableStringFields(value, [
		'question_title',
		'settlement_collateral_atto_eth',
		'total_capacity_ownership_atto_rep',
		'fee_eligible_capacity_ownership_atto_rep',
		'total_claimable_vault_fees_atto_eth',
		'unallocated_accrued_fees_atto_eth',
		'current_retention_rate',
		'snapshot_block',
	])

export const isVaultStateEntityValue = (value: unknown): boolean =>
	isRecord(value) &&
	hasStringFields(value, [
		'chain_id',
		'network_id',
		'pool_address',
		'vault_address',
		'rep_backing_units',
		'capacity_ownership_atto_rep',
		'claimable_fees_atto_eth',
		'fee_index',
		'vault_fee_remainder',
		'resulting_total_rep_backing_units',
		'resulting_fee_eligible_capacity_ownership_atto_rep',
		'block_number',
	]) &&
	isNullableString(value['question_title'])

export const isQuestionStateEntityValue = (value: unknown): boolean =>
	isRecord(value) &&
	hasStringFields(value, [
		'chain_id',
		'network_id',
		'question_id',
		'title',
		'description',
		'created_timestamp',
		'start_time',
		'end_time',
		'num_ticks',
		'display_value_min',
		'display_value_max',
		'answer_unit',
		'pool_count',
		'fork_count',
	]) &&
	Array.isArray(value['outcome_options']) &&
	value['outcome_options'].every(isString) &&
	(value['block_number'] === undefined || isString(value['block_number']))

export const isUniverseStateEntityValue = (value: unknown): boolean =>
	isRecord(value) &&
	hasStringFields(value, [
		'chain_id',
		'network_id',
		'universe_id',
		'parent_universe_id',
		'forking_outcome_index',
		'reputation_token_address',
		'theoretical_supply_atto_rep',
		'child_count',
		'pool_count',
	]) &&
	hasOptionalNullableStringFields(value, [
		'active_fork_question_id',
		'active_fork_time',
		'forker_address',
		'fork_threshold_atto_rep',
		'migration_rep_balance_atto_rep',
	])
