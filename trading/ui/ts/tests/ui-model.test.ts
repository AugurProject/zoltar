import { describe, expect, test } from 'bun:test'
import { formatBpsMultiplier, formatEthPerShare, formatShareAmount, formatUnits, parseUnits, parseUnitsOrUndefined } from '../app/format.ts'
import { demoAttoEthToAttoShares, demoAttoSharesToAttoEth, demoMarket, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'
import { quoteDemoEnterPosition } from '../features/MarketDetail.tsx'
import { liquidityActionAvailability, quoteDemoEthLiquidity, quoteDemoRemoval } from '../features/Routes.tsx'

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
		expect(formatShareAmount(initial.invalidReturned)).toBe('1,012,760,785,902,369,860.239 shares')
		expect(formatShareAmount(addedCompleteSetShares)).toBe('101,276,078,590,236,986.0239 shares')
		expect(added.yesUsed).toBeLessThanOrEqual(addedCompleteSetShares)
		expect(added.noUsed).toBeLessThanOrEqual(addedCompleteSetShares)
	})

	test('parses and formats chain quantities without numbers', () => {
		expect(parseUnits('1.2345')).toBe(1_234_500_000_000_000_000n)
		expect(formatUnits(1_234_500_000_000_000_000n)).toBe('1.2345')
		expect(() => parseUnits('1.0000000000000000001')).toThrow('18 decimal places')
		expect(parseUnitsOrUndefined('70.25', 2)).toBe(7_025n)
		expect(parseUnitsOrUndefined('70.251', 2)).toBeUndefined()
		expect(parseUnitsOrUndefined('../70', 2)).toBeUndefined()
	})

	test('formats 18-decimal shares and Statoblast settings for display', () => {
		expect(formatShareAmount(1_234_500_000_000_000_000n)).toBe('1.2345 shares')
		expect(formatBpsMultiplier(25_000n)).toBe('2.5×')
		expect(formatEthPerShare(12_342_500_000_000_000_000n, 12_500_000_000_000_000_000n * 10n ** 18n)).toBe('0.0000000000000000009874 ETH / share')
	})

	test('converts ETH to share units using the live SecurityPool exchange rate once', () => {
		const market = demoMarket('baseline')
		const shares = demoAttoEthToAttoShares(250_000_000_000_000_000n, market)
		expect(formatShareAmount(shares)).toBe('253,190,196,475,592,465.0597 shares')
		expect((shares * market.securityPool.settlementCollateralAttoEth) / market.securityPool.shareTokenSupplyAttoShares).toBeLessThanOrEqual(250_000_000_000_000_000n)
	})

	test('wires the live-rate complete-set amount into the enter quote', () => {
		const quote = quoteDemoEnterPosition(demoMarket('baseline'), 'YES', 250_000_000_000_000_000n)
		expect(formatShareAmount(quote.completeSetShares)).toBe('253,190,196,475,592,465.0597 shares')
		expect(quote.completeSetShares).toBeGreaterThan(1n * 10n ** 18n)
	})

	test('derives exit ETH from the current SecurityPool redemption rate', () => {
		const market = demoMarket('baseline')
		const shares = demoAttoEthToAttoShares(250_000_000_000_000_000n, market)
		expect(demoAttoSharesToAttoEth(shares, market)).toBeLessThanOrEqual(250_000_000_000_000_000n)
		expect(demoAttoSharesToAttoEth(shares * 2n, market)).toBeGreaterThan(demoAttoSharesToAttoEth(shares, market))
	})

	test('uses the authoritative LP supply for removal previews', () => {
		const removed = quoteDemoRemoval(demoMarket('baseline'), 100n * 10n ** 18n)
		expect(formatShareAmount(removed.yesOut)).toBe('100 shares')
		expect(formatShareAmount(removed.noOut)).toBe('233.3335 shares')
	})
})
