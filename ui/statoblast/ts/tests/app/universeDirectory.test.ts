/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getUniverseDirectoryContextKey, isUniverseDirectoryLoadedForContext, shouldAutoLoadUniverseDirectory } from '../../app/lib/universeDirectory.js'

describe('statoblast universe directory auto-load', () => {
	test('auto-loads once for a fresh universes context and stops retrying after a failure until manual retry', () => {
		const currentContextKey = '5:0xabc:1'
		expect(
			shouldAutoLoadUniverseDirectory({
				activeSecurityPoolsView: 'universes',
				canReadOnchainData: true,
				currentContextKey,
				hasLoadedUniverseDirectoryPools: false,
				lastAutoLoadContextKey: undefined,
				loadingUniverseDirectoryPools: false,
				securityPoolUniverseDirectoryError: undefined,
			}),
		).toBe(true)
		expect(
			shouldAutoLoadUniverseDirectory({
				activeSecurityPoolsView: 'universes',
				canReadOnchainData: true,
				currentContextKey,
				hasLoadedUniverseDirectoryPools: false,
				lastAutoLoadContextKey: currentContextKey,
				loadingUniverseDirectoryPools: false,
				securityPoolUniverseDirectoryError: 'Failed to load universe stats',
			}),
		).toBe(false)
		expect(
			shouldAutoLoadUniverseDirectory({
				activeSecurityPoolsView: 'universes',
				canReadOnchainData: true,
				currentContextKey: '5:0xabc:2',
				hasLoadedUniverseDirectoryPools: false,
				lastAutoLoadContextKey: currentContextKey,
				loadingUniverseDirectoryPools: false,
				securityPoolUniverseDirectoryError: 'Failed to load universe stats',
			}),
		).toBe(true)
	})

	test('treats directory figures loaded for another account or universe as not loaded', () => {
		const accountA = getUniverseDirectoryContextKey({ accountAddress: '0x00000000000000000000000000000000000000Aa', environmentNonce: 5, universeId: 1n })
		const accountB = getUniverseDirectoryContextKey({ accountAddress: '0x00000000000000000000000000000000000000bb', environmentNonce: 5, universeId: 1n })
		const otherUniverse = getUniverseDirectoryContextKey({ accountAddress: '0x00000000000000000000000000000000000000aa', environmentNonce: 5, universeId: 2n })
		expect(isUniverseDirectoryLoadedForContext({ currentContextKey: accountA, hasLoadedUniverseDirectoryPools: true, loadedContextKey: accountA })).toBe(true)
		expect(isUniverseDirectoryLoadedForContext({ currentContextKey: accountB, hasLoadedUniverseDirectoryPools: true, loadedContextKey: accountA })).toBe(false)
		expect(isUniverseDirectoryLoadedForContext({ currentContextKey: otherUniverse, hasLoadedUniverseDirectoryPools: true, loadedContextKey: accountA })).toBe(false)
		expect(isUniverseDirectoryLoadedForContext({ currentContextKey: accountA, hasLoadedUniverseDirectoryPools: false, loadedContextKey: accountA })).toBe(false)
		// The account key ignores address casing.
		expect(getUniverseDirectoryContextKey({ accountAddress: '0x00000000000000000000000000000000000000AA', environmentNonce: 5, universeId: 1n })).toBe(accountA)
	})
})
