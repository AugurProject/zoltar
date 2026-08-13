import { describe, expect, test } from 'bun:test'
import { indexerHealthUnavailableResponse, staticAssetResponse } from '../src/http.ts'

describe('HTTP response policy', () => {
	test('revalidates stable asset names after a deployment', () => {
		const response = staticAssetResponse('app', { 'x-content-type-options': 'nosniff' }, 'text/html; charset=utf-8')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
	})

	test('retains process-local ownership diagnostics when the health database is unavailable', async () => {
		const ownership = [
			{
				networkId: 'sepolia',
				active: false,
				failuresTotal: 3,
				reacquisitionsTotal: 1,
				consecutiveFailures: 2,
				lastFailureAt: '2026-08-13T10:00:00.000Z',
				lastFailureStage: 'verify' as const,
			},
		]
		const response = indexerHealthUnavailableResponse(ownership)

		expect(response.status).toBe(503)
		expect(await response.json()).toEqual({ status: 'unknown', ownership })
	})
})
