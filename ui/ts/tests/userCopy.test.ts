/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import {
	getMetricPlaceholderPresentation,
	getPageNotFoundPresentation,
	getPoolRegistryPresentation,
	getReportPresentation,
	getUniversePresentation,
	getWalletPresentation,
} from '../lib/userCopy.js'

void describe('user copy helpers', () => {
	void test('maps pool selection states semantically', () => {
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'unknown' })?.key).toBe('not_checked')
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'unknown' })?.detail).toBeUndefined()
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'unknown' })?.actionHint).toBeUndefined()
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'loading' })?.key).toBe('loading')
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'missing' })?.key).toBe('not_found')
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'missing' })?.detail).toBeUndefined()
		expect(getPoolRegistryPresentation({ mode: 'selection', state: 'ready' })).toBeUndefined()
	})

	void test('maps empty pool registry states semantically', () => {
		expect(getPoolRegistryPresentation({ hasLoaded: false, isLoading: false, mode: 'collection', poolCount: 0 })?.key).toBe('not_checked')
		expect(getPoolRegistryPresentation({ hasLoaded: true, isLoading: false, mode: 'collection', poolCount: 0 })?.key).toBe('empty')
	})

	void test('maps universe and report lookup states semantically', () => {
		expect(getUniversePresentation('missing')?.key).toBe('not_found')
		expect(getReportPresentation({ kind: 'question', state: 'unknown' })?.actionHint).toBe('Refresh questions')
		expect(getReportPresentation({ kind: 'question', state: 'loading' })).toEqual({
			detail: 'retrieving...',
			detailIsLoading: true,
			key: 'loading',
		})
	})

	void test('maps wallet and placeholder states semantically', () => {
		expect(getWalletPresentation({ accountAddress: undefined, hasInjectedWallet: true, isMainnet: true })?.key).toBe('wallet_disconnected')
		expect(getWalletPresentation({ accountAddress: '0x0000000000000000000000000000000000000001', hasInjectedWallet: true, isMainnet: false })?.key).toBe('wrong_network')
		expect(getMetricPlaceholderPresentation(undefined)?.placeholder).toBe('—')
	})

	void test('keeps disconnected wallet guidance concise', () => {
		expect(getWalletPresentation({ accountAddress: undefined, hasWallet: false, isMainnet: true })?.detail).toBe('Install or enable a wallet to continue.')
		expect(getWalletPresentation({ accountAddress: undefined, hasInjectedWallet: true, isMainnet: true })?.detail).toBe('Connect wallet to continue.')
	})

	void test('covers metric placeholders and loading copy paths', () => {
		expect(getMetricPlaceholderPresentation(undefined, { loading: true })?.key).toBe('loading')
		expect(getMetricPlaceholderPresentation(undefined, { loading: true })).toEqual({
			badgeLabel: 'Loading',
			badgeTone: 'pending',
			key: 'loading',
			placeholder: 'Loading...',
		})
		expect(getMetricPlaceholderPresentation('value')).toBeUndefined()
		expect(getMetricPlaceholderPresentation(undefined)).toEqual({
			key: 'unavailable',
			placeholder: '—',
		})
	})

	void test('covers collection and loading report states', () => {
		expect(getPoolRegistryPresentation({ hasLoaded: true, isLoading: true, mode: 'collection', poolCount: 0 })?.key).toBe('loading')
		expect(getPoolRegistryPresentation({ hasLoaded: true, isLoading: false, mode: 'collection', poolCount: 0 })?.key).toBe('empty')
		expect(getPoolRegistryPresentation({ hasLoaded: false, isLoading: true, mode: 'collection', poolCount: 0 })?.key).toBe('loading')
		expect(getUniversePresentation('loading')?.key).toBe('loading')
		expect(getUniversePresentation('ready')).toBeUndefined()
		expect(getReportPresentation({ kind: 'report', state: 'loading' })?.detail).toBe('retrieving...')
		expect(getReportPresentation({ kind: 'report', state: 'ready' })).toBeUndefined()
		expect(getPageNotFoundPresentation().key).toBe('page_not_found')
	})

	void test('maps wallet branch states with non-increasing permission checks', () => {
		expect(getWalletPresentation({ accountAddress: undefined, hasWallet: false })?.key).toBe('wallet_disconnected')
		expect(getWalletPresentation({ accountAddress: '0x000000000000000000000000000000000000dEaD', hasInjectedWallet: true, isSupportedChain: false })?.key).toBe('wrong_network')
		expect(getWalletPresentation({ accountAddress: '0x000000000000000000000000000000000000dEaD', hasInjectedWallet: true, isSupportedChain: false, isMainnet: true })?.detail).toBe('Switch to Ethereum mainnet.')
	})
})
