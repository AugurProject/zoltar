import { timingSafeEqual } from 'node:crypto'

const MAXIMUM_DASHBOARD_JSON_BYTES = 1024 * 1024

export function validateDashboardAuthentication(hostname: '0.0.0.0' | '127.0.0.1', password: string | undefined) {
	if (hostname === '0.0.0.0' && (password === undefined || password.length < 16)) {
		throw new Error('ZOLTAR_BOT_DASHBOARD_PASSWORD must contain at least 16 characters when the dashboard binds to 0.0.0.0')
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
