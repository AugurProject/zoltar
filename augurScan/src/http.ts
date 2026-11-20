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

type IpAddress = { readonly version: 4 | 6; readonly bytes: readonly number[] }

/** A trusted reverse proxy, as an address and the number of leading bits that must match. */
export type TrustedProxy = { readonly version: 4 | 6; readonly bytes: readonly number[]; readonly prefixLength: number }

export type ClientKeyConfig = { readonly trustedProxies: readonly TrustedProxy[] }

const parseIpv4 = (text: string): number[] | undefined => {
	const parts = text.split('.')
	if (parts.length !== 4) return undefined
	const bytes: number[] = []
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return undefined
		const value = Number(part)
		if (value > 255) return undefined
		bytes.push(value)
	}
	return bytes
}

const parseIpv6 = (text: string): number[] | undefined => {
	if (!/^[0-9a-fA-F:.]+$/.test(text)) return undefined
	const halves = text.split('::')
	if (halves.length > 2) return undefined
	const groupsOf = (half: string): number[] | undefined => {
		if (half === '') return []
		const groups: number[] = []
		const pieces = half.split(':')
		for (const [index, piece] of pieces.entries()) {
			if (index === pieces.length - 1 && piece.includes('.')) {
				const ipv4 = parseIpv4(piece)
				if (ipv4 === undefined) return undefined
				groups.push(((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0), ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0))
				continue
			}
			if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return undefined
			groups.push(Number.parseInt(piece, 16))
		}
		return groups
	}
	const head = groupsOf(halves[0] ?? '')
	const tail = halves.length === 2 ? groupsOf(halves[1] ?? '') : []
	if (head === undefined || tail === undefined) return undefined
	const missing = 8 - head.length - tail.length
	if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined
	return [...head, ...Array.from({ length: missing }, () => 0), ...tail].flatMap(group => [group >> 8, group & 0xff])
}

const isIpv4Mapped = (bytes: readonly number[]): boolean => bytes.length === 16 && bytes.slice(0, 10).every(byte => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff

/** Parses an address, folding IPv4-mapped IPv6 into IPv4 so both spellings name one client. */
const parseIp = (text: string): IpAddress | undefined => {
	const ipv4 = parseIpv4(text)
	if (ipv4 !== undefined) return { version: 4, bytes: ipv4 }
	const zoneStart = text.indexOf('%')
	const ipv6 = parseIpv6(zoneStart < 0 ? text : text.slice(0, zoneStart))
	if (ipv6 === undefined) return undefined
	return isIpv4Mapped(ipv6) ? { version: 4, bytes: ipv6.slice(12) } : { version: 6, bytes: ipv6 }
}

/** Accepts the forms proxies write into X-Forwarded-For: a bare address, `a.b.c.d:port`, or `[v6]:port`. */
const parseForwardedEntry = (entry: string): IpAddress | undefined => {
	const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(entry)
	if (bracketed?.[1] !== undefined) return parseIp(bracketed[1])
	const ipv4WithPort = /^([\d.]+):\d+$/.exec(entry)
	if (ipv4WithPort?.[1] !== undefined) return parseIp(ipv4WithPort[1])
	return parseIp(entry)
}

const ipv6Groups = (bytes: readonly number[]): string[] => Array.from({ length: bytes.length / 2 }, (_, index) => (((bytes[index * 2] ?? 0) << 8) | (bytes[index * 2 + 1] ?? 0)).toString(16))

/** IPv4 clients are keyed by address. IPv6 clients are keyed by /64, the smallest block a single subscriber is normally assigned. */
const addressKey = (address: IpAddress): string => {
	if (address.version === 4) return address.bytes.join('.')
	const groups = ipv6Groups(address.bytes.slice(0, 8))
	while (groups.length > 0 && groups.at(-1) === '0') groups.pop()
	return `${groups.join(':')}::/64`
}

const matchesProxy = (address: IpAddress, proxy: TrustedProxy): boolean => {
	if (address.version !== proxy.version) return false
	for (let bit = 0; bit < proxy.prefixLength; bit += 8) {
		const remaining = proxy.prefixLength - bit
		const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff
		const index = bit / 8
		if (((address.bytes[index] ?? 0) & mask) !== ((proxy.bytes[index] ?? 0) & mask)) return false
	}
	return true
}

const isTrustedProxy = (address: IpAddress, config: ClientKeyConfig): boolean => config.trustedProxies.some(proxy => matchesProxy(address, proxy))

/**
 * Parses `TRUSTED_PROXY_ADDRESSES`: comma-separated exact addresses or CIDR ranges. An empty value trusts no proxy.
 */
export const parseTrustedProxies = (value: string): readonly TrustedProxy[] =>
	value
		.split(',')
		.map(entry => entry.trim())
		.filter(entry => entry !== '')
		.map(entry => {
			const [addressText = '', prefixText, ...extra] = entry.split('/')
			const address = parseIp(addressText)
			const invalid = new Error(`TRUSTED_PROXY_ADDRESSES entry ${JSON.stringify(entry)} must be an IP address or CIDR range`)
			if (address === undefined || extra.length > 0) throw invalid
			const parsed = parseIpv6(addressText)
			const written = parsed !== undefined && isIpv4Mapped(parsed) ? { version: 6 as const, bytes: parsed } : address
			const maximum = written.version === 4 ? 32 : 128
			if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) throw invalid
			const prefixLength = prefixText === undefined ? maximum : Number(prefixText)
			if (prefixLength > maximum) throw invalid
			// An IPv4-mapped range covers the IPv4 addresses that parseIp folds it into.
			if (written !== address) return prefixLength >= 96 ? { ...address, prefixLength: prefixLength - 96 } : { ...written, prefixLength }
			return { ...address, prefixLength }
		})

/**
 * The rate-limit and live-stream key for a request. X-Forwarded-For is read only from a configured trusted proxy,
 * and only its right-most entry that is not itself a trusted proxy is used: entries to its left are client-supplied.
 */
export const clientKey = (socketAddress: string | undefined, headers: Headers, config: ClientKeyConfig): string => {
	if (socketAddress === undefined) return 'unknown'
	const socket = parseIp(socketAddress)
	if (socket === undefined) return socketAddress
	if (!isTrustedProxy(socket, config)) return addressKey(socket)
	const forwarded = headers.get('x-forwarded-for')
	if (forwarded === null) return addressKey(socket)
	const entries = forwarded.split(',').map(entry => entry.trim())
	let client = socket
	for (let index = entries.length - 1; index >= 0; index--) {
		const address = parseForwardedEntry(entries[index] ?? '')
		if (address === undefined) return addressKey(socket)
		client = address
		if (!isTrustedProxy(address, config)) break
	}
	return addressKey(client)
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
