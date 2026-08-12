import { describe, expect, test } from 'bun:test'
import { staticAssetResponse } from '../src/http.ts'

describe('HTTP response policy', () => {
	test('revalidates stable asset names after a deployment', () => {
		const response = staticAssetResponse('app', { 'x-content-type-options': 'nosniff' }, 'text/html; charset=utf-8')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
	})
})
