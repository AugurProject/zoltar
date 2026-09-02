/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { hasInvalidZoltarView } from '../../app/lib/routeValidation.js'

describe('zoltar route validation', () => {
	test('accepts known zoltar views', () => {
		expect(hasInvalidZoltarView({ resolvedRoute: 'zoltar', search: '?zoltarView=questions', zoltarView: 'questions' })).toBe(false)
		expect(hasInvalidZoltarView({ resolvedRoute: 'zoltar', search: '', zoltarView: '' })).toBe(false)
	})

	test('rejects empty and unknown zoltar views', () => {
		expect(hasInvalidZoltarView({ resolvedRoute: 'zoltar', search: '?zoltarView=', zoltarView: '' })).toBe(true)
		expect(hasInvalidZoltarView({ resolvedRoute: 'zoltar', search: '?zoltarView=bad-view', zoltarView: 'bad-view' })).toBe(true)
		expect(hasInvalidZoltarView({ resolvedRoute: 'deploy', search: '?zoltarView=questions', zoltarView: 'questions' })).toBe(true)
	})
})
