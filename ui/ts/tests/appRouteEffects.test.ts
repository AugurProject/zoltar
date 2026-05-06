/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { shouldLoadOpenOracleReportFromUrl, shouldRefreshSelectedPoolForRoute } from '../hooks/useAppRouteEffects.js'

describe('app route effects', () => {
	test('loads the open oracle report from the URL only on the open-oracle route', () => {
		expect(shouldLoadOpenOracleReportFromUrl({ route: 'open-oracle', urlOpenOracleReportId: '1' })).toBe(true)
		expect(shouldLoadOpenOracleReportFromUrl({ route: 'zoltar', urlOpenOracleReportId: '1' })).toBe(false)
		expect(shouldLoadOpenOracleReportFromUrl({ route: 'security-pools', urlOpenOracleReportId: '1' })).toBe(false)
		expect(shouldLoadOpenOracleReportFromUrl({ route: 'open-oracle', urlOpenOracleReportId: '' })).toBe(false)
	})

	test('refreshes the selected pool only on the security-pools route when the pool is unresolved', () => {
		expect(
			shouldRefreshSelectedPoolForRoute({
				route: 'security-pools',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(true)

		expect(
			shouldRefreshSelectedPoolForRoute({
				route: 'zoltar',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolForRoute({
				route: 'security-pools',
				securityPoolAddress: '',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolForRoute({
				route: 'security-pools',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				walletBootstrapComplete: true,
			}),
		).toBe(false)
	})
})
