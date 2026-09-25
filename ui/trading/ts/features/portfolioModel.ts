import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import { attoSharesToCollateralAttoEth } from '../lib/shareValue.js'
import { marketAcceptsNewRisk, settlementAvailability, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import type { PortfolioBalanceEntry } from './live/liveTradingTypes.js'

/** Open positions whose question ends within this window are listed as needing attention before trading closes. */
const TRADING_CLOSES_SOON_SECONDS = 7n * 24n * 60n * 60n

type PortfolioRowState = 'open' | 'closed' | 'resolved' | 'settlement-required' | 'unavailable'

/**
 * `exit` marks open or closed positions at what exiting through the pool would return now, after fees and price
 * impact; `redemption` values resolved positions at their winning-share payout. Settlement and failed reads have no
 * trustworthy price.
 */
export type PortfolioValuation = Readonly<{ kind: 'exit' | 'redemption'; attoEth: bigint }> | Readonly<{ kind: 'unavailable'; reason: 'settlement-required' | 'market-unavailable' | 'balance-unavailable' }>

type PortfolioActionKind = 'redeem' | 'settle' | 'withdraw-liquidity' | 'trading-closes'

export type PortfolioActionItem = Readonly<{ kind: PortfolioActionKind; pool: LiveMarket['pool']; title: string; deadline: bigint | undefined }>

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
	/** Every row's action items, dated ones first by deadline, then undated ones in row order. */
	actionItems: readonly PortfolioActionItem[]
}>

function minimum(...values: readonly bigint[]) {
	return values.reduce((smallest, value) => (value < smallest ? value : smallest))
}

/** YES and NO reserve shares the account's LP tokens would withdraw now. */
export function lpReserveClaims(market: Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'lpTotalSupply'>, lp: bigint) {
	if (market.lpTotalSupply === 0n || lp === 0n) return { yes: 0n, no: 0n }
	return { yes: (market.yesReserve * lp) / market.lpTotalSupply, no: (market.noReserve * lp) / market.lpTotalSupply }
}

/**
 * Complete-set equivalent the account could redeem by withdrawing its liquidity, redeeming the complete sets it
 * holds, and exiting the remaining insured long position through the pool at current reserves.
 */
function exitValueAttoShares(market: Pick<LiveMarket, 'yesReserve' | 'noReserve' | 'lpTotalSupply' | 'feeBps'>, balances: Pick<LiveBalances, 'yes' | 'no' | 'invalid' | 'lp'>) {
	const claims = lpReserveClaims(market, balances.lp)
	const yes = balances.yes + claims.yes
	const no = balances.no + claims.no
	const completeSets = minimum(balances.invalid, yes, no)
	const remainingInvalid = balances.invalid - completeSets
	const remainingYes = yes - completeSets
	const remainingNo = no - completeSets
	if (remainingInvalid === 0n) return completeSets
	const reserves = { yesReserve: market.yesReserve - claims.yes, noReserve: market.noReserve - claims.no, feeBps: market.feeBps }
	if (remainingYes > 0n) return completeSets + maximumInsuredExit({ longOutcome: 'YES', longBalance: remainingYes, invalidBalance: remainingInvalid, ...reserves })
	if (remainingNo > 0n) return completeSets + maximumInsuredExit({ longOutcome: 'NO', longBalance: remainingNo, invalidBalance: remainingInvalid, ...reserves })
	return completeSets
}

/** Winning shares, including the winning side of the account's LP claim, once the question has resolved. */
function winningAttoShares(market: Pick<LiveMarket, 'questionOutcome' | 'yesReserve' | 'noReserve' | 'lpTotalSupply'>, balances: Pick<LiveBalances, 'yes' | 'no' | 'invalid' | 'lp'>) {
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
	if (state === 'settlement-required') return { kind: 'unavailable', reason: 'settlement-required' }
	if (state === 'resolved') return { kind: 'redemption', attoEth: attoSharesToCollateralAttoEth(winningAttoShares(market, balances), market) }
	return { kind: 'exit', attoEth: attoSharesToCollateralAttoEth(exitValueAttoShares(market, balances), market) }
}

function portfolioRow(entry: PortfolioBalanceEntry, nowSeconds: bigint): PortfolioRow {
	const state = rowState(entry, nowSeconds)
	const valuation = rowValuation(entry, state)
	const { market, balances } = entry
	if (balances === undefined || state === 'unavailable') return { entry, state, valuation, canSell: false, canRedeem: false, actionItems: [] }
	const availability = settlementAvailability(market, balances)
	const pairTradable = market.pair !== undefined && market.yesReserve > 0n && market.noReserve > 0n
	const canSell = state === 'open' && pairTradable && (balances.yes > 0n || balances.no > 0n)
	// While trading is open, exits replace redemption; the settlement workspace opens once the market closes.
	const canRedeem = state !== 'open' && (availability.canRedeemWinningShares || availability.canRedeemCompleteSets)
	const item = (kind: PortfolioActionKind, deadline: bigint | undefined = undefined): PortfolioActionItem => ({ kind, pool: market.pool, title: market.title, deadline })
	const actionItems: PortfolioActionItem[] = []
	if (canRedeem) actionItems.push(item('redeem'))
	if (state === 'settlement-required' && availability.canMigrateShares) actionItems.push(item('settle'))
	if (state !== 'open' && balances.lp > 0n) actionItems.push(item('withdraw-liquidity'))
	if (state === 'open' && market.endTime > nowSeconds && market.endTime - nowSeconds <= TRADING_CLOSES_SOON_SECONDS && (balances.yes > 0n || balances.no > 0n || balances.lp > 0n)) actionItems.push(item('trading-closes', market.endTime))
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
	for (const row of rows) {
		if (row.valuation.kind === 'unavailable') unvaluedCount += 1
		else totalValueAttoEth += row.valuation.attoEth
	}
	// Array.prototype.sort is stable, so undated items keep row order.
	const actionItems = rows.flatMap(row => row.actionItems).sort(compareActionItems)
	return { rows, positionCount: rows.length, totalValueAttoEth, unvaluedCount, actionItems }
}
