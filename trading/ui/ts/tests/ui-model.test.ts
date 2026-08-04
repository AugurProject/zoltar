import { describe, expect, test } from 'bun:test'
import { formatBpsMultiplier, formatShareAmount, formatUnits, parseUnits } from '../app/format.ts'
import { demoCashToShares, demoMarket, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'
import { quoteDemoEnterPosition } from '../features/MarketDetail.tsx'
import { liquidityActionAvailability, quoteDemoEthLiquidity } from '../features/Routes.tsx'

describe('standalone trading UI model', () => {
	test('derives exact lifecycle reasons', () => {
		expect(tradingClosedReason(demoMarket('ended').lifecycle)).toBe('Question ended')
		expect(tradingClosedReason(demoMarket('forked').lifecycle)).toBe('Parent universe forked')
		expect(lifecycleLabel(demoMarket('resolved-invalid').lifecycle)).toBe('Resolved INVALID')
		expect(tradingClosedReason(demoMarket('truth-auction').lifecycle)).toBe('Truth auction in progress')
		expect(demoMarket('truth-auction').securityPool.systemState).toBe('Fork truth auction')
		expect(demoMarket('truth-auction').universe).toBe('Child universe · YES branch')
		expect(demoMarket('truth-auction').pool).not.toBe(demoMarket('baseline').pool)
	})

	test('keeps truth-auction liquidity removal available while create and add are closed', () => {
		expect(liquidityActionAvailability(demoMarket('truth-auction'))).toEqual({ createOrAdd: false, remove: true })
	})

	test('uses the live SecurityPool rate for ETH-funded liquidity previews', () => {
		const market = demoMarket('baseline')
		const { initial, added, addedCompleteSetShares } = quoteDemoEthLiquidity(market, 7_000n)
		expect(formatShareAmount(initial.invalidReturned)).toBe('1.0127 shares')
		expect(formatShareAmount(addedCompleteSetShares)).toBe('0.1012 shares')
		expect(added.yesUsed).toBeLessThanOrEqual(addedCompleteSetShares)
		expect(added.noUsed).toBeLessThanOrEqual(addedCompleteSetShares)
	})

	test('parses and formats chain quantities without numbers', () => {
		expect(parseUnits('1.2345')).toBe(1_234_500_000_000_000_000n)
		expect(formatUnits(1_234_500_000_000_000_000n)).toBe('1.2345')
		expect(() => parseUnits('1.0000000000000000001')).toThrow('18 decimal places')
	})

	test('formats 18-decimal shares and Statoblast settings for display', () => {
		expect(formatShareAmount(1_234_500_000_000_000_000n)).toBe('1.2345 shares')
		expect(formatBpsMultiplier(25_000n)).toBe('2.5×')
	})

	test('converts ETH to share units using the live SecurityPool exchange rate once', () => {
		const market = demoMarket('baseline')
		const shares = demoCashToShares(250_000_000_000_000_000n, market)
		expect(formatShareAmount(shares)).toBe('0.2531 shares')
		expect((shares * market.securityPool.completeSetCollateral) / market.securityPool.shareTokenSupply).toBeLessThanOrEqual(250_000_000_000_000_000n)
	})

	test('wires the live-rate complete-set amount into the enter quote', () => {
		const quote = quoteDemoEnterPosition(demoMarket('baseline'), 'YES', 250_000_000_000_000_000n)
		expect(formatShareAmount(quote.completeSetShares)).toBe('0.2531 shares')
		expect(quote.completeSetShares).toBeLessThan(1n * 10n ** 18n)
	})
})
