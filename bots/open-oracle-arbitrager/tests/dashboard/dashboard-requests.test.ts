import { afterEach, expect, test } from 'bun:test'
import { api } from '#dashboard/dashboard-requests'

const nativeFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = nativeFetch
})

function respondWith(response: Response) {
	globalThis.fetch = Object.assign(async () => response, { preconnect: nativeFetch.preconnect })
}

test('reports the status of a failed request whose body is not JSON instead of a parser error', async () => {
	respondWith(new Response('<html>Bad gateway</html>', { status: 502 }))
	expect(api('/api/settings')).rejects.toThrow('Request failed with status 502')
})

test('forwards the bot error of a failed JSON response and keeps an unreadable successful response a parser error', async () => {
	respondWith(Response.json({ error: 'Minimum profit must not exceed 1000 WETH' }, { status: 400 }))
	expect(api('/api/settings')).rejects.toThrow('Minimum profit must not exceed 1000 WETH')
	respondWith(new Response('not json', { status: 200 }))
	expect(api('/api/state')).rejects.toBeInstanceOf(SyntaxError)
})
