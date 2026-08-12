import { expect, test } from 'bun:test'
import { demoAmmPriceHistory, demoDenseUniswapRepEthPriceHistory, demoRepEthPriceHistory, demoUniswapRepEthPriceHistory } from '../public/demo-fixtures.js'

test('derives every conditional demo price from its exact AMM reserves', () => {
	for (const price of demoAmmPriceHistory(Date.parse('2026-08-12T00:00:00.000Z'))) {
		const yesReserve = BigInt(price.yes_reserve_atto_shares)
		const noReserve = BigInt(price.no_reserve_atto_shares)
		const conditionalYesBps = (noReserve * 10_000n) / (yesReserve + noReserve)
		expect(price.conditional_yes_bps).toBe(conditionalYesBps.toString())
		expect(price.conditional_no_bps).toBe((10_000n - conditionalYesBps).toString())
	}
})

test('provides distinct V2, V3, and V4 REP price observations', () => {
	const prices = demoUniswapRepEthPriceHistory(Date.parse('2026-08-12T00:00:00.000Z'))
	expect(new Set(prices.map(({ venue }) => venue))).toEqual(new Set(['v2', 'v3', 'v4']))
	expect(prices.filter(({ venue }) => venue === 'v4').every(({ quote_symbol }) => quote_symbol === 'ETH')).toBeTrue()
	expect(prices.filter(({ venue }) => venue !== 'v4').every(({ quote_symbol }) => quote_symbol === 'WETH')).toBeTrue()
})

test('provides eight distinct Uniswap markets for dense visual QA', () => {
	const prices = demoDenseUniswapRepEthPriceHistory(Date.parse('2026-08-12T00:00:00.000Z'))
	expect(new Set(prices.map(({ market_id }) => market_id))).toHaveLength(8)
})

test('distinguishes the REP/ETH initialization seed from accepted demo settlements', () => {
	const prices = demoRepEthPriceHistory(Date.parse('2026-08-12T00:00:00.000Z'))
	expect(prices[0]).toMatchObject({ event_name: 'RepEthPriceSet', report_id: null, settlement_timestamp: null })
	for (const price of prices.slice(1)) {
		expect(price.event_name).toBe('PriceReported')
		expect(price.report_id).not.toBeNull()
		expect(price.settlement_timestamp).toMatch(/^2026-/)
	}
})
