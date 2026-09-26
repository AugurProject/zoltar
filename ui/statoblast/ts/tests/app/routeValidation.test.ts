/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getInvalidStatoblastRouteState } from '../../app/lib/routeValidation.js'

describe('statoblast route validation', () => {
	test('rejects an unknown pool tab on the pool route', () => {
		expect(getInvalidStatoblastRouteState({ openOracleView: '', resolvedRoute: 'pools', search: '', selectedPoolView: 'invalid' }).hasInvalidSelectedPoolView).toBe(true)
	})

	test('accepts current and legacy pool tabs and pool pages without a tab', () => {
		for (const selectedPoolView of ['', 'vaults', 'fork-workflow', 'fork-auction', 'resolution']) {
			expect(getInvalidStatoblastRouteState({ openOracleView: '', resolvedRoute: 'pools', search: '', selectedPoolView }).hasInvalidSelectedPoolView).toBe(false)
		}
	})

	test('rejects empty, misplaced, and unknown Open Oracle views', () => {
		expect(getInvalidStatoblastRouteState({ openOracleView: '', resolvedRoute: 'open-oracle', search: '?openOracleView=', selectedPoolView: '' }).hasInvalidOpenOracleView).toBe(true)
		expect(getInvalidStatoblastRouteState({ openOracleView: 'browse', resolvedRoute: 'pools', search: '?openOracleView=browse', selectedPoolView: '' }).hasInvalidOpenOracleView).toBe(true)
		expect(getInvalidStatoblastRouteState({ openOracleView: 'invalid', resolvedRoute: 'open-oracle', search: '?openOracleView=invalid', selectedPoolView: '' }).hasInvalidOpenOracleView).toBe(true)
		expect(getInvalidStatoblastRouteState({ openOracleView: 'selected-report', resolvedRoute: 'open-oracle', search: '?openOracleView=selected-report&openOracleReportId=9', selectedPoolView: '' }).hasInvalidOpenOracleView).toBe(false)
	})
})
