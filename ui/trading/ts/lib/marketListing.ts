import { bigintToSafeNumber } from '@zoltar/core-shared/evm/ethereum'
import { marketAcceptsNewRisk, type LiveMarket } from '../protocol/liveMarket.js'
import { attoSharesToCollateralAttoEth } from './shareValue.js'

/** Market-list chips. `all` keeps ended but unresolved markets reachable; the others narrow the loaded page. */
export type MarketFilter = 'all' | 'open' | 'closing-soon' | 'resolved'

export type MarketSort = 'closing-soon' | 'liquidity' | 'newest'

export type MarketListOptions = Readonly<{ filter: MarketFilter; query: string; sort: MarketSort }>

/** An open market whose question ends within this window counts as closing soon. */
const CLOSING_SOON_WINDOW_SECONDS = 7n * 24n * 60n * 60n

type OddsInputs = Pick<LiveMarket, 'loadError' | 'pair' | 'yesReserve' | 'noReserve'>

/** Conditional YES probability implied by the pair reserves, in tenths of a percent; undefined until the pair holds liquidity. */
export function marketYesTenths(market: OddsInputs) {
	if (market.loadError !== undefined || market.pair === undefined) return undefined
	const total = market.yesReserve + market.noReserve
	if (total === 0n) return undefined
	return bigintToSafeNumber((market.noReserve * 1_000n) / total, 'Conditional YES tenths')
}

/** Whole-percent YES / NO odds for compact displays; the two always add up to 100. */
export function marketOddsPercent(market: OddsInputs) {
	const tenths = marketYesTenths(market)
	if (tenths === undefined) return undefined
	const yes = Math.round(tenths / 10)
	return { yes, no: 100 - yes }
}

/**
 * Settlement-collateral value of the pair's reserves at the pair's own spot price. Valuing YES at p and NO at 1 - p
 * gives 2·Y·N / (Y + N) outcome-share pairs, which convert to collateral at the pool's current share rate.
 */
export function marketLiquidityAttoEth(market: Pick<LiveMarket, 'loadError' | 'pair' | 'yesReserve' | 'noReserve' | 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares'>) {
	if (market.loadError !== undefined || market.pair === undefined) return undefined
	const total = market.yesReserve + market.noReserve
	if (total === 0n) return 0n
	return attoSharesToCollateralAttoEth((2n * market.yesReserve * market.noReserve) / total, market)
}

type LifecycleInputs = Parameters<typeof marketAcceptsNewRisk>[0]

function marketIsResolved(market: LifecycleInputs) {
	if (market.loadError !== undefined) return false
	return market.questionOutcome !== 3 || market.tradingStatus === 5
}

function marketMatchesFilter(market: LifecycleInputs, filter: MarketFilter, nowSeconds: bigint) {
	if (filter === 'all') return true
	if (filter === 'resolved') return marketIsResolved(market)
	if (!marketAcceptsNewRisk(market, nowSeconds)) return false
	return filter === 'open' || market.endTime - nowSeconds <= CLOSING_SOON_WINDOW_SECONDS
}

/** Case-insensitive match over the question text and the addresses a user may paste. */
function marketMatchesSearch(market: Pick<LiveMarket, 'title' | 'description' | 'pool' | 'pair'>, query: string) {
	const terms = query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(term => term !== '')
	if (terms.length === 0) return true
	const haystack = [market.title, market.description, market.pool, market.pair ?? ''].join('\n').toLowerCase()
	return terms.every(term => haystack.includes(term))
}

function compareBigintAscending(left: bigint, right: bigint) {
	if (left === right) return 0
	return left < right ? -1 : 1
}

/** Markets that still take new risk come first, soonest end first; ended ones follow, most recently ended first. */
function compareClosingSoon(left: LiveMarket, right: LiveMarket, nowSeconds: bigint) {
	const leftOpen = left.loadError === undefined && marketAcceptsNewRisk(left, nowSeconds)
	const rightOpen = right.loadError === undefined && marketAcceptsNewRisk(right, nowSeconds)
	if (leftOpen !== rightOpen) return leftOpen ? -1 : 1
	if (left.loadError !== undefined || right.loadError !== undefined) return (left.loadError === undefined ? 0 : 1) - (right.loadError === undefined ? 0 : 1)
	return leftOpen ? compareBigintAscending(left.endTime, right.endTime) : compareBigintAscending(right.endTime, left.endTime)
}

function compareLiquidity(left: LiveMarket, right: LiveMarket) {
	const leftLiquidity = marketLiquidityAttoEth(left)
	const rightLiquidity = marketLiquidityAttoEth(right)
	if (leftLiquidity === undefined || rightLiquidity === undefined) return (leftLiquidity === undefined ? 1 : 0) - (rightLiquidity === undefined ? 1 : 0)
	return compareBigintAscending(rightLiquidity, leftLiquidity)
}

/**
 * Filters, searches, and sorts the loaded markets. Discovery returns pools in registration order, so `newest`
 * reverses that order; ties in every other sort keep the newest pool first.
 */
export function arrangeMarkets(markets: readonly LiveMarket[], options: MarketListOptions, nowSeconds: bigint) {
	const newestFirst = markets.map((market, registrationIndex) => ({ market, registrationIndex })).reverse()
	const matching = newestFirst.filter(({ market }) => marketMatchesFilter(market, options.filter, nowSeconds) && marketMatchesSearch(market, options.query))
	if (options.sort === 'newest') return matching.map(({ market }) => market)
	const compare = options.sort === 'liquidity' ? compareLiquidity : (left: LiveMarket, right: LiveMarket) => compareClosingSoon(left, right, nowSeconds)
	return matching.sort((left, right) => compare(left.market, right.market) || right.registrationIndex - left.registrationIndex).map(({ market }) => market)
}

export type CoarseDuration = Readonly<{ amount: bigint; unit: 'day' | 'hour' | 'minute' }>

/** The largest whole unit of a distance in time, for scan-friendly card metadata; the exact time sits beside it. */
export function coarseDuration(seconds: bigint): CoarseDuration {
	const magnitude = seconds < 0n ? -seconds : seconds
	if (magnitude >= 86_400n) return { amount: magnitude / 86_400n, unit: 'day' }
	if (magnitude >= 3_600n) return { amount: magnitude / 3_600n, unit: 'hour' }
	return { amount: magnitude / 60n, unit: 'minute' }
}
