/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { hasInvalidViewQueryParam } from '../navigation/viewQueryParam.js'

const allowedViews = ['browse', 'create'] as const

void describe('hasInvalidViewQueryParam', () => {
	void test('accepts an absent or known view on an owning route', () => {
		expect(hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews, key: 'view', resolvedRoute: 'zoltar', search: '', value: '' })).toBe(false)
		expect(hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews, key: 'view', resolvedRoute: 'zoltar', search: '?view=create', value: 'create' })).toBe(false)
		expect(hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews, key: 'view', resolvedRoute: 'deploy', search: '', value: '' })).toBe(false)
	})

	void test('rejects empty, foreign-route, and unknown view values', () => {
		expect(hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews, key: 'view', resolvedRoute: 'zoltar', search: '?view=', value: '' })).toBe(true)
		expect(hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews, key: 'view', resolvedRoute: 'deploy', search: '?view=browse', value: 'browse' })).toBe(true)
		expect(hasInvalidViewQueryParam({ allowedRoutes: ['zoltar'], allowedViews, key: 'view', resolvedRoute: 'zoltar', search: '?view=other', value: 'other' })).toBe(true)
	})
})
