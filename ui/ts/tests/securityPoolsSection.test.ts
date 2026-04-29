/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldRefreshSelectedPoolDataOnViewOpen } from '../components/SecurityPoolsSection.js'

void describe('security pools selected tab refresh', () => {
	const currentSecurityPoolAddress = '0x1234567890123456789012345678901234567890'
	const nextSecurityPoolAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

	void test('refreshes selected pool data only when reopening the selected pool view for the same address', () => {
		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'browse',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'create',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: '',
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress: currentSecurityPoolAddress,
			}),
		).toBe(true)

		expect(
			shouldRefreshSelectedPoolDataOnViewOpen({
				currentSecurityPoolAddress,
				nextView: 'operate',
				nextSecurityPoolAddress,
			}),
		).toBe(false)
	})
})
