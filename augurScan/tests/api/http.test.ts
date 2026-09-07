import { describe, expect, test } from 'bun:test'
import {
	basicAccessRequiredResponse,
	createFixedWindowRateLimiter,
	createRequestMetrics,
	hasBasicAccess,
	indexerHealthUnavailableResponse,
	metricRoute,
	parseBasicAccessCredentials,
	requestAccessGuard,
	staticAssetResponse,
} from '../../src/http.ts'
import { reconcileIndexerOwnership } from '../../src/indexer-health.ts'

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

	test('supports optional browser-compatible access protection without partial credentials', async () => {
		expect(parseBasicAccessCredentials(undefined, undefined)).toBeUndefined()
		expect(() => parseBasicAccessCredentials('operator', undefined)).toThrow('must be configured together')
		expect(() => parseBasicAccessCredentials('bad:name', 'secret')).toThrow('must not contain a colon')
		const credentials = parseBasicAccessCredentials('operator', 'secret')
		expect(hasBasicAccess(new Request('http://localhost'), credentials)).toBeFalse()
		expect(hasBasicAccess(new Request('http://localhost', { headers: { authorization: `Basic ${btoa('operator:secret')}` } }), credentials)).toBeTrue()
		expect(hasBasicAccess(new Request('http://localhost', { headers: { authorization: `Basic ${btoa('operator:wrong')}` } }), credentials)).toBeFalse()
		const required = basicAccessRequiredResponse({ 'x-content-type-options': 'nosniff' })
		expect(required.status).toBe(401)
		expect(required.headers.get('www-authenticate')).toContain('Basic realm="augurScan"')
	})

	test('decodes Basic access credentials as strict UTF-8', () => {
		const credentials = parseBasicAccessCredentials('opérateur', 'sëcret🔐')
		const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('opérateur:sëcret🔐')))
		expect(hasBasicAccess(new Request('http://localhost', { headers: { authorization: `Basic ${encoded}` } }), credentials)).toBeTrue()

		const malformed = btoa(String.fromCharCode(0xc3, 0x28, 0x3a, 0x78))
		expect(hasBasicAccess(new Request('http://localhost', { headers: { authorization: `Basic ${malformed}` } }), credentials)).toBeFalse()
	})

	test('rate limits repeated API requests before rejecting invalid credentials', async () => {
		const credentials = parseBasicAccessCredentials('operator', 'secret')
		const admit = createFixedWindowRateLimiter(2, 60_000)
		const request = new Request('http://localhost/api/v1/logs', {
			headers: { authorization: `Basic ${btoa('operator:wrong')}` },
		})
		const first = requestAccessGuard(request, '/api/v1/logs', '192.0.2.1', credentials, admit)
		const second = requestAccessGuard(request, '/api/v1/logs', '192.0.2.1', credentials, admit)
		const third = requestAccessGuard(request, '/api/v1/logs', '192.0.2.1', credentials, admit)

		expect(first?.reason).toBe('authentication')
		expect(first?.response.status).toBe(401)
		expect(second?.response.status).toBe(401)
		expect(third?.reason).toBe('rate-limit')
		expect(third?.response.status).toBe(429)
		expect(third?.response.headers.get('retry-after')).toBe('60')
		expect(await third?.response.json()).toEqual({ error: 'Rate limit exceeded; retry shortly' })
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
		expect(output).toContain('augurscan_http_requests_total{route="/api/v1/logs/*",status="200"} 1')
		expect(output).toContain('augurscan_http_request_duration_seconds_sum{route="/api/v1/logs/*"} 0.25')
		expect(output).toContain('augurscan_rate_limit_rejections_total 1')
		expect(output).toContain('augurscan_indexer_lag_blocks{chain_id="1"} 2')
	})
})
