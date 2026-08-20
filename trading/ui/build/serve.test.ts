import { describe, expect, test } from 'bun:test'
import { serveTradingAsset } from './serve.mts'

describe('trading UI asset server', () => {
	test('protects responses and prevents a stale core deployment registry', () => {
		const coreDeployments = serveTradingAsset(new Request('http://localhost:4163/core-deployments.json'))
		expect(coreDeployments.headers.get('cache-control')).toBe('no-store')
		expect(coreDeployments.headers.get('content-security-policy')).toContain("default-src 'self'")
		expect(coreDeployments.headers.get('x-content-type-options')).toBe('nosniff')

		const missing = serveTradingAsset(new Request('http://localhost:4163/missing'))
		expect(missing.status).toBe(404)
		expect(missing.headers.get('x-frame-options')).toBe('DENY')
	})
})
