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

export const requestRateLimitGuard = (pathname: string, client: string, admitRequest: ReturnType<typeof createFixedWindowRateLimiter>, headers: Readonly<Record<string, string>> = {}): Response | undefined => {
	if (!pathname.startsWith('/api/')) return undefined
	const admission = admitRequest(client)
	if (admission.allowed) return undefined
	return Response.json({ error: 'Rate limit exceeded; retry shortly' }, { status: 429, headers: { ...headers, 'retry-after': String(admission.retryAfterSeconds ?? 1) } })
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
			for (const [route, seconds] of [...durationSums].toSorted(([left], [right]) => left.localeCompare(right))) lines.push(`augurscan_http_request_duration_seconds_sum{route="${prometheusLabel(route)}"} ${seconds}`)
			lines.push('# HELP augurscan_rate_limit_rejections_total Requests rejected by the process-local request limiter.')
			lines.push('# TYPE augurscan_rate_limit_rejections_total counter')
			lines.push(`augurscan_rate_limit_rejections_total ${rateLimitRejections}`)
			return `${[...lines, ...extraLines].join('\n')}\n`
		},
	}
}

type RequestTimeoutServer = {
	readonly timeout: (request: Request, seconds: number) => void
}

const STATIC_ASSET_CACHE_CONTROL = 'no-cache'

export const SECURITY_HEADERS = {
	'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
}

const STATIC_CONTENT_TYPES = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.map', 'application/json; charset=utf-8'],
	['.txt', 'text/plain; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.ico', 'image/x-icon'],
	['.woff2', 'font/woff2'],
])

/** Responses are served with nosniff, so an unknown extension must not be labelled as HTML. */
export const staticContentType = (pathname: string): string => {
	const extensionStart = pathname.lastIndexOf('.')
	const extension = extensionStart < 0 ? '' : pathname.slice(extensionStart).toLowerCase()
	return STATIC_CONTENT_TYPES.get(extension) ?? 'application/octet-stream'
}

export const withSecurityHeaders = (response: Response, securityHeaders: Readonly<Record<string, string>>): Response => {
	for (const [name, value] of Object.entries(securityHeaders)) {
		if (!response.headers.has(name)) response.headers.set(name, value)
	}
	return response
}

export const staticAssetResponse = (body: BodyInit, securityHeaders: Readonly<Record<string, string>>, contentType: string) => new Response(body, { headers: { ...securityHeaders, 'cache-control': STATIC_ASSET_CACHE_CONTROL, 'content-type': contentType } })

export const indexerHealthUnavailableResponse = (ownership: readonly { readonly networkId: string }[]): Response => Response.json({ status: 'unknown', ownership }, { status: 503 })

export const liveStreamResponse = (stream: ReadableStream<Uint8Array>, request: Request, server: RequestTimeoutServer, baseHeaders: Readonly<Record<string, string>> = {}): Response => {
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
