/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getMetricPlaceholderPresentation, getPoolRegistryPresentation, getReportPresentation, getUniversePresentation, getWalletPresentation } from '../lib/userCopy.js'

void describe('user copy helpers', () => {
	void test('maps pool selection states semantically', () => {
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'unknown' })?.key).toBe('not_checked')
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'loading' })?.key).toBe('loading')
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'missing' })?.key).toBe('not_found')
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'ready' })).toBeUndefined()
	})

	void test('maps empty pool registry states semantically', () => {
		expect(getPoolRegistryPresentation({ hasLoaded: false, isLoading: false, mode: 'collection', poolCount: 0 })?.key).toBe('not_checked')
		expect(getPoolRegistryPresentation({ hasLoaded: true, isLoading: false, mode: 'collection', poolCount: 0 })?.key).toBe('empty')
	})

	void test('maps universe and report lookup states semantically', () => {
		expect(getUniversePresentation('missing')?.key).toBe('not_found')
		expect(getReportPresentation({ kind: 'question', state: 'unknown' })?.actionHint).toBe('Refresh questions')
	})

	void test('maps wallet and placeholder states semantically', () => {
		expect(getWalletPresentation({ accountAddress: undefined, hasInjectedWallet: true, isMainnet: true })?.key).toBe('wallet_disconnected')
		expect(getWalletPresentation({ accountAddress: '0x0000000000000000000000000000000000000001', hasInjectedWallet: true, isMainnet: false })?.key).toBe('wrong_network')
		expect(getMetricPlaceholderPresentation(undefined)?.placeholder).toBe('—')
	})
})
