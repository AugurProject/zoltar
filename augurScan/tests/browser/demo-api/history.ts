import { requiredArrayItem } from '../../../browser/api-decoding.ts'
import type { DemoContext } from '../../../browser/demo-runtime.ts'
import { demoAmmPriceHistory, demoDenseUniswapRepEthPriceHistory, demoRepEthPriceHistory, demoUniswapRepEthPriceHistory } from '../demo-fixtures.ts'
import { demoAddress, demoHash } from './chain-fixtures.ts'
import type { DemoEnvironment } from './environment.ts'

const historyPageSlice = <T>(records: readonly T[], split: number, offset: number) => (offset === 0 ? records.slice(split) : records.slice(0, split))
const demoDisplayedRepEthPrices = <T extends { rep_per_eth_1e18: string }>(priceDemo: string | null, repEthPrices: readonly T[], firstRepEthPrice: T): T[] => {
	if (priceDemo === 'constant-zero') return [{ ...firstRepEthPrice, rep_per_eth_1e18: '0' }]
	if (priceDemo === 'constant-nonzero') return [firstRepEthPrice]
	if (priceDemo === 'constant-repeated') return repEthPrices.slice(0, 3).map(price => ({ ...price, rep_per_eth_1e18: firstRepEthPrice.rep_per_eth_1e18 }))
	return [...repEthPrices]
}
const demoRetentionRate = (context: DemoContext, rate: string) => {
	const scenario = context.pageUrl.searchParams.get('retentionDemo')
	if (scenario === 'none') return (10n ** 18n).toString()
	if (scenario === 'full-fee') return '0'
	if (scenario === 'missing') return null
	return rate
}
const demoUniswapPrices = (priceDemo: string | null) => (priceDemo === 'eight' ? demoDenseUniswapRepEthPriceHistory() : demoUniswapRepEthPriceHistory())
const DEMO_OPEN_ORACLE_HISTORY = [
	{ event_name: 'ReportSubmitted', summary: 'REP/ETH report submitted' },
	{ event_name: 'ReportDisputed', summary: 'Replacement round accepted' },
	{ event_name: 'PriceReported', summary: 'Coordinator accepted the settled price' },
] as const
const demoSupplyEventName = (index: number) => {
	if (index === 0) return 'UniverseInitialized'
	return index === 4 ? 'UniverseForked' : 'MigrationRepAdded'
}
const demoSeries = (base: string, count = 12, variation = 0.32) =>
	Array.from({ length: count }, (_, index) => {
		const factor = 1 - variation + (variation * index) / Math.max(1, count - 1) + Math.sin(index * 1.4) * 0.025
		return String(BigInt(Math.max(1, Math.round(Number(base) * factor))))
	})
export const demoHistory = (env: DemoEnvironment, path: string) => {
	const { context } = env
	const { priceDemo } = env.settings
	const { mainnetDemoQuestion, demoPools, demoVaults, demoUniverses } = env.fixtures
	const request = new URL(path, location.origin)
	const parts = request.pathname.split('/')
	const type = parts[4]
	const offset = request.searchParams.has('cursor') ? 1000 : 0
	const historyMore = context.pageUrl.searchParams.get('stateHistoryMore') === '1'
	const pagedHistory = (history: Readonly<Record<string, unknown>>, seriesKeys: readonly string[]) => {
		const page: Record<string, unknown> = { ...history }
		for (const key of seriesKeys) {
			const records = Array.isArray(history[key]) ? history[key] : []
			const split = Math.max(1, Math.ceil(records.length / 2))
			page[key] = historyMore ? historyPageSlice(records, split, offset) : records
		}
		const series = Object.fromEntries(seriesKeys.map(key => [key, Array.isArray(page[key]) ? page[key].length : 0]))
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
		const poolItem = demoPools.find(item => item.pool_address === parts[6]) ?? requiredArrayItem(demoPools, 0, 'Default demo pool')
		const collateral = demoSeries(poolItem.settlement_collateral_atto_eth)
		const capacity = demoSeries(poolItem.total_capacity_ownership_atto_rep, 12, 0.4)
		const hasAmm = poolItem.question_id === mainnetDemoQuestion.question_id
		const hasRepEthPrices = poolItem !== requiredArrayItem(demoPools, 2, 'REP price demo pool')
		const repEthPrices = demoRepEthPriceHistory()
		const firstRepEthPrice = requiredArrayItem(repEthPrices, 0, 'Demo REP/ETH price')
		const displayedRepEthPrices = demoDisplayedRepEthPrices(priceDemo, repEthPrices, firstRepEthPrice)
		return pagedHistory(
			{
				snapshots: collateral.map((value, index) => ({
					timestamp: new Date(Date.now() - (11 - index) * 7 * 86_400_000).toISOString(),
					block_number: String(23100000 + index * 7700),
					settlement_collateral_atto_eth: value,
					total_capacity_ownership_atto_rep: requiredArrayItem(capacity, index, 'Demo capacity point'),
					total_claimable_vault_fees_atto_eth: String(BigInt(20 + index * 8) * 10n ** 16n),
					fee_index: context.pageUrl.searchParams.get('feeSeries') === 'missing' ? undefined : String(BigInt(index + 1) * 10n ** 16n),
					unallocated_accrued_fees_atto_eth: ['missing', 'partial'].includes(context.pageUrl.searchParams.get('feeSeries') ?? '') ? undefined : String(BigInt(index + 1) * 10n ** 15n),
					current_retention_rate: demoRetentionRate(context, poolItem.current_retention_rate),
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
				uniswapRepEthPrices: hasRepEthPrices ? demoUniswapPrices(priceDemo) : [],
				openOracleHistory: hasRepEthPrices
					? displayedRepEthPrices.slice(-3).map((price, index) => ({
							timestamp: price.timestamp,
							block_number: price.block_number,
							...DEMO_OPEN_ORACLE_HISTORY[Math.min(index, DEMO_OPEN_ORACLE_HISTORY.length - 1)],
							coordinator_address: poolItem.coordinator_address,
						}))
					: [],
			},
			['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory'],
		)
	}
	if (type === 'vaults') {
		const vaultItem = demoVaults.find(item => item.pool_address === parts[6] && item.vault_address === parts[7]) ?? requiredArrayItem(demoVaults, 0, 'Default demo vault')
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
		const universe = demoUniverses.find(item => item.universe_id === parts[6]) ?? requiredArrayItem(demoUniverses, 0, 'Default demo universe')
		const supply = Array.from({ length: 9 }, (_, index) => String((BigInt(universe.theoretical_supply_atto_rep) * BigInt(108 - index)) / 100n))
		return pagedHistory(
			{
				events: supply.map((value, index) => ({
					timestamp: new Date(Date.now() - (8 - index) * 12 * 86_400_000).toISOString(),
					block_number: String(23080000 + index * 11000),
					event_name: demoSupplyEventName(index),
					theoretical_supply_atto_rep: value,
				})),
			},
			['events'],
		)
	}
	return pagedHistory(
		{
			pools: demoPools
				.filter(item => item.question_id === parts[6])
				.map((item, index) => ({ ...item, escalation_address: demoAddress('7'), resolution_block: item.snapshot_block ?? '23184700', read_result: { questionResolution: '1', finalQuestionResolution: '1' }, timestamp: new Date(Date.now() - (50 - index * 12) * 86_400_000).toISOString() })),
			forks: [],
		},
		['pools', 'forks'],
	)
}

export async function demoStateHistoryRoute(env: DemoEnvironment, path: string): Promise<unknown> {
	const { context, counters } = env
	const { detailState } = env.settings
	counters.stateDetailRequests++
	const stateHistoryRequest = new URL(path, location.origin)
	const stateHistoryOffset = stateHistoryRequest.searchParams.has('cursor') ? 1000 : 0
	if (stateHistoryOffset > 0 && context.pageUrl.searchParams.get('stateHistoryAppendDelay') === '1') await new Promise(resolve => setTimeout(resolve, 2_500))
	if (stateHistoryOffset > 0 && context.pageUrl.searchParams.get('stateHistoryAppendError') === '1' && !counters.stateHistoryAppendErrorConsumed) {
		counters.stateHistoryAppendErrorConsumed = true
		throw new Error('Older state history could not be loaded')
	}
	if (detailState === 'error' && !counters.detailErrorConsumed) {
		counters.detailErrorConsumed = true
		throw new Error('Historical checkpoints could not be read')
	}
	if (detailState === 'refresh-error' && counters.stateDetailRequests === 2) throw new Error('The newest checkpoint could not be read')
	if (detailState === 'loading') return await new Promise(() => {})
	if (detailState === 'delayed') await new Promise(resolve => setTimeout(resolve, 800))
	return demoHistory(env, path)
}
