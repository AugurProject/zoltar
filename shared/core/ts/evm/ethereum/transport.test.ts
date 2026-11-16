import { expect, test } from 'bun:test'
import { http, requestRpc } from './transport.js'

for (const status of [429, 500]) {
	for (const cleanup of ['resolve', 'reject', 'pending']) {
		test(`cancels HTTP ${status} bodies and preserves the RPC error when cleanup is ${cleanup}`, async () => {
			let cancelled = false
			const body = new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true
					if (cleanup === 'reject') return Promise.reject(new Error('cleanup failed'))
					if (cleanup === 'pending') return new Promise<void>(() => undefined)
					return undefined
				},
			})
			const transport = http('https://rpc.example.test', {
				fetchFn: async () => new Response(body, { status }),
			})
			await expect(requestRpc(transport, { method: 'eth_blockNumber' })).rejects.toMatchObject({ code: status, message: `HTTP ${status} while calling eth_blockNumber` })
			expect(cancelled).toBe(true)
		})
	}
}
