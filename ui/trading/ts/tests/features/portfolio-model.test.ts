import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import { lpReserveClaims, portfolioOverview } from '../../features/portfolioModel.js'
import type { PortfolioBalanceEntry } from '../../features/live/liveTradingTypes.js'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'

const SET = 10n ** 36n
const ETH = 10n ** 18n
const NOW = 1_000_000n
const WEEK = 7n * 24n * 60n * 60n
const pool: Address = `0x${'12'.repeat(20)}`
const secondPool: Address = `0x${'56'.repeat(20)}`
const shareToken: Address = `0x${'34'.repeat(20)}`
const pair: Address = `0x${'9a'.repeat(20)}`

// One complete set (10^36 attoShares) is backed by exactly 1 ETH in this fixture, so 10^18 attoShares are worth 1 attoETH.
const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Portfolio model market',
	description: 'Model fixture',
	endTime: NOW + 30n * 24n * 60n * 60n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 100n * SET,
	settlementCollateralAttoEth: 100n * ETH,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 1n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: undefined,
	questionOutcome: 3,
	yesReserve: 10n * SET,
	noReserve: 10n * SET,
	lpTotalSupply: 10n * SET,
}

type Amounts = Partial<Pick<LiveBalances, 'yes' | 'no' | 'invalid' | 'lp'>>

function entry(marketOverrides: Partial<LiveMarket>, amounts: Amounts): PortfolioBalanceEntry {
	return { market: { ...market, ...marketOverrides }, balances: { scope: { pool, shareToken, invalidTokenId: 1_792n, yesTokenId: 1_793n, noTokenId: 1_794n }, yes: 0n, no: 0n, invalid: 0n, lp: 0n, ...amounts }, error: undefined }
}

function row(value: PortfolioBalanceEntry) {
	const [first] = portfolioOverview([value], NOW).rows
	if (first === undefined) throw new Error('Portfolio row missing')
	return first
}

function valueOf(marketOverrides: Partial<LiveMarket>, amounts: Amounts) {
	return row(entry(marketOverrides, amounts)).valuation
}

describe('portfolio position value', () => {
	test('values complete sets at their backing and an insured long at its pool exit', () => {
		expect(valueOf({}, { yes: 2n * SET, no: 2n * SET, invalid: 2n * SET })).toEqual({ kind: 'exit', attoEth: 2n * ETH })
		const exitSets = maximumInsuredExit({ longOutcome: 'YES', longBalance: (3n * SET) / 2n, invalidBalance: SET, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
		expect(exitSets).toBeGreaterThan(0n)
		expect(exitSets).toBeLessThan(SET)
		expect(valueOf({}, { yes: (3n * SET) / 2n, invalid: SET })).toEqual({ kind: 'exit', attoEth: exitSets / ETH })
		expect(valueOf({}, { no: (3n * SET) / 2n, invalid: SET })).toEqual({ kind: 'exit', attoEth: exitSets / ETH })
		// A bare long share without INVALID insurance cannot be exited through the pool.
		expect(valueOf({}, { yes: SET })).toEqual({ kind: 'exit', attoEth: 0n })
	})

	test('includes LP reserve claims and exits against the reserves left after withdrawal', () => {
		expect(lpReserveClaims(market, 5n * SET)).toEqual({ yes: 5n * SET, no: 5n * SET })
		expect(lpReserveClaims({ ...market, lpTotalSupply: 0n }, 5n * SET)).toEqual({ yes: 0n, no: 0n })
		expect(valueOf({}, { lp: 5n * SET, invalid: 5n * SET })).toEqual({ kind: 'exit', attoEth: 5n * ETH })
		// Owning every LP token leaves no reserves to exit against, so only the complete sets count.
		expect(valueOf({}, { lp: 10n * SET, invalid: 12n * SET, yes: 2n * SET })).toEqual({ kind: 'exit', attoEth: 10n * ETH })
	})

	test('counts only winning shares, including the LP claim, after resolution', () => {
		const held = { yes: 3n * SET, no: SET, invalid: 2n * SET, lp: 5n * SET }
		expect(valueOf({ questionOutcome: 0 }, held)).toEqual({ kind: 'redemption', attoEth: 2n * ETH })
		expect(valueOf({ questionOutcome: 1 }, held)).toEqual({ kind: 'redemption', attoEth: 8n * ETH })
		expect(valueOf({ questionOutcome: 2 }, held)).toEqual({ kind: 'redemption', attoEth: 6n * ETH })
	})
})

describe('portfolio rows', () => {
	test('offers Sell on an open market and no redemption while trading is open', () => {
		const open = row(entry({}, { yes: 2n * SET, invalid: SET }))
		expect(open.state).toBe('open')
		expect(open.canSell).toBe(true)
		expect(open.canRedeem).toBe(false)
		expect(open.actionItems).toEqual([])
		expect(row(entry({ pair: undefined }, { yes: 2n * SET, invalid: SET })).canSell).toBe(false)
		expect(row(entry({}, { invalid: SET, lp: SET })).canSell).toBe(false)
	})

	test('flags open positions whose trading closes within a week, with the question end as the deadline', () => {
		const endTime = NOW + WEEK
		expect(row(entry({ endTime }, { no: SET, invalid: SET })).actionItems).toEqual([{ kind: 'trading-closes', pool, title: market.title, deadline: endTime }])
		expect(row(entry({ endTime: endTime + 1n }, { no: SET, invalid: SET })).actionItems).toEqual([])
		// INVALID alone cannot be sold, so its closing is not an action.
		expect(row(entry({ endTime }, { invalid: SET })).actionItems).toEqual([])
	})

	test('redeems winning shares after resolution and asks LPs to withdraw', () => {
		const resolved = row(entry({ questionOutcome: 1 }, { yes: 3n * SET, invalid: SET, lp: SET }))
		expect(resolved.state).toBe('resolved')
		expect(resolved.canSell).toBe(false)
		expect(resolved.canRedeem).toBe(true)
		expect(resolved.valuation).toEqual({ kind: 'redemption', attoEth: 4n * ETH })
		expect(resolved.actionItems.map(item => item.kind)).toEqual(['redeem', 'withdraw-liquidity'])
		const lost = row(entry({ questionOutcome: 2 }, { yes: 3n * SET, invalid: SET }))
		expect(lost.valuation).toEqual({ kind: 'redemption', attoEth: 0n })
		expect(lost.canRedeem).toBe(false)
		expect(lost.actionItems).toEqual([])
	})

	test('redeems complete sets once an unresolved market has closed', () => {
		const closed = row(entry({ endTime: NOW - 1n }, { yes: SET, no: SET, invalid: SET }))
		expect(closed.state).toBe('closed')
		expect(closed.canSell).toBe(false)
		expect(closed.canRedeem).toBe(true)
		expect(closed.valuation).toEqual({ kind: 'exit', attoEth: ETH })
		expect(closed.actionItems.map(item => item.kind)).toEqual(['redeem'])
	})

	test('asks for settlement after a fork and leaves the position unvalued', () => {
		const forked = row(entry({ universeForkTime: NOW - 10n, systemState: 1 }, { yes: SET, invalid: SET }))
		expect(forked.state).toBe('settlement-required')
		expect(forked.valuation).toEqual({ kind: 'unavailable', reason: 'settlement-required' })
		expect(forked.canSell).toBe(false)
		expect(forked.canRedeem).toBe(false)
		expect(forked.actionItems.map(item => item.kind)).toEqual(['settle'])
	})

	test('marks unreadable balances and markets unavailable without actions', () => {
		const failedBalance = row({ market, balances: undefined, error: 'RPC unavailable' })
		expect(failedBalance.state).toBe('unavailable')
		expect(failedBalance.valuation).toEqual({ kind: 'unavailable', reason: 'balance-unavailable' })
		expect(failedBalance.actionItems).toEqual([])
		const failedMarket = row(entry({ loadError: 'pool RPC failed' }, { yes: SET }))
		expect(failedMarket.valuation).toEqual({ kind: 'unavailable', reason: 'market-unavailable' })
		expect(failedMarket.canSell).toBe(false)
	})
})

describe('portfolio overview', () => {
	test('totals valued positions, counts unvalued ones, and lists dated action items first', () => {
		const overview = portfolioOverview([entry({ questionOutcome: 1, title: 'Resolved' }, { yes: 2n * SET }), entry({ pool: secondPool, title: 'Closing', endTime: NOW + 60n }, { yes: SET, no: SET, invalid: SET }), entry({ title: 'Forked', universeForkTime: 1n, systemState: 1 }, { yes: SET })], NOW)
		expect(overview.positionCount).toBe(3)
		expect(overview.totalValueAttoEth).toBe(3n * ETH)
		expect(overview.unvaluedCount).toBe(1)
		expect(overview.actionItems.map(item => [item.kind, item.title])).toEqual([
			['trading-closes', 'Closing'],
			['redeem', 'Resolved'],
			['settle', 'Forked'],
		])
		expect(portfolioOverview([], NOW)).toEqual({ rows: [], positionCount: 0, totalValueAttoEth: 0n, unvaluedCount: 0, actionItems: [] })
	})
})
