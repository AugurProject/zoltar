/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getInvalidStatoblastRouteState, isInvalidStatoblastRouteState } from '../../app/lib/routeValidation.js'

type RouteValidationInput = Parameters<typeof getInvalidStatoblastRouteState>[0]

function validateRoute(overrides: Partial<RouteValidationInput>) {
	return getInvalidStatoblastRouteState({ pageSearch: '', resolvedRoute: 'pools', search: '', selectedPoolView: '', ...overrides })
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

	test('rejects every removed oracle view on all Statoblast routes', () => {
		for (const resolvedRoute of ['open-oracle', 'pools', 'portfolios', 'deploy'] as const) {
			for (const view of ['', 'browse', 'create', 'selected-report', 'invalid']) {
				expect(validateRoute({ resolvedRoute, search: `?openOracleView=${view}&openOracleReportId=9` }).hasInvalidOpenOracleView).toBe(true)
			}
			expect(isRouteInvalid({ resolvedRoute, search: '?openOracleReportId=9' })).toBe(false)
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
