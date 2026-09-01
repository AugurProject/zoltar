/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getInvalidStatoblastRouteState } from '../../app/lib/routeValidation.js'

describe('statoblast route validation', () => {
	test('rejects malformed operate-view selectedPoolView state', () => {
		expect(
			getInvalidStatoblastRouteState({
				activeSecurityPoolsView: 'operate',
				openOracleView: '',
				resolvedRoute: 'security-pools',
				search: '?securityPool=0x123&selectedPoolView=invalid',
				securityPoolsView: '',
				selectedPoolView: 'invalid',
			}).hasInvalidSelectedPoolView,
		).toBe(true)
	})

	test('rejects empty security-pools and open-oracle view parameters', () => {
		expect(
			getInvalidStatoblastRouteState({
				activeSecurityPoolsView: 'browse',
				openOracleView: '',
				resolvedRoute: 'security-pools',
				search: '?securityPoolsView=',
				securityPoolsView: '',
				selectedPoolView: '',
			}).hasInvalidSecurityPoolsView,
		).toBe(true)
		expect(
			getInvalidStatoblastRouteState({
				activeSecurityPoolsView: 'browse',
				openOracleView: '',
				resolvedRoute: 'open-oracle',
				search: '?openOracleView=',
				securityPoolsView: '',
				selectedPoolView: '',
			}).hasInvalidOpenOracleView,
		).toBe(true)
	})

	test('rejects view parameters on the wrong routes and selectedPoolView without operate state', () => {
		expect(
			getInvalidStatoblastRouteState({
				activeSecurityPoolsView: 'browse',
				openOracleView: '',
				resolvedRoute: 'deploy',
				search: '?securityPoolsView=invalid',
				securityPoolsView: 'invalid',
				selectedPoolView: '',
			}).hasInvalidSecurityPoolsView,
		).toBe(true)
		expect(
			getInvalidStatoblastRouteState({
				activeSecurityPoolsView: 'browse',
				openOracleView: 'invalid',
				resolvedRoute: 'security-pools',
				search: '?openOracleView=invalid',
				securityPoolsView: '',
				selectedPoolView: '',
			}).hasInvalidOpenOracleView,
		).toBe(true)
		expect(
			getInvalidStatoblastRouteState({
				activeSecurityPoolsView: 'browse',
				openOracleView: '',
				resolvedRoute: 'security-pools',
				search: '?selectedPoolView=vaults',
				securityPoolsView: '',
				selectedPoolView: 'vaults',
			}).hasInvalidSelectedPoolView,
		).toBe(true)
	})
})
