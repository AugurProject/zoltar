/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { isInvalidZoltarRoute } from '../../app/lib/routeValidation.js'

describe('zoltar route validation', () => {
	test('accepts known zoltar views', () => {
		expect(isInvalidZoltarRoute({ resolvedRoute: 'zoltar', search: '?zoltarView=questions', zoltarView: 'questions' })).toBe(false)
		expect(isInvalidZoltarRoute({ resolvedRoute: 'zoltar', search: '', zoltarView: '' })).toBe(false)
		for (const view of ['overview', 'universes', 'fork', 'migrate']) expect(isInvalidZoltarRoute({ resolvedRoute: 'zoltar', search: `?zoltarView=${view}`, zoltarView: view })).toBe(false)
	})

	test('rejects empty and unknown zoltar views', () => {
		expect(isInvalidZoltarRoute({ resolvedRoute: 'zoltar', search: '?zoltarView=', zoltarView: '' })).toBe(true)
		expect(isInvalidZoltarRoute({ resolvedRoute: 'zoltar', search: '?zoltarView=bad-view', zoltarView: 'bad-view' })).toBe(true)
		expect(isInvalidZoltarRoute({ resolvedRoute: 'deploy', search: '?zoltarView=questions', zoltarView: 'questions' })).toBe(true)
	})

	test('rejects a malformed universe instead of silently opening Genesis', () => {
		for (const resolvedRoute of ['zoltar', 'deploy'] as const) {
			for (const search of ['?universe=abc', '?universe=-1', '?universe=']) expect(isInvalidZoltarRoute({ resolvedRoute, search, zoltarView: '' })).toBe(true)
			expect(isInvalidZoltarRoute({ resolvedRoute, search: '?universe=0', zoltarView: '' })).toBe(false)
			expect(isInvalidZoltarRoute({ resolvedRoute, search: '?universe=7&simulate=1', zoltarView: '' })).toBe(false)
		}
	})
})
