import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

const MAXIMUM_DASHBOARD_JSON_BYTES = 1024 * 1024

function normalizeDashboardAuthority(authority: string) {
	if (authority !== authority.trim() || authority === '') throw new Error('Dashboard public authority must be a non-empty host with no surrounding whitespace')
	const portSeparator = authority.startsWith('[') ? authority.indexOf(']') + 1 : authority.lastIndexOf(':')
	let hostname = portSeparator > 0 ? authority.slice(0, portSeparator) : authority
	const port = portSeparator > 0 ? authority.slice(portSeparator) : ''
	if (port !== '') {
		if (!/^:[1-9][0-9]{0,4}$/.test(port) || Number(port.slice(1)) > 65_535) throw new Error('Dashboard public authority has an invalid port')
	}
	if (hostname.startsWith('[')) {
		if (!hostname.endsWith(']') || isIP(hostname.slice(1, -1)) !== 6) throw new Error('Dashboard public authority has an invalid IPv6 host')
	} else {
		if (hostname.includes(':') || hostname.includes('[') || hostname.includes(']') || hostname.length > 253) throw new Error('Dashboard public authority has an invalid host')
		const labels = hostname.split('.')
		if (labels.some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) throw new Error('Dashboard public authority has an invalid host')
		if (/^[0-9.]+$/.test(hostname) && isIP(hostname) !== 4) throw new Error('Dashboard public authority has an invalid IPv4 host')
	}
	hostname = hostname.toLowerCase()
	return `${hostname}${port}`
}

export function validateDashboardAuthentication(hostname: '0.0.0.0' | '127.0.0.1', password: string | undefined, loopbackPublished = false, publicAuthority?: string | undefined) {
	if (hostname === '0.0.0.0' && !loopbackPublished && (password === undefined || password.length < 16)) {
		throw new Error('ZOLTAR_BOT_DASHBOARD_PASSWORD must contain at least 16 characters when the dashboard binds to 0.0.0.0')
	}
	if (hostname === '0.0.0.0' && !loopbackPublished && publicAuthority === undefined) {
		throw new Error('ZOLTAR_BOT_DASHBOARD_PUBLIC_AUTHORITY must be set when the dashboard binds directly to a network')
	}
	if (publicAuthority !== undefined) normalizeDashboardAuthority(publicAuthority)
}

export function dashboardAuthorities(port: number, publicAuthority?: string | undefined) {
	const authorities = new Set([`127.0.0.1:${port.toString()}`])
	if (publicAuthority !== undefined) authorities.add(normalizeDashboardAuthority(publicAuthority))
	return authorities
}

export function dashboardRequestAuthorityIsAccepted(request: Request, authorities: ReadonlySet<string>) {
	const authority = request.headers.get('host')
	if (authority === null) return false
	try {
		return authorities.has(normalizeDashboardAuthority(authority))
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

export function dashboardRequestIsSameOrigin(request: Request, authorities: ReadonlySet<string>) {
	const requestAuthority = request.headers.get('host')
	const origin = request.headers.get('origin')
	if (requestAuthority === null || origin === null) return false
	const originMatch = /^(?:http|https):\/\/(.+)$/.exec(origin)
	if (originMatch === null) return false
	try {
		const normalizedRequestAuthority = normalizeDashboardAuthority(requestAuthority)
		const originAuthority = originMatch[1]
		return authorities.has(normalizedRequestAuthority) && originAuthority !== undefined && normalizeDashboardAuthority(originAuthority) === normalizedRequestAuthority
	} catch (error) {
		if (error instanceof Error) return false
		throw error
	}
}

export function dashboardRequestIsAuthenticated(request: Request, password: string | undefined) {
	if (password === undefined) return true
	const authorization = request.headers.get('authorization')
	if (authorization === null) return false
	const expected = `Basic ${Buffer.from(`operator:${password}`, 'utf8').toString('base64')}`
	const actualBytes = Buffer.from(authorization, 'utf8')
	const expectedBytes = Buffer.from(expected, 'utf8')
	return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export function dashboardAuthenticationChallenge() {
	return { 'www-authenticate': 'Basic realm="Zoltar bot", charset="UTF-8"' }
}

export async function boundedDashboardJson(request: Request) {
	if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('Content-Type must be application/json')
	const declaredLength = request.headers.get('content-length')
	if (declaredLength !== null && Number(declaredLength) > MAXIMUM_DASHBOARD_JSON_BYTES) throw new Error('JSON request body exceeds 1 MiB')
	if (request.body === null) throw new Error('JSON request body is required')
	const reader = request.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		for (;;) {
			const chunk = await reader.read()
			if (chunk.done) break
			length += chunk.value.byteLength
			if (length > MAXIMUM_DASHBOARD_JSON_BYTES) throw new Error('JSON request body exceeds 1 MiB')
			chunks.push(chunk.value)
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined)
		throw error
	}
	const body = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		body.set(chunk, offset)
		offset += chunk.byteLength
	}
	return JSON.parse(new TextDecoder().decode(body)) as unknown
}
