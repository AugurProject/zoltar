import { requiredArrayItem } from '../../../browser/api-decoding.ts'
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
	const requestedCollateral = context.pageUrl.searchParams.get('collateral')
	const decimals = requestedCollateral === 'USDC' || requestedCollateral === 'USDT' ? 6 : 18
	const collateralScale = 10n ** BigInt(18 - decimals)
	const { priceDemo } = env.settings
	const { mainnetDemoQuestion, demoPools, demoUniverses } = env.fixtures
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
		const shareSupply = demoSeries(poolItem.share_token_supply_atto_shares, 12, 0.3)
		const hasAmm = poolItem.question_id === mainnetDemoQuestion.question_id
		const hasRepEthPrices = poolItem !== requiredArrayItem(demoPools, 2, 'REP price demo pool')
		const repEthPrices = demoRepEthPriceHistory().map(price => ({ ...price, rep_per_eth_1e18: String(BigInt(price.rep_per_eth_1e18) * collateralScale) }))
		const firstRepEthPrice = requiredArrayItem(repEthPrices, 0, 'Demo REP/ETH price')
		const displayedRepEthPrices = demoDisplayedRepEthPrices(priceDemo, repEthPrices, firstRepEthPrice)
		return pagedHistory(
			{
				snapshots: collateral.map((value, index) => ({
					timestamp: new Date(Date.now() - (11 - index) * 7 * 86_400_000).toISOString(),
					block_number: String(23100000 + index * 7700),
					settlement_collateral_atto_eth: value,
					reason: index === 0 ? 5 : 0,
					share_token_supply_atto_shares: requiredArrayItem(shareSupply, index, 'Demo share supply point'),
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
							summary: index === 0 ? `REP/${poolItem.collateral?.symbol ?? 'WETH'} report submitted` : DEMO_OPEN_ORACLE_HISTORY[Math.min(index, DEMO_OPEN_ORACLE_HISTORY.length - 1)]?.summary,
							coordinator_address: poolItem.coordinator_address,
						}))
					: [],
			},
			['snapshots', 'events', 'ammPrices', 'repEthPrices', 'uniswapRepEthPrices', 'openOracleHistory'],
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
