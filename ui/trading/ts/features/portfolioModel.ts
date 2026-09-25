import { quoteExactOutput } from '@zoltar/trading-shared/trading/math'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import { attoSharesToCollateralAttoEth } from '../lib/shareValue.js'
import { marketAcceptsNewRisk, settlementAvailability, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import type { PortfolioBalanceEntry } from './live/liveTradingTypes.js'

/** Open positions whose question ends within this window are listed as needing attention before trading closes. */
const TRADING_CLOSES_SOON_SECONDS = 7n * 24n * 60n * 60n

/** Leftover shares backed by less than the smallest displayed ETH amount are rounding dust, not a pending payout. */
const DISPLAY_DUST_ATTO_ETH = 10n ** 14n

type PortfolioRowState = 'open' | 'closed' | 'resolved' | 'settlement-required' | 'unavailable'

/**
 * `exit` marks an open position at what exiting through the pool would return now, after fees and price impact.
 * `complete-sets` values a closed, unresolved position at the complete sets it can redeem now (pool swaps stop when
 * trading closes). For both, `pendingResolution` marks shares that neither path can turn into ETH before the question
 * resolves, such as INVALID left after an exit or a long share without INVALID insurance; they are not in the value.
 * `redemption` values a resolved position at its winning-share payout. Settlement and failed reads have no price.
 */
export type PortfolioValuation =
	| Readonly<{ kind: 'exit'; attoEth: bigint; pendingResolution: boolean }>
	| Readonly<{ kind: 'complete-sets'; attoEth: bigint; pendingResolution: boolean }>
	| Readonly<{ kind: 'redemption'; attoEth: bigint }>
	| Readonly<{ kind: 'unavailable'; reason: 'settlement-required' | 'pool-inactive' | 'market-unavailable' | 'balance-unavailable' }>

/** Why the item needs attention, which the list shows as its badge. */
type PortfolioActionKind = 'redeem' | 'settle' | 'withdraw-liquidity' | 'trading-closes'

/** What the item's link does. */
type PortfolioAction = 'sell' | 'redeem' | 'settle' | 'withdraw-liquidity'

export type PortfolioActionItem = Readonly<{ kind: PortfolioActionKind; action: PortfolioAction; pool: LiveMarket['pool']; title: string; deadline: bigint | undefined }>

export type PortfolioRow = Readonly<{
	entry: PortfolioBalanceEntry
	state: PortfolioRowState
	valuation: PortfolioValuation
	canSell: boolean
	canRedeem: boolean
	actionItems: readonly PortfolioActionItem[]
}>

export type PortfolioOverview = Readonly<{
	rows: readonly PortfolioRow[]
	positionCount: number
	totalValueAttoEth: bigint
	/** Rows left out of the total because they have no trustworthy value yet. */
	unvaluedCount: number
	/** Rows with shares left out of the total until the question resolves. */
	pendingResolutionCount: number
	/** Every row's action items, dated ones first by deadline, then undated ones in row order. */
	actionItems: readonly PortfolioActionItem[]
}>

type Holdings = Pick<LiveBalances, 'yes' | 'no' | 'invalid' | 'lp'>

function minimum(...values: readonly bigint[]) {
	return values.reduce((smallest, value) => (value < smallest ? value : smallest))
}

/** YES and NO reserve shares the account's LP tokens would withdraw now. */
export function lpReserveClaims(market: Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'lpTotalSupply'>, lp: bigint) {
	if (market.lpTotalSupply === 0n || lp === 0n) return { yes: 0n, no: 0n }
	return { yes: (market.yesReserve * lp) / market.lpTotalSupply, no: (market.noReserve * lp) / market.lpTotalSupply }
}

/** Complete sets the account holds once its liquidity is withdrawn, and the shares left over. */
function completeSetSplit(market: Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'lpTotalSupply'>, balances: Holdings) {
	const claims = lpReserveClaims(market, balances.lp)
	const yes = balances.yes + claims.yes
	const no = balances.no + claims.no
	const completeSets = minimum(balances.invalid, yes, no)
	return { claims, completeSets, remainingInvalid: balances.invalid - completeSets, remainingYes: yes - completeSets, remainingNo: no - completeSets }
}

/**
 * Complete sets the account could redeem by withdrawing its liquidity, redeeming the complete sets it holds, and
 * exiting the remaining insured long position through the pool at the reserves left after withdrawal, plus the
 * shares that path leaves behind.
 */
function exitPosition(market: Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'lpTotalSupply' | 'feeBps'>, balances: Holdings) {
	const { claims, completeSets, remainingInvalid, remainingYes, remainingNo } = completeSetSplit(market, balances)
	const yesReserve = market.yesReserve - claims.yes
	const noReserve = market.noReserve - claims.no
	const longOutcome = remainingYes > 0n ? 'YES' : 'NO'
	const remainingLong = longOutcome === 'YES' ? remainingYes : remainingNo
	let exitedSets = 0n
	let longUsed = 0n
	if (remainingInvalid > 0n && remainingLong > 0n) {
		exitedSets = maximumInsuredExit({ longOutcome, longBalance: remainingLong, invalidBalance: remainingInvalid, yesReserve, noReserve, feeBps: market.feeBps })
		if (exitedSets > 0n) longUsed = exitedSets + (longOutcome === 'YES' ? quoteExactOutput(yesReserve, noReserve, exitedSets, market.feeBps) : quoteExactOutput(noReserve, yesReserve, exitedSets, market.feeBps)).amountIn
	}
	const leftover = [remainingInvalid - exitedSets, remainingYes - (longOutcome === 'YES' ? longUsed : 0n), remainingNo - (longOutcome === 'NO' ? longUsed : 0n)]
	return { sets: completeSets + exitedSets, leftover }
}

function hasPendingShares(leftover: readonly bigint[], market: Pick<LiveMarket, 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares'>) {
	return leftover.some(amount => amount > 0n && attoSharesToCollateralAttoEth(amount, market) >= DISPLAY_DUST_ATTO_ETH)
}

/** Winning shares, including the winning side of the account's LP claim, once the question has resolved. */
function winningAttoShares(market: Pick<LiveMarket, 'questionOutcome' | 'yesReserve' | 'noReserve' | 'lpTotalSupply'>, balances: Holdings) {
	const claims = lpReserveClaims(market, balances.lp)
	if (market.questionOutcome === 0) return balances.invalid
	if (market.questionOutcome === 1) return balances.yes + claims.yes
	if (market.questionOutcome === 2) return balances.no + claims.no
	return 0n
}

function rowState(entry: PortfolioBalanceEntry, nowSeconds: bigint): PortfolioRowState {
	const { market } = entry
	if (entry.error !== undefined || entry.balances === undefined || market.loadError !== undefined) return 'unavailable'
	if (market.universeForkTime !== 0n || market.systemState !== 0) return 'settlement-required'
	if (market.questionOutcome !== 3) return 'resolved'
	return marketAcceptsNewRisk(market, nowSeconds) ? 'open' : 'closed'
}

function rowValuation(entry: PortfolioBalanceEntry, state: PortfolioRowState): PortfolioValuation {
	const { market, balances } = entry
	if (market.loadError !== undefined) return { kind: 'unavailable', reason: 'market-unavailable' }
	if (balances === undefined || entry.error !== undefined) return { kind: 'unavailable', reason: 'balance-unavailable' }
	if (state === 'settlement-required') return { kind: 'unavailable', reason: market.universeForkTime === 0n ? 'pool-inactive' : 'settlement-required' }
	if (state === 'resolved') return { kind: 'redemption', attoEth: attoSharesToCollateralAttoEth(winningAttoShares(market, balances), market) }
	if (state === 'closed') {
		const { completeSets, remainingInvalid, remainingYes, remainingNo } = completeSetSplit(market, balances)
		return { kind: 'complete-sets', attoEth: attoSharesToCollateralAttoEth(completeSets, market), pendingResolution: hasPendingShares([remainingInvalid, remainingYes, remainingNo], market) }
	}
	const exit = exitPosition(market, balances)
	return { kind: 'exit', attoEth: attoSharesToCollateralAttoEth(exit.sets, market), pendingResolution: hasPendingShares(exit.leftover, market) }
}

function portfolioRow(entry: PortfolioBalanceEntry, nowSeconds: bigint): PortfolioRow {
	const state = rowState(entry, nowSeconds)
	const valuation = rowValuation(entry, state)
	const { market, balances } = entry
	if (balances === undefined || state === 'unavailable') return { entry, state, valuation, canSell: false, canRedeem: false, actionItems: [] }
	const availability = settlementAvailability(market, balances)
	const pairTradable = market.pair !== undefined && market.yesReserve > 0n && market.noReserve > 0n
	// Exits pair a long share with INVALID insurance, so a bare YES or NO holding has nothing the ticket can sell.
	const holdsInsuredLong = (balances.yes > 0n || balances.no > 0n) && balances.invalid > 0n
	const canSell = state === 'open' && pairTradable && holdsInsuredLong
	// While trading is open, exits replace redemption; the settlement workspace opens once the market closes.
	const canRedeem = state !== 'open' && (availability.canRedeemWinningShares || availability.canRedeemCompleteSets)
	const item = (kind: PortfolioActionKind, action: PortfolioAction, deadline: bigint | undefined = undefined): PortfolioActionItem => ({ kind, action, pool: market.pool, title: market.title, deadline })
	const actionItems: PortfolioActionItem[] = []
	if (canRedeem) actionItems.push(item('redeem', 'redeem'))
	if (state === 'settlement-required' && availability.canMigrateShares) actionItems.push(item('settle', 'settle'))
	if (state !== 'open' && balances.lp > 0n) actionItems.push(item('withdraw-liquidity', 'withdraw-liquidity'))
	const closesSoon = state === 'open' && market.endTime > nowSeconds && market.endTime - nowSeconds <= TRADING_CLOSES_SOON_SECONDS
	if (closesSoon && canSell) actionItems.push(item('trading-closes', 'sell', market.endTime))
	else if (closesSoon && balances.lp > 0n) actionItems.push(item('trading-closes', 'withdraw-liquidity', market.endTime))
	return { entry, state, valuation, canSell, canRedeem, actionItems }
}

function compareActionItems(left: PortfolioActionItem, right: PortfolioActionItem) {
	if (left.deadline === undefined || right.deadline === undefined) {
		if (left.deadline === right.deadline) return 0
		return left.deadline === undefined ? 1 : -1
	}
	if (left.deadline === right.deadline) return 0
	return left.deadline < right.deadline ? -1 : 1
}

export function portfolioOverview(entries: readonly PortfolioBalanceEntry[], nowSeconds: bigint): PortfolioOverview {
	const rows = entries.map(entry => portfolioRow(entry, nowSeconds))
	let totalValueAttoEth = 0n
	let unvaluedCount = 0
	let pendingResolutionCount = 0
	for (const row of rows) {
		if (row.valuation.kind === 'unavailable') unvaluedCount += 1
		else totalValueAttoEth += row.valuation.attoEth
		if ((row.valuation.kind === 'exit' || row.valuation.kind === 'complete-sets') && row.valuation.pendingResolution) pendingResolutionCount += 1
	}
	// Array.prototype.sort is stable, so undated items keep row order.
	const actionItems = rows.flatMap(row => row.actionItems).sort(compareActionItems)
	return { rows, positionCount: rows.length, totalValueAttoEth, unvaluedCount, pendingResolutionCount, actionItems }
}
