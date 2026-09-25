/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { describeRepPriceStatus, resolveRepPrice, type UiPriceOracle } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { getOracleManagerPriceValidUntilTimestamp } from '@zoltar/ui-statoblast-shared/protocol/oracleTiming.js'

const settlementTimestamp = 900n
const validUntil = getOracleManagerPriceValidUntilTimestamp(settlementTimestamp)
if (validUntil === undefined) throw new Error('Expected a valid-until timestamp')
const freshNow = settlementTimestamp + 180n
const poolOracle = { price: 20n, settlementTimestamp }

function resolve(setting: UiPriceOracle, overrides: Partial<Parameters<typeof resolveRepPrice>[0]> = {}) {
	return resolveRepPrice({ now: freshNow, poolOracle, setting, uniswapPrice: 10n, ...overrides })
}

describe('resolveRepPrice', () => {
	test('uses the live Uniswap quote when Uniswap is selected', () => {
		expect(resolve('uniswap')).toEqual({ observedAt: undefined, price: 10n, reason: 'selected', setting: 'uniswap', source: 'uniswap', stale: false, validUntil: undefined })
		expect(resolve('uniswap', { uniswapPrice: undefined })).toMatchObject({ price: undefined, reason: 'unavailable', source: undefined })
	})

	test('keeps the latest Open Oracle price when selected and marks it stale after expiry', () => {
		expect(resolve('open-oracle')).toEqual({ observedAt: settlementTimestamp, price: 20n, reason: 'selected', setting: 'open-oracle', source: 'open-oracle', stale: false, validUntil })
		expect(resolve('open-oracle', { now: validUntil })).toMatchObject({ price: 20n, source: 'open-oracle', stale: true })
		expect(resolve('open-oracle', { oracleManager: { isPriceValid: false, price: 20n, settlementTimestamp } })).toMatchObject({ price: 20n, stale: true })
	})

	test('treats a zero settlement timestamp as no Open Oracle report', () => {
		const unreported = { price: 0n, settlementTimestamp: 0n }
		expect(resolve('open-oracle', { poolOracle: unreported })).toMatchObject({ price: undefined, reason: 'unavailable' })
		expect(resolve('open-oracle-fallback', { poolOracle: unreported })).toMatchObject({ price: 10n, reason: 'oracle-missing', source: 'uniswap' })
	})

	test('prefers the refreshed oracle-manager reading over the pool listing', () => {
		expect(resolve('open-oracle', { oracleManager: { isPriceValid: true, price: 30n, settlementTimestamp: settlementTimestamp + 60n } })).toMatchObject({ observedAt: settlementTimestamp + 60n, price: 30n })
	})

	test('uses a fresh Open Oracle price and otherwise falls back to Uniswap', () => {
		expect(resolve('open-oracle-fallback')).toMatchObject({ price: 20n, reason: 'selected', source: 'open-oracle', stale: false })
		expect(resolve('open-oracle-fallback', { oracleManager: { isPriceValid: false, price: 20n, settlementTimestamp } })).toMatchObject({ price: 10n, reason: 'oracle-expired', source: 'uniswap' })
		expect(resolve('open-oracle-fallback', { poolOracle: undefined })).toMatchObject({ price: 10n, reason: 'oracle-missing' })
		expect(resolve('open-oracle-fallback', { now: undefined })).toMatchObject({ price: 10n, source: 'uniswap' })
		expect(resolve('open-oracle-fallback', { now: validUntil, uniswapPrice: undefined })).toMatchObject({ price: undefined, reason: 'unavailable' })
	})

	test('falls back at and after the canonical Open Oracle expiry boundary', () => {
		expect(resolve('open-oracle-fallback', { now: validUntil - 1n })).toMatchObject({ price: 20n, source: 'open-oracle' })
		expect(resolve('open-oracle-fallback', { now: validUntil })).toMatchObject({ price: 10n, reason: 'oracle-expired' })
		expect(resolve('open-oracle-fallback', { now: validUntil + 1n })).toMatchObject({ price: 10n, reason: 'oracle-expired' })
	})
})

describe('describeRepPriceStatus', () => {
	test('names the source and age of a fresh price', () => {
		expect(describeRepPriceStatus(resolve('open-oracle'), freshNow)).toEqual({ detail: '3m ago', state: 'fresh', title: 'via Open Oracle' })
		expect(describeRepPriceStatus(resolve('open-oracle'), undefined)).toEqual({ detail: undefined, state: 'fresh', title: 'via Open Oracle' })
		expect(describeRepPriceStatus(resolve('uniswap'), freshNow)).toEqual({ detail: 'live', state: 'fresh', title: 'via Uniswap' })
	})

	test('explains why the fallback setting used Uniswap', () => {
		expect(describeRepPriceStatus(resolve('open-oracle-fallback', { now: validUntil }), validUntil).detail).toBe('Open Oracle expired')
		expect(describeRepPriceStatus(resolve('open-oracle-fallback', { poolOracle: undefined }), freshNow).detail).toBe('no Open Oracle price')
	})

	test('marks an expired price as stale with how long ago it expired', () => {
		const now = validUntil + 2n * 60n * 60n
		expect(describeRepPriceStatus(resolve('open-oracle', { now }), now)).toEqual({ detail: 'Open Oracle price expired 2h 0m ago', state: 'stale', title: 'Stale' })
		expect(describeRepPriceStatus(resolve('open-oracle', { oracleManager: { isPriceValid: false, price: 20n, settlementTimestamp } }), freshNow)).toEqual({ detail: 'Open Oracle price not valid', state: 'stale', title: 'Stale' })
	})

	test('names the missing price for each setting', () => {
		expect(describeRepPriceStatus(resolve('uniswap', { uniswapPrice: undefined }), freshNow)).toEqual({ detail: undefined, state: 'unavailable', title: 'Uniswap price unavailable' })
		expect(describeRepPriceStatus(resolve('open-oracle', { poolOracle: undefined }), freshNow).title).toBe('No Open Oracle price')
		expect(describeRepPriceStatus(resolve('open-oracle-fallback', { poolOracle: undefined, uniswapPrice: undefined }), freshNow).title).toBe('No REP price')
	})
})
