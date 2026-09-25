import { describe, expect, test } from 'bun:test'
import { quoteEnterPosition } from '@zoltar/trading-shared/trading/positions'
import { authoritativeQuoteMoved, formatAmountInput, tradeTicketModel, type TradeTicketInputs } from '../../features/live/tradeTicketModel.js'
import { shareBalanceScope, type LiveBalances } from '../../protocol/live.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import * as ticketCopy from '../../copy/tradeTicket.js'
import * as availabilityCopy from '../../copy/availability.js'
import { liveMarketFixture, ticketEstimateFor, ticketModelFor } from '../support/liveMarketFixture.js'

const eth = 10n ** 18n
const shares = 10n ** 36n

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
	impactAcknowledged: false,
	workflowLocked: false,
}

describe('trade ticket estimate', () => {
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
		expect(estimate.receiveAttoEth).toBe(estimate.quote.completeSetShares / 10n ** 18n)
		expect(estimate.minimumAttoEth).toBe((estimate.receiveAttoEth * 9_950n) / 10_000n)
		expect(estimate.maximumLongShares).toBeLessThanOrEqual(balances.yes)
		expect(estimate.quote.conditionalYesBpsAfter).toBeLessThan(estimate.quote.conditionalYesBpsBefore)
	})

	test('reports amounts too small to trade instead of an estimate', () => {
		const expensive = liveMarketFixture({ shareTokenSupplyAttoShares: 1n, settlementCollateralAttoEth: eth })
		expect(ticketModelFor(expensive, 'entry', '0.000000000000000001')).toMatchObject({ estimate: undefined, estimateProblem: ticketCopy.amountTooSmall })
		expect(ticketModelFor(market, 'exit', '0.000000000000000000000000000000000001', balances)).toMatchObject({ estimate: undefined, estimateProblem: ticketCopy.amountTooSmall })
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
		expect(ticketModelFor(market, 'exit', '1.5').parsedAmount).toBe(15n * 10n ** 35n)
		expect(ticketModelFor(market, 'entry', 'abc').amountError).toBe(ticketCopy.invalidEthAmount)
		expect(ticketModelFor(market, 'exit', '0.0000000000000000000000000000000000001').amountError).toBe(ticketCopy.invalidShareAmount)
		expect(formatAmountInput(15n * 10n ** 35n, 36)).toBe('1.5')
		expect(formatAmountInput(1_000n * shares, 36)).toBe('1000')
	})

	test('offers 25%, 50%, and the largest insured sale as shortcuts', () => {
		const { shortcuts, sellable } = ticketModelFor(market, 'exit', '', balances)
		expect(shortcuts.map(shortcut => shortcut.label)).toEqual([ticketCopy.quarter, ticketCopy.half, ticketCopy.max])
		expect(shortcuts[0]?.value).toBe(balances.yes / 4n)
		// INVALID (2 shares) bounds the complete sets, so Max is well below the 10-share holding.
		// Max is trimmed to eight decimals so the field shows a readable amount that can still be sold in full.
		expect(shortcuts[2]?.value).toBe(sellable === undefined ? undefined : sellable - (sellable % 10n ** 28n))
		expect(sellable).toBeGreaterThan(2n * shares)
		expect(sellable).toBeLessThan(5n * shares)
		expect(ticketModelFor(market, 'exit', '', { ...balances, yes: 0n }).shortcuts).toEqual([])
		expect(ticketModelFor(market, 'entry', '', balances).shortcuts).toEqual([])
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
		expect(connected.actionLabel).toBe('Buy YES')
		expect(connected.availability).toEqual({ disabled: false, reason: undefined })
		expect(tradeTicketModel({ ...ready, mode: 'exit', amount: '1' }).actionLabel).toBe('Sell YES')
	})

	test('waits for typing to settle and explains blockers in order', () => {
		expect(tradeTicketModel({ ...ready, amountSettling: true }).availability).toEqual({ disabled: true, loading: true, reason: ticketCopy.updatingEstimate })
		expect(tradeTicketModel({ ...ready, amount: '' }).availability.reason).toBe(availabilityCopy.amountRequiredReason)
		expect(tradeTicketModel({ ...ready, amount: '6' }).availability.reason).toBe(availabilityCopy.insufficientEthReason)
		expect(tradeTicketModel({ ...ready, marketClosed: true }).availability.reason).toBe(availabilityCopy.marketClosedReason)
		expect(tradeTicketModel({ ...ready, workflowLocked: true }).availability.reason).toBe(availabilityCopy.transactionInProgressReason)
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
		expect(tradeTicketModel({ ...ready, amount: '20', walletEthAttoEth: 1_000n * eth, impactAcknowledged: true }).availability.disabled).toBeFalse()
		const blocked = tradeTicketModel({ ...ready, amount: '80', walletEthAttoEth: 1_000n * eth, impactAcknowledged: true })
		expect(blocked.impactTier).toBe('blocked')
		expect(blocked.availability.reason).toBe(ticketCopy.priceImpactBlockedReason)
	})
})
