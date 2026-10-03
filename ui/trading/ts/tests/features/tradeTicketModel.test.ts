import { describe, expect, test } from 'bun:test'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { quoteEnterPosition } from '@zoltar/trading-shared/trading/positions'
import { authoritativeQuoteMoved, buyReturn, holdingAfterTrade, poolFeeAttoEth, ticketInputsAfterSelection, tradeTicketModel, type TicketInputs, type TradeTicketInputs } from '../../features/live/tradeTicketModel.js'
import { shareBalanceScope, type LiveBalances } from '../../protocol/live.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { MINIMUM_SLIPPAGE_BPS } from '../../protocol/tradeQuote.js'
import * as ticketCopy from '../../copy/tradeTicket.js'
import * as availabilityCopy from '../../copy/availability.js'
import { ETH_GAS_RESERVE_ATTO_ETH } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { liveMarketFixture, ticketEstimateFor, ticketModelFor } from '../support/liveMarketFixture.js'

const eth = 10n ** 18n
const shares = 10n ** 18n

// One ETH mints one complete set; the pool holds 100 YES and 100 NO.
const market = liveMarketFixture()
const balances: LiveBalances = { scope: shareBalanceScope(market), yes: 10n * shares, no: 0n, invalid: 2n * shares, lp: 0n }

const ready: TradeTicketInputs = {
	market,
	mode: 'entry',
	side: 'YES',
	amount: '1',
	amountSettling: false,
	settings: DEFAULT_TRADE_SETTINGS,
	balances,
	balanceState: 'ready',
	walletConnected: true,
	networkMismatchReason: undefined,
	walletEthAttoEth: 5n * eth,
	marketClosed: false,
	nowSeconds: 1n,
	acknowledgedImpactBps: undefined,
	workflowLocked: false,
}

function feeTicketMarket(timestamp: bigint, currentRetentionRate: bigint, feeEndTime: bigint) {
	return {
		...market,
		currentRetentionRate,
		valuation: {
			timestamp,
			feeEndTime,
			projectedCollateralAttoEth: eth,
			feeAccounting: {
				settlementCollateralAttoEth: eth,
				totalUnderwritingLimitAttoEth: eth,
				feeEligibleUnderwritingLimitAttoEth: eth,
				currentRetentionRate,
				lastUpdatedFeeAccumulator: timestamp,
				feeIndexRemainder: 0n,
				totalFeesOwedRemainder: 0n,
			},
		},
	}
}

describe('trade ticket estimate', () => {
	test('blocks last-second and60-second market windows, allowing61seconds', () => {
		for (const remaining of [1n, 60n, 61n]) {
			const endingMarket = { ...market, endTime: 100n + remaining }
			const ending = tradeTicketModel({ ...ready, market: endingMarket, ...{ nowSeconds: 100n } })
			expect(ending.availability.disabled).toBe(remaining <= 60n)
		}
	})

	test('blocks a sell whose approved ETH minimum cannot cover holding fees through validity', () => {
		// About 0.12% of collateral accrues as fees over the 20-minute validity: more than the minimum tolerance, less than the default.
		const feeMarket = feeTicketMarket(2n, 999_999_000_000_000_000n, 1_000_000n)
		const result = tradeTicketModel({ ...ready, market: feeMarket, mode: 'exit', amount: '0.01', settings: { slippageBps: MINIMUM_SLIPPAGE_BPS, validityMinutes: 20n } })
		expect(result.availability.disabled).toBe(true)
		expect(result.availability.reason).toContain('Holding fees')
		const protectedResult = tradeTicketModel({ ...ready, market: feeMarket, mode: 'exit', amount: '0.01' })
		expect(protectedResult.availability.disabled).toBe(false)
	})

	test('covers holding fees through validity measured from the current ticket clock', () => {
		const feeMarket = feeTicketMarket(2n, 999_999_000_000_000_000n, 20_000n)
		const result = tradeTicketModel({ ...ready, market: feeMarket, mode: 'exit', amount: '0.01', nowSeconds: 10_000n })
		expect(result.availability.reason).toBe(availabilityCopy.holdingFeesBoundsReason)
	})

	test('caps sell fee coverage before the question closes', () => {
		const feeMarket = { ...feeTicketMarket(100n, 999_990_000_000_000_000n, 20_000n), endTime: 200n }
		const result = tradeTicketModel({ ...ready, market: feeMarket, mode: 'exit', amount: '0.01', nowSeconds: 100n })
		expect(result.availability.disabled).toBe(false)
	})

	test('prices a buy locally with the router math and the slippage minimum', () => {
		const estimate = ticketEstimateFor(market, 'entry', '1')
		if (estimate.kind !== 'entry') throw new Error('Expected a buy estimate')
		expect(estimate.quote).toEqual(quoteEnterPosition('YES', shares, market))
		expect(estimate.minimumLongShares).toBe((estimate.quote.totalLongShares * 9_950n) / 10_000n)
		// Half the position is swapped against a 100-share pool: about 1% worse on that half, 0.5% overall.
		expect(estimate.impactBps).toBeGreaterThan(40n)
		expect(estimate.impactBps).toBeLessThan(60n)
		expect(estimate.quote.conditionalYesBpsAfter).toBeGreaterThan(estimate.quote.conditionalYesBpsBefore)
	})

	test('sells at most the requested shares and pays the complete-set value', () => {
		const estimate = ticketEstimateFor(market, 'exit', '2', { ...balances, invalid: 10n * shares })
		if (estimate.kind !== 'exit') throw new Error('Expected a sell estimate')
		expect(estimate.quote.totalLongShares).toBeLessThanOrEqual(2n * shares)
		expect(estimate.receiveAttoEth).toBe(estimate.quote.completeSetShares)
		expect(estimate.minimumAttoEth).toBe((estimate.receiveAttoEth * 9_950n) / 10_000n)
		expect(estimate.maximumLongShares).toBeLessThanOrEqual(balances.yes)
		expect(estimate.quote.conditionalYesBpsAfter).toBeLessThan(estimate.quote.conditionalYesBpsBefore)
	})

	test('reports the profit a buy makes if its outcome wins, the fee in ETH, and the holding after the trade', () => {
		const buy = ticketEstimateFor(market, 'entry', '1')
		if (buy.kind !== 'entry') throw new Error('Expected a buy estimate')
		const { payoutAttoEth, profitAttoEth, returnBps } = buyReturn(buy, market)
		// One ETH backs one share here, so the payout is the Yes received and the profit is what it exceeds the ETH paid by.
		expect(payoutAttoEth).toBe(buy.quote.totalLongShares)
		expect(profitAttoEth).toBe(buy.quote.totalLongShares - eth)
		expect(returnBps).toBe((profitAttoEth * 10_000n) / eth)
		// A buy pays the fee in the opposite outcome, priced at 50% before the trade.
		expect(poolFeeAttoEth(buy, market)).toBe(buy.quote.feeAmount / 2n)
		expect(holdingAfterTrade(buy, balances)).toBe(balances.yes + buy.quote.totalLongShares)
		expect(holdingAfterTrade(buy, undefined)).toBeUndefined()
		const sell = ticketEstimateFor(market, 'exit', '2', { ...balances, invalid: 10n * shares })
		expect(poolFeeAttoEth(sell, market)).toBe(sell.quote.feeAmount / 2n)
		expect(holdingAfterTrade(sell, balances)).toBe(balances.yes - sell.quote.totalLongShares)
		// A sale above the holding leaves nothing to report.
		expect(holdingAfterTrade(sell, { ...balances, yes: shares })).toBeUndefined()
	})

	test('reports amounts too small to trade instead of an estimate', () => {
		const expensive = liveMarketFixture({ shareTokenSupplyAttoShares: 1n, settlementCollateralAttoEth: eth })
		expect(ticketModelFor(expensive, 'entry', '0.000000000000000001')).toMatchObject({ estimate: undefined, estimateProblem: ticketCopy.amountTooSmall })
		expect(ticketModelFor(market, 'exit', '0.000000000000000001', balances)).toMatchObject({ estimate: undefined, estimateProblem: ticketCopy.amountTooSmall })
		expect(ticketModelFor(market, 'entry', '0')).toMatchObject({ estimate: undefined, estimateProblem: undefined })
	})

	test('stops the submission when the chain prices past the slippage bound', () => {
		const buy = ticketEstimateFor(market, 'entry', '1')
		const sell = ticketEstimateFor(market, 'exit', '2', balances)
		expect(authoritativeQuoteMoved(buy, buy.quote.totalLongShares)).toBeFalse()
		expect(authoritativeQuoteMoved(buy, buy.kind === 'entry' ? buy.minimumLongShares - 1n : 0n)).toBeTrue()
		expect(authoritativeQuoteMoved(sell, sell.quote.totalLongShares)).toBeFalse()
		expect(authoritativeQuoteMoved(sell, sell.kind === 'exit' ? sell.maximumLongShares + 1n : 0n)).toBeTrue()
	})
})

describe('trade ticket inputs', () => {
	test('parses ETH and share amounts at their own precision and starts empty', () => {
		expect(ticketModelFor(market, 'entry', '')).toMatchObject({ parsedAmount: undefined, amountError: undefined })
		expect(ticketModelFor(market, 'entry', '0.5').parsedAmount).toBe(5n * 10n ** 17n)
		expect(ticketModelFor(market, 'exit', '1.5').parsedAmount).toBe(15n * 10n ** 17n)
		expect(ticketModelFor(market, 'entry', 'abc').amountError).toBe(ticketCopy.invalidEthAmount)
		expect(ticketModelFor(market, 'exit', '0.0000000000000000001').amountError).toBe(ticketCopy.invalidShareAmount)
		expect(formatCurrencyInputBalance(15n * 10n ** 17n, 18)).toBe('1.5')
		expect(formatCurrencyInputBalance(1_000n * shares, 18)).toBe('1000')
	})

	test('offers 25%, 50%, and the largest insured sale as shortcuts', () => {
		const { shortcuts, sellable } = ticketModelFor(market, 'exit', '', balances)
		expect(shortcuts.map(shortcut => shortcut.label)).toEqual([ticketCopy.quarter, ticketCopy.half, ticketCopy.max])
		expect(shortcuts[0]?.value).toBe(balances.yes / 4n)
		// INVALID (2 shares) bounds the complete sets, so Max is well below the 10-share holding.
		// Max is trimmed to eight decimals so the field shows a readable amount that can still be sold in full.
		expect(shortcuts[2]?.value).toBe(sellable === undefined ? undefined : sellable - (sellable % 10n ** 10n))
		expect(sellable).toBeGreaterThan(2n * shares)
		expect(sellable).toBeLessThan(5n * shares)
		expect(ticketModelFor(market, 'exit', '', { ...balances, yes: 0n }).shortcuts).toEqual([])
	})

	test('offers buy shortcuts for 25%, 50%, and all of the wallet ETH less the gas reserve', () => {
		const buyShortcuts = (walletEthAttoEth: bigint | undefined) => tradeTicketModel({ ...ready, amount: '', walletEthAttoEth }).shortcuts
		const spendable = 5n * eth - ETH_GAS_RESERVE_ATTO_ETH
		const expected = [
			{ label: ticketCopy.quarter, value: spendable / 4n },
			{ label: ticketCopy.half, value: spendable / 2n },
			{ label: ticketCopy.max, value: spendable },
		]
		expect(buyShortcuts(5n * eth)).toEqual(expected)
		// The amounts are trimmed to eight decimals like the sell shortcuts, never above what can be spent.
		expect(buyShortcuts(5n * eth + 123_456_789n)).toEqual(expected)
		expect(buyShortcuts(ETH_GAS_RESERVE_ATTO_ETH)).toEqual([])
		expect(buyShortcuts(undefined)).toEqual([])
	})

	test('clears the amount when its unit changes and never carries an accepted price impact to another trade', () => {
		const buyYes: TicketInputs = { mode: 'entry', side: 'YES', amount: '0.5', acknowledgedImpactBps: 800n, requoteNotice: undefined }
		// ETH buys either outcome, so the amount survives a side change on a buy; the acknowledgment named the other trade.
		expect(ticketInputsAfterSelection(buyYes, { side: 'NO' })).toEqual({ ...buyYes, side: 'NO', acknowledgedImpactBps: undefined })
		// 0.5 ETH must not become 0.5 shares.
		expect(ticketInputsAfterSelection(buyYes, { mode: 'exit' })).toEqual({ ...buyYes, mode: 'exit', amount: '', acknowledgedImpactBps: undefined })
		const sellYes: TicketInputs = { ...buyYes, mode: 'exit' }
		expect(ticketInputsAfterSelection(sellYes, { side: 'NO' })).toEqual({ ...sellYes, side: 'NO', amount: '', acknowledgedImpactBps: undefined })
		expect(ticketInputsAfterSelection(sellYes, { mode: 'entry' }).amount).toBe('')
		// Selecting what is already selected changes nothing.
		expect(ticketInputsAfterSelection(buyYes, { mode: 'entry', side: 'YES' })).toBe(buyYes)
	})
})

describe('trade ticket model', () => {
	test('prices without a wallet and steps the button through connect, network, and the action', () => {
		const disconnected = tradeTicketModel({ ...ready, walletConnected: false, balances: undefined, balanceState: 'disconnected', walletEthAttoEth: undefined })
		expect(disconnected.estimate).toBeDefined()
		expect(disconnected.primaryStep).toBe('connect')
		expect(tradeTicketModel({ ...ready, networkMismatchReason: 'Switch to Local.' }).primaryStep).toBe('switch-network')
		const connected = tradeTicketModel(ready)
		expect(connected.primaryStep).toBe('submit')
		expect(connected.actionLabel).toBe('Buy Yes')
		expect(connected.availability).toEqual({ disabled: false, reason: undefined })
		expect(tradeTicketModel({ ...ready, mode: 'exit', amount: '1' }).actionLabel).toBe('Sell Yes')
	})

	test('waits for typing to settle and explains blockers in order', () => {
		expect(tradeTicketModel({ ...ready, amountSettling: true }).availability).toEqual({ disabled: true, loading: true, reason: ticketCopy.updatingEstimate })
		expect(tradeTicketModel({ ...ready, amount: '6' }).availability.reason).toBe(availabilityCopy.insufficientEthReason)
		// The amount field says the same, so the cause sits next to the number that caused it.
		expect(tradeTicketModel({ ...ready, amount: '6' }).insufficientReason).toBe(availabilityCopy.insufficientEthReason)
		expect(tradeTicketModel({ ...ready, mode: 'exit', amount: '11' }).insufficientReason).toBe(availabilityCopy.formatInsufficientOutcomeReason('YES'))
		expect(tradeTicketModel(ready).insufficientReason).toBeUndefined()
		expect(tradeTicketModel({ ...ready, marketClosed: true }).availability.reason).toBe(ticketCopy.tradingEndedReason)
		expect(tradeTicketModel({ ...ready, workflowLocked: true }).availability.reason).toBe(availabilityCopy.transactionInProgressReason)
	})

	test('keeps the gas reserve in the wallet when a buy would spend the whole ETH balance', () => {
		const reserveReason = ticketCopy.gasReserveReason('0.01')
		expect(tradeTicketModel({ ...ready, amount: '5' }).availability).toEqual({ disabled: true, reason: reserveReason })
		expect(tradeTicketModel({ ...ready, amount: '4.995' }).availability.reason).toBe(reserveReason)
		expect(tradeTicketModel({ ...ready, amount: '4.99' }).availability).toEqual({ disabled: false, reason: undefined })
	})

	test('explains an INVALID shortfall inline and names what can be sold instead', () => {
		const model = tradeTicketModel({ ...ready, mode: 'exit', amount: '8' })
		expect(model.shortfall?.invalidHeld).toBe(2n * shares)
		expect(model.shortfall?.invalidRequired).toBeGreaterThan(2n * shares)
		expect(model.availability.reason).toBe(ticketCopy.invalidCoverageReason)
		expect(model.sellable).toBeGreaterThanOrEqual(model.shortcuts[2]?.value ?? 0n)
	})

	test('cautions above 2% impact, asks for acknowledgment above 5%, and refuses above 15%', () => {
		expect(tradeTicketModel({ ...ready, amount: '1' }).impactTier).toBe('low')
		expect(tradeTicketModel({ ...ready, amount: '8', walletEthAttoEth: 1_000n * eth }).impactTier).toBe('caution')
		const warning = tradeTicketModel({ ...ready, amount: '20', walletEthAttoEth: 1_000n * eth })
		expect(warning.impactTier).toBe('warning')
		expect(warning.availability.reason).toBe(ticketCopy.acknowledgeImpactReason)
		const accepted = warning.estimate?.impactBps
		expect(tradeTicketModel({ ...ready, amount: '20', walletEthAttoEth: 1_000n * eth, acknowledgedImpactBps: accepted }).availability.disabled).toBeFalse()
		// An acknowledgment covers only the impact it named: a larger trade or a moved pool asks again.
		const larger = tradeTicketModel({ ...ready, amount: '25', walletEthAttoEth: 1_000n * eth, acknowledgedImpactBps: accepted })
		expect(larger.impactTier).toBe('warning')
		expect(larger.impactAcknowledged).toBeFalse()
		expect(larger.availability.reason).toBe(ticketCopy.acknowledgeImpactReason)
		const blocked = tradeTicketModel({ ...ready, amount: '80', walletEthAttoEth: 1_000n * eth, acknowledgedImpactBps: 10_000n })
		expect(blocked.impactTier).toBe('blocked')
		expect(blocked.availability.reason).toBe(ticketCopy.priceImpactBlockedReason)
	})
})
