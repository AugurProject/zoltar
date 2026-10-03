import { afterEach, expect, test } from 'bun:test'
import { api, INVALID_RESPONSE, REQUEST_REJECTED } from '../../src/dashboard/dashboard-requests.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

function respondWith(response: Pick<Response, 'json' | 'ok' | 'status'>) {
	Reflect.set(globalThis, 'fetch', async () => response)
}

test('bounds reading the response body by the request timeout', async () => {
	// The headers arrive, but the body never finishes: the timeout must still end the request.
	respondWith({ json: () => new Promise<never>(() => undefined), ok: true, status: 200 })
	await expect(api('/api/state', undefined, 20)).rejects.toThrow('Dashboard state request timed out')
})

test('names rejected requests and unreadable bodies differently', async () => {
	respondWith({ json: async () => ({ error: 'Live execution requires an active signer' }), ok: false, status: 400 })
	await expect(api('/api/execution')).rejects.toMatchObject({ message: 'Live execution requires an active signer', name: REQUEST_REJECTED })
	respondWith({
		json: async () => {
			throw new SyntaxError('Unexpected token <')
		},
		ok: false,
		status: 502,
	})
	await expect(api('/api/state', undefined, 1_000)).rejects.toMatchObject({ name: INVALID_RESPONSE })
})
