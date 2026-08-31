import type { IndexerOwnershipStatus } from './indexer.ts'

export type BasicAccessCredentials = {
	readonly username: string
	readonly password: string
}

export const parseBasicAccessCredentials = (username: string | undefined, password: string | undefined): BasicAccessCredentials | undefined => {
	if ((username === undefined || username === '') && (password === undefined || password === '')) return undefined
	if (username === undefined || username === '' || password === undefined || password === '')
		throw new Error('AUGURSCAN_ACCESS_USERNAME and AUGURSCAN_ACCESS_PASSWORD must be configured together')
	if (username.includes(':')) throw new Error('AUGURSCAN_ACCESS_USERNAME must not contain a colon')
	return { username, password }
}

const exactString = (left: string, right: string): boolean => {
	const length = Math.max(left.length, right.length)
	let difference = left.length ^ right.length
	for (let index = 0; index < length; index++) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
	return difference === 0
}

export const hasBasicAccess = (request: Request, credentials: BasicAccessCredentials | undefined): boolean => {
	if (credentials === undefined) return true
	const authorization = request.headers.get('authorization')
	if (authorization === null || !authorization.startsWith('Basic ')) return false
	try {
		const encodedBytes = atob(authorization.slice('Basic '.length))
		const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(encodedBytes, (value) => value.charCodeAt(0)))
		const separator = decoded.indexOf(':')
		if (separator < 0) return false
		return exactString(decoded.slice(0, separator), credentials.username) && exactString(decoded.slice(separator + 1), credentials.password)
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

export const basicAccessRequiredResponse = (headers: Readonly<Record<string, string>> = {}): Response =>
	Response.json({ error: 'Authentication required' }, { status: 401, headers: { ...headers, 'www-authenticate': 'Basic realm="augurScan", charset="UTF-8"' } })

export const createFixedWindowRateLimiter = (limit: number, windowMs: number, maximumClients = 10_000) => {
	if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Rate limit must be a non-negative safe integer')
	if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error('Rate-limit window must be a positive safe integer')
	if (!Number.isSafeInteger(maximumClients) || maximumClients <= 0) throw new Error('Rate-limit client capacity must be a positive safe integer')
	const windows = new Map<string, { count: number; startedAt: number }>()
	return (client: string, now = Date.now()): { readonly allowed: boolean; readonly retryAfterSeconds?: number } => {
		if (limit === 0) return { allowed: true }
		let current = windows.get(client)
		if (current === undefined || now - current.startedAt >= windowMs) {
			if (current === undefined && windows.size >= maximumClients) {
				for (const [key, value] of windows) {
					if (now - value.startedAt >= windowMs) windows.delete(key)
				}
				const oldestClient = windows.keys().next().value
				if (windows.size >= maximumClients && typeof oldestClient === 'string') windows.delete(oldestClient)
			}
			current = { count: 0, startedAt: now }
			windows.set(client, current)
		}
		if (current.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000)) }
		current.count++
		return { allowed: true }
	}
}

export const requestAccessGuard = (
	request: Request,
	pathname: string,
	client: string,
	credentials: BasicAccessCredentials | undefined,
	admitApiRequest: (client: string) => { readonly allowed: boolean; readonly retryAfterSeconds?: number },
	headers: Readonly<Record<string, string>> = {},
): { readonly reason: 'authentication' | 'rate-limit'; readonly response: Response } | undefined => {
	if (pathname.startsWith('/api/')) {
		const admission = admitApiRequest(client)
		if (!admission.allowed)
			return {
				reason: 'rate-limit',
				response: Response.json(
					{ error: 'Rate limit exceeded; retry shortly' },
					{ status: 429, headers: { ...headers, 'retry-after': String(admission.retryAfterSeconds ?? 1) } },
				),
			}
	}
	if (!hasBasicAccess(request, credentials)) return { reason: 'authentication', response: basicAccessRequiredResponse(headers) }
	return undefined
}

export const metricRoute = (pathname: string): string => {
	if (pathname === '/health/live' || pathname === '/health/ready' || pathname === '/health/indexers') return pathname
	if (pathname.startsWith('/health/')) return '/health/*'
	if (pathname === '/metrics') return '/metrics'
	if (pathname === '/api/v1/stream') return '/api/v1/stream'
	if (pathname === '/api/v1/export') return '/api/v1/export'
	if (pathname.startsWith('/api/v1/state/')) return '/api/v1/state/*'
	if (pathname.startsWith('/api/v1/logs')) return '/api/v1/logs/*'
	if (pathname.startsWith('/api/')) return '/api/*'
	return 'static'
}

const prometheusLabel = (value: string): string => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')

export const createRequestMetrics = () => {
	const counts = new Map<string, number>()
	const durationSums = new Map<string, number>()
	let rateLimitRejections = 0
	return {
		observe(route: string, response: Response, durationSeconds: number): void {
			const key = `${route}\u0000${response.status}`
			counts.set(key, (counts.get(key) ?? 0) + 1)
			durationSums.set(route, (durationSums.get(route) ?? 0) + durationSeconds)
		},
		recordRateLimitRejection(): void {
			rateLimitRejections++
		},
		serialize(extraLines: readonly string[] = []): string {
			const lines = ['# HELP augurscan_http_requests_total HTTP responses by bounded route and status.', '# TYPE augurscan_http_requests_total counter']
			for (const [key, count] of [...counts].toSorted(([left], [right]) => left.localeCompare(right))) {
				const [route = '', status = ''] = key.split('\u0000')
				lines.push(`augurscan_http_requests_total{route="${prometheusLabel(route)}",status="${status}"} ${count}`)
			}
			lines.push('# HELP augurscan_http_request_duration_seconds_sum Cumulative request time by bounded route.')
			lines.push('# TYPE augurscan_http_request_duration_seconds_sum counter')
			for (const [route, seconds] of [...durationSums].toSorted(([left], [right]) => left.localeCompare(right)))
				lines.push(`augurscan_http_request_duration_seconds_sum{route="${prometheusLabel(route)}"} ${seconds}`)
			lines.push('# HELP augurscan_rate_limit_rejections_total Requests rejected by the process-local API limiter.')
			lines.push('# TYPE augurscan_rate_limit_rejections_total counter')
			lines.push(`augurscan_rate_limit_rejections_total ${rateLimitRejections}`)
			return `${[...lines, ...extraLines].join('\n')}\n`
		},
	}
}

type RequestTimeoutServer = {
	readonly timeout: (request: Request, seconds: number) => void
}

export const STATIC_ASSET_CACHE_CONTROL = 'no-cache'

export const staticAssetResponse = (body: BodyInit, securityHeaders: Readonly<Record<string, string>>, contentType: string) =>
	new Response(body, { headers: { ...securityHeaders, 'cache-control': STATIC_ASSET_CACHE_CONTROL, 'content-type': contentType } })

export const indexerHealthUnavailableResponse = (ownership: readonly IndexerOwnershipStatus[]): Response =>
	Response.json({ status: 'unknown', ownership }, { status: 503 })

export const liveStreamResponse = (
	stream: ReadableStream<Uint8Array>,
	request: Request,
	server: RequestTimeoutServer,
	baseHeaders: Readonly<Record<string, string>> = {},
): Response => {
	server.timeout(request, 0)
	return new Response(stream, {
		headers: {
			...baseHeaders,
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'content-type': 'text/event-stream',
			'x-accel-buffering': 'no',
		},
	})
}
