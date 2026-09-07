import { expect, spyOn, test } from 'bun:test'
import { requestWithTimeout, fetchJson, responseError } from '../../src/dashboard/requests.ts'
import { dashboardHeaders, dashboardJson, closingDashboardJson } from '../../src/dashboard/responses.ts'
import { blockAgeLabel } from '../../src/dashboard/block-age.ts'
import { marketPresentation } from '../../src/dashboard/market-presentation.ts'

test('deadline aborts an unresponsive request and preserves the selected error', async () => {
	let signal: AbortSignal | undefined
	await expect(
		requestWithTimeout(
			value => {
				signal = value
				return new Promise(() => undefined)
			},
			5,
			'Read expired',
		),
	).rejects.toThrow('Read expired')
	expect(signal?.aborted).toBe(true)
})

test('deadline cleans up after success, asynchronous rejection and synchronous throw', async () => {
	const signals: AbortSignal[] = []
	expect(
		await requestWithTimeout(async signal => {
			signals.push(signal)
			return 17
		}, 5),
	).toBe(17)
	const problem = new Error('offline')
	await expect(
		requestWithTimeout(async signal => {
			signals.push(signal)
			throw problem
		}, 5),
	).rejects.toBe(problem)
	await expect(
		requestWithTimeout(signal => {
			signals.push(signal)
			throw problem
		}, 5),
	).rejects.toBe(problem)
	await Bun.sleep(15)
	expect(signals.map(signal => signal.aborted)).toEqual([false, false, false])
})

test('JSON transport preserves HTTP errors for application-specific classification and rejects malformed bodies', async () => {
	const server = Bun.serve({ port: 0, fetch: request => (new URL(request.url).pathname === '/malformed' ? new Response('{') : Response.json({ error: 'Conflict', code: 'configuration_revision_conflict' }, { status: 409 })) })
	try {
		const result = await fetchJson(`${server.url}conflict`)
		expect(result.response.status).toBe(409)
		expect(result.value).toEqual({ error: 'Conflict', code: 'configuration_revision_conflict' })
		expect(responseError(result.value)).toBe('Conflict')
		expect(responseError({ error: 42 })).toBeUndefined()
		await expect(fetchJson(`${server.url}malformed`)).rejects.toBeInstanceOf(SyntaxError)
	} finally {
		server.stop(true)
	}
})

test('JSON responses retain status, all default headers, and explicit connection close', async () => {
	const response = dashboardJson({ error: 'Unavailable' }, 503)
	expect(response.status).toBe(503)
	expect(await response.json()).toEqual({ error: 'Unavailable' })
	expect(Object.fromEntries(response.headers)).toEqual({
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
		'content-type': 'application/json; charset=utf-8',
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	})
	expect(closingDashboardJson({ ok: true }).headers.get('connection')).toBe('close')
	expect(dashboardHeaders('text/css')['content-type']).toBe('text/css')
})

test('block ages validate timestamps and leave duration precision to the consumer', () => {
	const seconds = (value: number) => `${value}s`
	expect(blockAgeLabel('100', seconds, 165000)).toBe('seen 65s ago')
	expect(blockAgeLabel('100', seconds, 98000)).toBe('2s ahead of local clock')
	for (const value of [undefined, '01', '-1', '1.2', '9007199254740991']) expect(blockAgeLabel(value, seconds, 0)).toBe('timestamp unavailable')
})

test('market presentation keeps exact prices, depth, independent source counts and unreliable reasons', () => {
	expect(marketPresentation(undefined, undefined)).toEqual({ dexPrice: '—', guardedPrice: '—', dexBidDepth: '—', dexAskDepth: '—', status: 'No market sources configured', price: '—', bidDepth: '—', askDepth: '—', sourceCount: '0 CEX' })
	const market = { reliable: false, reasons: ['stale', 'thin'], priceRepPerEth: '1.000000000000000001', bidDepthEth: '2', askDepthEth: '3', observations: [{}, {}] }
	expect(marketPresentation(market, undefined)).toMatchObject({ price: '1.000000000000000001', status: 'stale · thin', bidDepth: '2 ETH', askDepth: '3 ETH', sourceCount: '2 CEX' })
	const dex = { reliable: true, priceRepPerEth: '4', bidDepthEth: '5', askDepthEth: '6', sourceCount: 3 }
	const consensus = { reliable: true, reasons: [], priceRepPerEth: '7', cex: { ...dex, sourceCount: 1 }, dex }
	expect(marketPresentation(undefined, consensus)).toMatchObject({ status: 'Reliable DEX consensus', sourceCount: '1 CEX · 3 DEX', guardedPrice: '7', dexPrice: '4', dexBidDepth: '5 ETH', dexAskDepth: '6 ETH' })
	expect(marketPresentation(market, consensus).status).toBe('Reliable independent CEX + DEX consensus')
	expect(marketPresentation(market, { ...consensus, reliable: false, reasons: ['divergent'], dex: { ...dex, reliable: false } })).toMatchObject({ status: 'divergent', guardedPrice: '—', dexPrice: '—' })
})

test('transport-only deadlines permit slow JSON bodies while operation deadlines reject them', async () => {
	const fetchMock = spyOn(globalThis, 'fetch')
	let observed: AbortSignal | null | undefined
	let body: ReadableStreamDefaultController<Uint8Array> | undefined
	async function fakeFetch(_input: RequestInfo | URL, init?: RequestInit) {
		observed = init?.signal
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					body = controller
				},
			}),
		)
	}
	fakeFetch.preconnect = () => undefined
	fetchMock.mockImplementation(fakeFetch)
	try {
		const read = fetchJson('/slow-body', undefined, 5)
		await Bun.sleep(15)
		expect(observed?.aborted).toBe(false)
		if (body === undefined) throw new Error('Missing response stream')
		body.enqueue(new TextEncoder().encode('{"ok":true}'))
		body.close()
		body = undefined
		expect((await read).value).toEqual({ ok: true })
		await expect(requestWithTimeout(signal => fetchJson('/slow-body', { signal }), 5, 'Body expired')).rejects.toThrow('Body expired')
		expect(observed?.aborted).toBe(true)
	} finally {
		body?.close()
		fetchMock.mockRestore()
	}
})
