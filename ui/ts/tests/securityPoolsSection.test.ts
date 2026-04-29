/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldRefreshSelectedPoolDataOnViewOpen } from '../components/SecurityPoolsSection.js'

void describe('security pools selected tab refresh', () => {
	const currentSecurityPoolAddress = '0x1234567890123456789012345678901234567890'
	const nextSecurityPoolAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

	void test('refreshes selected pool data only when opening the selected pool view for a pool that is not already loaded', () => {
		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'browse',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'create',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: '',
				selectedPoolExists: false,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(true)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress,
				selectedPoolExists: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress,
				selectedPoolExists: false,
			}),
		).toBe(true)
	})
})
