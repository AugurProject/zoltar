/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldRefreshSelectedPoolDataOnViewOpen } from '../components/SecurityPoolsSection.js'

void describe('security pools selected tab refresh', () => {
	const securityPoolAddress = '0x1234567890123456789012345678901234567890'

	void test('refreshes selected pool data only when opening the selected pool view with a filled address', () => {
		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				nextView: 'browse',
				securityPoolAddress,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				nextView: 'create',
				securityPoolAddress,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				nextView: 'operate',
				securityPoolAddress: '',
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				nextView: 'operate',
				securityPoolAddress,
			}),
		).toBe(true)
	})
})
