import { describe, expect, test } from 'bun:test'
import { reconcileIndexerOwnership } from '../../src/database/indexer-ownership-reconciliation.ts'
import { createFixedWindowRateLimiter, createRequestMetrics, indexerHealthUnavailableResponse, metricRoute, requestRateLimitGuard, SECURITY_HEADERS, staticAssetResponse, staticContentType, withSecurityHeaders } from '../../src/http.ts'

describe('HTTP response policy', () => {
	test('reconciles durable ownership heartbeats with actual PostgreSQL advisory locks', () => {
		const networks = [
			{ chain_id: '1', id: 'mainnet' },
			{ chain_id: '2', id: 'sepolia' },
			{ chain_id: '3', id: 'released' },
			{ chain_id: '4', id: 'failed-release' },
			{ chain_id: '5', id: 'unrecorded-lock' },
		]
		const ownership = [
			{ chain_id: '1', state: 'owned', backend_pid: 41, owner_run_id: '9', heartbeat_at: '2026-08-13T10:00:00.000Z' },
			{ chain_id: '2', state: 'owned', backend_pid: 42, owner_run_id: '9', heartbeat_at: '2026-08-13T09:00:00.000Z' },
			{ chain_id: '3', state: 'released', backend_pid: null, owner_run_id: '9', heartbeat_at: '2026-08-13T10:00:00.000Z' },
			{ chain_id: '4', state: 'release-failed', backend_pid: 44, owner_run_id: '9', heartbeat_at: '2026-08-13T10:00:00.000Z' },
		]
		const locks = [
			{ chain_id: '1', backend_pid: 41 },
			{ chain_id: '2', backend_pid: 42 },
			{ chain_id: '4', backend_pid: 44 },
			{ chain_id: '5', backend_pid: 45 },
		]
		const result = reconcileIndexerOwnership(networks, ownership, locks, Date.parse('2026-08-13T09:59:00.000Z'))
		expect(result.map(({ networkId, state }) => [networkId, state])).toEqual([
			['mainnet', 'owned'],
			['sepolia', 'stale-owner'],
			['released', 'standby'],
			['failed-release', 'release-failed'],
			['unrecorded-lock', 'unknown'],
		])
	})

	test('revalidates stable asset names after a deployment', () => {
		const response = staticAssetResponse('app', { 'x-content-type-options': 'nosniff' }, 'text/html; charset=utf-8')
		expect(response.headers.get('cache-control')).toBe('no-cache')
		expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
	})

	test('serves each static extension with its own media type instead of defaulting to HTML', () => {
		expect(staticContentType('index.html')).toBe('text/html; charset=utf-8')
		expect(staticContentType('styles.css')).toBe('text/css; charset=utf-8')
		expect(staticContentType('app.js')).toBe('text/javascript; charset=utf-8')
		expect(staticContentType('favicon.svg')).toBe('image/svg+xml')
		expect(staticContentType('app.js.map')).toBe('application/json; charset=utf-8')
		expect(staticContentType('icon.PNG')).toBe('image/png')
		expect(staticContentType('archive.unknown')).toBe('application/octet-stream')
	})

	test('restricts form targets and plugins without allowing inline styles', () => {
		const policy = SECURITY_HEADERS['content-security-policy']
		expect(policy).toContain("form-action 'self'")
		expect(policy).toContain("object-src 'none'")
		expect(policy).toContain("style-src 'self'")
		expect(policy).not.toContain('unsafe-inline')
	})

	test('adds security headers to responses that were built without them', () => {
		const response = withSecurityHeaders(Response.json({ status: 'ok' }), SECURITY_HEADERS)
		expect(response.headers.get('x-content-type-options')).toBe('nosniff')
		expect(response.headers.get('x-frame-options')).toBe('DENY')
		expect(response.headers.get('content-security-policy')).toBe(SECURITY_HEADERS['content-security-policy'])
		expect(response.headers.get('content-type')).toContain('application/json')
		const preset = withSecurityHeaders(new Response('x', { headers: { 'referrer-policy': 'same-origin' } }), SECURITY_HEADERS)
		expect(preset.headers.get('referrer-policy')).toBe('same-origin')
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

	test('admits API requests without authentication and preserves rate-limit response policy', async () => {
		const admit = createFixedWindowRateLimiter(2, 60_000)
		expect(requestRateLimitGuard('/api/v1/logs', '192.0.2.1', admit)).toBeUndefined()
		expect(requestRateLimitGuard('/api/v1/logs', '192.0.2.1', admit)).toBeUndefined()
		const denied = requestRateLimitGuard('/api/v1/logs', '192.0.2.1', admit, SECURITY_HEADERS)
		expect(denied?.status).toBe(429)
		expect(denied?.headers.get('retry-after')).toBe('60')
		expect(denied?.headers.get('www-authenticate')).toBeNull()
		expect(denied?.headers.get('x-content-type-options')).toBe('nosniff')
		expect(await denied?.json()).toEqual({ error: 'Rate limit exceeded; retry shortly' })
		expect(requestRateLimitGuard('/api/v1/logs', '192.0.2.2', admit)).toBeUndefined()
	})

	test('keeps website and operational routes available after API quota exhaustion', () => {
		const admit = createFixedWindowRateLimiter(1, 60_000)
		const routes = ['/', '/app.js', '/operations/integrity', '/metrics', '/health/indexers', '/health/live', '/health/ready']
		for (const route of routes) expect(requestRateLimitGuard(route, 'client', admit)).toBeUndefined()
		expect(requestRateLimitGuard('/api/v1/stream', 'client', admit)).toBeUndefined()
		expect(requestRateLimitGuard('/api/v1/export', 'client', admit)?.status).toBe(429)
		for (const route of routes) expect(requestRateLimitGuard(route, 'client', admit)).toBeUndefined()
	})

	test('allows unlimited API requests when the limiter is disabled', () => {
		const admit = createFixedWindowRateLimiter(0, 60_000)
		for (let index = 0; index < 3; index++) expect(requestRateLimitGuard('/api/v1/logs', 'client', admit)).toBeUndefined()
	})

	test('bounds request admission per client and resets the fixed window', () => {
		const admit = createFixedWindowRateLimiter(2, 60_000, 2)
		expect(admit('first', 1_000)).toEqual({ allowed: true })
		expect(admit('first', 2_000)).toEqual({ allowed: true })
		expect(admit('first', 3_000)).toEqual({ allowed: false, retryAfterSeconds: 58 })
		expect(admit('first', 61_000)).toEqual({ allowed: true })
		expect(createFixedWindowRateLimiter(0, 60_000)('unlimited')).toEqual({ allowed: true })
	})

	test('emits bounded-route Prometheus counters without path-cardinality leaks', () => {
		expect(metricRoute('/api/v1/logs/1/hash/tx/0')).toBe('/api/v1/logs/*')
		expect(metricRoute('/api/v1/state/reports/1/address/7')).toBe('/api/v1/state/*')
		for (const pathname of ['/health/live', '/health/ready', '/health/indexers']) expect(metricRoute(pathname)).toBe(pathname)
		expect(new Set(Array.from({ length: 1_000 }, (_, index) => metricRoute(`/health/unrecognized-${index}`)))).toEqual(new Set(['/health/*']))
		const metrics = createRequestMetrics()
		metrics.observe('/api/v1/logs/*', new Response(null, { status: 200 }), 0.25)
		metrics.recordRateLimitRejection()
		const output = metrics.serialize(['augurscan_indexer_lag_blocks{chain_id="1"} 2'])
		expect(output).toContain('Requests rejected by the process-local request limiter.')
		expect(output).toContain('augurscan_http_requests_total{route="/api/v1/logs/*",status="200"} 1')
		expect(output).toContain('augurscan_http_request_duration_seconds_sum{route="/api/v1/logs/*"} 0.25')
		expect(output).toContain('augurscan_rate_limit_rejections_total 1')
		expect(output).toContain('augurscan_indexer_lag_blocks{chain_id="1"} 2')
	})
})
