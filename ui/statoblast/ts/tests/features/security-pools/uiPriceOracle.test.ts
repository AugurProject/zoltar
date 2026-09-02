/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { resolveUiRepPerEthPrice } from '../../../features/security-pools/lib/uiPriceOracle.js'
import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-zoltar/protocol/oracleTiming.js'

describe('UI price oracle', () => {
	const prices = {
		currentTimestamp: 1_000n,
		openOraclePrice: 20n,
		openOracleSettlementTimestamp: 900n,
		uniswapPrice: 10n,
	}

	test('uses Uniswap when selected', () => {
		expect(resolveUiRepPerEthPrice({ ...prices, priceOracle: 'uniswap' })).toBe(10n)
	})

	test('uses the latest Open Oracle price without requiring validity', () => {
		expect(resolveUiRepPerEthPrice({ ...prices, openOracleValid: false, priceOracle: 'open-oracle' })).toBe(20n)
	})

	test('treats a zero settlement timestamp as no Open Oracle report', () => {
		expect(resolveUiRepPerEthPrice({ ...prices, openOraclePrice: 0n, openOracleSettlementTimestamp: 0n, priceOracle: 'open-oracle' })).toBeUndefined()
		expect(resolveUiRepPerEthPrice({ ...prices, openOraclePrice: 0n, openOracleSettlementTimestamp: 0n, priceOracle: 'open-oracle-fallback' })).toBe(10n)
	})

	test('uses a valid Open Oracle price and otherwise falls back to Uniswap', () => {
		expect(resolveUiRepPerEthPrice({ ...prices, openOracleValid: true, priceOracle: 'open-oracle-fallback' })).toBe(20n)
		expect(resolveUiRepPerEthPrice({ ...prices, openOracleValid: false, priceOracle: 'open-oracle-fallback' })).toBe(10n)
		expect(resolveUiRepPerEthPrice({ ...prices, openOraclePrice: undefined, priceOracle: 'open-oracle-fallback' })).toBe(10n)
	})

	test('falls back at and after the canonical Open Oracle expiry boundary', () => {
		const validUntil = getOracleManagerPriceValidUntilTimestamp(prices.openOracleSettlementTimestamp)
		if (validUntil === undefined) throw new Error('Expected a valid-until timestamp')
		expect(resolveUiRepPerEthPrice({ ...prices, currentTimestamp: validUntil - 1n, openOracleValid: true, priceOracle: 'open-oracle-fallback' })).toBe(20n)
		expect(resolveUiRepPerEthPrice({ ...prices, currentTimestamp: validUntil, openOracleValid: true, priceOracle: 'open-oracle-fallback' })).toBe(10n)
		expect(resolveUiRepPerEthPrice({ ...prices, currentTimestamp: validUntil + 1n, openOracleValid: true, priceOracle: 'open-oracle-fallback' })).toBe(10n)
	})
})
