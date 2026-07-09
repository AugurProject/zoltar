/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSelectedVaultAddressForRoutePoolChange, shouldLoadOpenOracleReportFromUrl, shouldRefreshSelectedPoolForRoute, shouldSyncSecurityPoolAddressToRouteForms } from '../hooks/useAppRouteEffects.js'

describe('app route effects', () => {
	test('loads the open oracle report from the URL only on the open-oracle route', () => {
		expect(shouldLoadOpenOracleReportFromUrl({ environmentReady: true, route: 'open-oracle', urlOpenOracleReportId: '1' })).toBe(true)
		expect(shouldLoadOpenOracleReportFromUrl({ environmentReady: false, route: 'open-oracle', urlOpenOracleReportId: '1' })).toBe(false)
		expect(shouldLoadOpenOracleReportFromUrl({ environmentReady: true, route: 'zoltar', urlOpenOracleReportId: '1' })).toBe(false)
		expect(shouldLoadOpenOracleReportFromUrl({ environmentReady: true, route: 'security-pools', urlOpenOracleReportId: '1' })).toBe(false)
		expect(shouldLoadOpenOracleReportFromUrl({ environmentReady: true, route: 'open-oracle', urlOpenOracleReportId: '' })).toBe(false)
	})

	test('refreshes the selected pool only on the security-pools route when the pool is unresolved', () => {
		expect(
			shouldRefreshSelectedPoolForRoute({
				environmentReady: true,
				route: 'security-pools',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(true)

		expect(
			shouldRefreshSelectedPoolForRoute({
				environmentReady: false,
				route: 'security-pools',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolForRoute({
				environmentReady: true,
				route: 'zoltar',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolForRoute({
				environmentReady: true,
				route: 'security-pools',
				securityPoolAddress: '',
				selectedPoolSecurityPoolAddress: undefined,
				walletBootstrapComplete: true,
			}),
		).toBe(false)

		expect(
			shouldRefreshSelectedPoolForRoute({
				environmentReady: true,
				route: 'security-pools',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				selectedPoolSecurityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				walletBootstrapComplete: true,
			}),
		).toBe(false)
	})

	test('syncs the selected security pool address into route forms only on the security-pools route', () => {
		expect(
			shouldSyncSecurityPoolAddressToRouteForms({
				route: 'security-pools',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
			}),
		).toBe(true)

		expect(
			shouldSyncSecurityPoolAddressToRouteForms({
				route: 'zoltar',
				securityPoolAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
			}),
		).toBe(false)

		expect(
			shouldSyncSecurityPoolAddressToRouteForms({
				route: 'security-pools',
				securityPoolAddress: '',
			}),
		).toBe(true)
	})

	test('resets the selected vault only when the selected pool changes on the security-pools route', () => {
		expect(
			getSelectedVaultAddressForRoutePoolChange({
				accountAddress: undefined,
				lastSecurityPoolAddress: '0x1111111111111111111111111111111111111111',
				route: 'security-pools',
				securityPoolAddress: '0x2222222222222222222222222222222222222222',
			}),
		).toBe('')

		expect(
			getSelectedVaultAddressForRoutePoolChange({
				accountAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				lastSecurityPoolAddress: '0x1111111111111111111111111111111111111111',
				route: 'security-pools',
				securityPoolAddress: '0x2222222222222222222222222222222222222222',
			}),
		).toBe('0x84834d4Dccea071b363e53952BD300F7bf56a009')

		expect(
			getSelectedVaultAddressForRoutePoolChange({
				accountAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				lastSecurityPoolAddress: '0x1111111111111111111111111111111111111111',
				route: 'security-pools',
				securityPoolAddress: '   ',
			}),
		).toBe('')

		expect(
			getSelectedVaultAddressForRoutePoolChange({
				accountAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				lastSecurityPoolAddress: '0x1111111111111111111111111111111111111111',
				route: 'security-pools',
				securityPoolAddress: '0x1111111111111111111111111111111111111111',
			}),
		).toBeUndefined()

		expect(
			getSelectedVaultAddressForRoutePoolChange({
				accountAddress: '0x84834d4Dccea071b363e53952BD300F7bf56a009',
				lastSecurityPoolAddress: undefined,
				route: 'zoltar',
				securityPoolAddress: '0x2222222222222222222222222222222222222222',
			}),
		).toBeUndefined()
	})
})
