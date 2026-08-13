import { describe, expect, test } from 'bun:test'
import { serveTradingAsset } from './serve.mts'

describe('trading UI asset server', () => {
	test('protects responses and prevents stale deployment configuration', () => {
		const deployment = serveTradingAsset(new Request('http://localhost:4163/deployment.json'))
		expect(deployment.headers.get('cache-control')).toBe('no-store')
		expect(deployment.headers.get('content-security-policy')).toContain("default-src 'self'")
		expect(deployment.headers.get('x-content-type-options')).toBe('nosniff')

		const missing = serveTradingAsset(new Request('http://localhost:4163/missing'))
		expect(missing.status).toBe(404)
		expect(missing.headers.get('x-frame-options')).toBe('DENY')
	})
})
