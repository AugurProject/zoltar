/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getInvalidStatoblastRouteState, isInvalidStatoblastRouteState } from '../../app/lib/routeValidation.js'

type RouteValidationInput = Parameters<typeof getInvalidStatoblastRouteState>[0]

function validateRoute(overrides: Partial<RouteValidationInput>) {
	return getInvalidStatoblastRouteState({ openOracleView: '', pageSearch: '', resolvedRoute: 'pools', search: '', selectedPoolView: '', ...overrides })
}

function isRouteInvalid(overrides: Partial<RouteValidationInput>) {
	return isInvalidStatoblastRouteState(validateRoute(overrides))
}

describe('statoblast route validation', () => {
	test('rejects an unknown pool tab on the pool route', () => {
		expect(validateRoute({ selectedPoolView: 'invalid' }).hasInvalidSelectedPoolView).toBe(true)
	})

	test('accepts current and legacy pool tabs and pool pages without a tab', () => {
		for (const selectedPoolView of ['', 'vaults', 'fork-workflow', 'fork-auction', 'resolution']) {
			expect(validateRoute({ selectedPoolView }).hasInvalidSelectedPoolView).toBe(false)
		}
	})

	test('rejects empty and unknown OpenOracle views', () => {
		expect(validateRoute({ resolvedRoute: 'open-oracle', search: '?openOracleView=' }).hasInvalidOpenOracleView).toBe(true)
		expect(validateRoute({ openOracleView: 'browse', search: '?openOracleView=browse' }).hasInvalidOpenOracleView).toBe(false)
		expect(validateRoute({ openOracleView: 'invalid', resolvedRoute: 'open-oracle', search: '?openOracleView=invalid' }).hasInvalidOpenOracleView).toBe(true)
		expect(validateRoute({ openOracleView: 'selected-report', resolvedRoute: 'open-oracle', search: '?openOracleView=selected-report&openOracleReportId=9' }).hasInvalidOpenOracleView).toBe(false)
	})

	test('accepts a remembered OpenOracle view while visiting Pools or Deploy', () => {
		for (const resolvedRoute of ['pools', 'deploy'] as const) {
			expect(validateRoute({ openOracleView: 'selected-report', resolvedRoute, search: '?openOracleView=selected-report&openOracleReportId=9' }).hasInvalidOpenOracleView).toBe(false)
		}
	})

	test('rejects a malformed universe instead of silently opening Genesis', () => {
		for (const search of ['?universe=abc', '?universe=-1', '?universe=']) {
			expect(isRouteInvalid({ search })).toBe(true)
			expect(isRouteInvalid({ pageSearch: search })).toBe(true)
		}
		expect(isRouteInvalid({ search: '?universe=0' })).toBe(false)
		expect(isRouteInvalid({ pageSearch: '?universe=7&simulate=1' })).toBe(false)
	})
})
