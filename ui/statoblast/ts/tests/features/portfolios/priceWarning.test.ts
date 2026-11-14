import { describe, expect, test } from 'bun:test'
import { getPortfolioPriceDeviation, getPortfolioPriceWarning } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/priceWarning.js'

const unit = 10n ** 18n
const weth = { symbol: 'WETH', decimals: 18 }
const reference = 300n * unit

describe('portfolio report price check', () => {
	test('accepts prices within 2× of the reference and skips the check without a reference', () => {
		expect(getPortfolioPriceDeviation(reference, reference)).toBeUndefined()
		expect(getPortfolioPriceDeviation(600n * unit, reference)).toBeUndefined()
		expect(getPortfolioPriceDeviation(150n * unit, reference)).toBeUndefined()
		expect(getPortfolioPriceDeviation(10n * unit, undefined)).toBeUndefined()
		expect(getPortfolioPriceDeviation(10n * unit, 0n)).toBeUndefined()
		expect(getPortfolioPriceDeviation(undefined, reference)).toBeUndefined()
		expect(getPortfolioPriceWarning(reference, reference, weth)).toBeUndefined()
	})
	test('names a price entered as WETH per REP as inverted', () => {
		// 1 / 300 WETH per REP, rounded the way a user would type it.
		const inverted = 3_333_333_333_333_333n
		expect(getPortfolioPriceDeviation(inverted, reference)).toBe('inverted')
		expect(getPortfolioPriceWarning(inverted, reference, weth)?.replaceAll('\u00a0', ' ')).toBe('This looks inverted (WETH per REP). Enter REP per WETH; the last accepted price is 300.00 REP per WETH.')
	})
	test('warns about prices more than 2× away from the reference', () => {
		expect(getPortfolioPriceDeviation(601n * unit, reference)).toBe('above')
		expect(getPortfolioPriceDeviation(149n * unit, reference)).toBe('below')
		expect(getPortfolioPriceWarning(3000n * unit, reference, weth)?.replaceAll('\u00a0', ' ')).toBe('More than double the last accepted price of 300.00 REP per WETH. Check the price before sending.')
		expect(getPortfolioPriceWarning(30n * unit, reference, weth)?.replaceAll('\u00a0', ' ')).toBe('Less than half the last accepted price of 300.00 REP per WETH. Check the price before sending.')
	})
	test('shows the reference the way the accepted price metric does, not at full precision', () => {
		const ratio = 10n ** 19n / 3n
		expect(getPortfolioPriceWarning(100n * unit, ratio, weth)?.replaceAll('\u00a0', ' ')).toBe('More than double the last accepted price of ≈ 3.33 REP per WETH. Check the price before sending.')
	})
	test('does not call a plausible price inverted when the reference is near 1 REP per WETH', () => {
		expect(getPortfolioPriceDeviation(unit, unit)).toBeUndefined()
		expect(getPortfolioPriceDeviation(3n * unit, unit)).toBe('above')
	})
})

for (const symbol of ['USDC', 'USDT'])
	test(`${symbol} warnings use six-decimal collateral price precision and the actual token name`, () => {
		const precision = 10n ** 30n
		const collateral = { symbol, decimals: 6 }
		expect(getPortfolioPriceWarning(precision / 300n, 300n * precision, collateral)?.replaceAll('\u00a0', ' ')).toBe(`This looks inverted (${symbol} per REP). Enter REP per ${symbol}; the last accepted price is 300.00 REP per ${symbol}.`)
		expect(getPortfolioPriceWarning(3000n * precision, 300n * precision, collateral)?.replaceAll('\u00a0', ' ')).toBe(`More than double the last accepted price of 300.00 REP per ${symbol}. Check the price before sending.`)
	})
