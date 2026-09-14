import {
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
} from './api-validation.ts'

import {
	type AccountTransaction,
	type ActivityRecord,
	type AddressIdentity,
	type ChartRow,
	type ContractRecord,
	type EntityHistory,
	type ItemsPage,
	type LogDetail,
	type NetworkRecord,
	type NetworkResponse,
	type PoolRecord,
	type PoolStateRecord,
	type QuestionRecord,
	type RichListRecord,
	type StateCatalog,
	type UniverseRecord,
	type VaultRecord,
} from './browser-types.ts'

import type { AmmPriceHistoryRecord, RepEthPriceHistoryRecord } from './browser-types.ts'
import type { UniswapPriceObservation } from './chart-values.ts'

export const requiredArrayItem = <T>(items: readonly T[], index: number, label: string): T => {
	const item = items[index]
	if (item === undefined) throw new Error(`${label} is missing`)
	return item
}

const isBooleanRecord = (value: unknown): value is Record<string, boolean> => isRecord(value) && Object.values(value).every(item => typeof item === 'boolean')

const isNetworkRecord = (value: unknown): value is NetworkRecord => isNetworkRecordValue(value)

export const isActivityRecord = (value: unknown): value is ActivityRecord => isActivityRecordValue(value)

export const isContractRecord = (value: unknown): value is ContractRecord =>
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

export const isRichListRecord = (value: unknown): value is RichListRecord => isRichListRecordValue(value)

export const isAccountTransaction = (value: unknown): value is AccountTransaction => isAccountTransactionValue(value)

export const decodeItemsPage = <T>(value: unknown, itemGuard: (item: unknown) => item is T, label: string): ItemsPage<T> => {
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

export const decodeNetworkResponse = (value: unknown): NetworkResponse => {
	const page = decodeItemsPage(value, isNetworkRecord, 'Network status')
	if (!isRecord(value)) throw new Error('Network status response is malformed')
	const serverTime = value['serverTime']
	const freshnessThresholdMs = value['freshnessThresholdMs']
	const clientClockOffsetMs = value['clientClockOffsetMs']
	const writtenAt = value['writtenAt']
	if (serverTime !== undefined && !isString(serverTime)) throw new Error('Network server time is malformed')
	if (freshnessThresholdMs !== undefined && (typeof freshnessThresholdMs !== 'number' || !Number.isFinite(freshnessThresholdMs) || freshnessThresholdMs <= 0)) throw new Error('Network freshness threshold is malformed')
	if (clientClockOffsetMs !== undefined && (typeof clientClockOffsetMs !== 'number' || !Number.isFinite(clientClockOffsetMs))) throw new Error('Network client clock offset is malformed')
	if (writtenAt !== undefined && (typeof writtenAt !== 'number' || !Number.isFinite(writtenAt))) throw new Error('Network snapshot write time is malformed')
	return {
		...page,
		...(serverTime === undefined ? {} : { serverTime }),
		...(freshnessThresholdMs === undefined ? {} : { freshnessThresholdMs }),
		...(clientClockOffsetMs === undefined ? {} : { clientClockOffsetMs }),
		...(writtenAt === undefined ? {} : { writtenAt }),
	}
}

export const decodeValue = <T>(value: unknown, guard: (candidate: unknown) => candidate is T, label: string): T => {
	if (!guard(value)) throw new Error(`${label} response is malformed`)
	return value
}

export const isAddressIdentity = (value: unknown): value is AddressIdentity => isAddressIdentityValue(value)

export const isLogDetail = (value: unknown): value is LogDetail => isLogDetailValue(value)

const isPoolRecord = (value: unknown): value is PoolRecord => isPoolStateEntityValue(value)

const isVaultRecord = (value: unknown): value is VaultRecord => isVaultStateEntityValue(value)

const isQuestionRecord = (value: unknown): value is QuestionRecord => isQuestionStateEntityValue(value)

const isUniverseRecord = (value: unknown): value is UniverseRecord => isUniverseStateEntityValue(value)

const isPoolStateRecord = (value: unknown): value is PoolStateRecord =>
	isRecord(value) &&
	isString(value['chain_id']) &&
	isString(value['pool_address']) &&
	isString(value['event_name']) &&
	isRecord(value['state']) &&
	Object.values(value['state']).every(isJsonValue) &&
	(value['block_number'] === undefined || isString(value['block_number'])) &&
	(value['log_index'] === undefined || typeof value['log_index'] === 'number')

export const decodeStateCatalog = (value: unknown): StateCatalog => {
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
	if (totals !== undefined && (!isRecord(totals) || !['pools', 'questions', 'vaults', 'universes'].every(key => typeof totals[key] === 'number' && Number.isSafeInteger(totals[key]) && Number(totals[key]) >= 0))) throw new Error('State catalog totals are malformed')
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

const isAmmPrice = (value: unknown): value is AmmPriceHistoryRecord => isAmmPriceValue(value)

const isRepEthPrice = (value: unknown): value is RepEthPriceHistoryRecord => isRepEthPriceValue(value)

const isUniswapPrice = (value: unknown): value is UniswapPriceObservation => isUniswapPriceValue(value)

export const decodeEntityHistory = (value: unknown): EntityHistory => {
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
	if (market !== undefined && market !== null && (!isRecord(market) || (market['pair_address'] !== undefined && !isNullableString(market['pair_address'])) || (market['fee_bps'] !== undefined && market['fee_bps'] !== null && typeof market['fee_bps'] !== 'string' && typeof market['fee_bps'] !== 'number')))
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
