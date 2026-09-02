/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldAutoLoadUniverseDirectory } from '../../app/lib/universeDirectory.js'

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
})
