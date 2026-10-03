import { describe, expect, test } from 'bun:test'
import { requestJson, requestWithTimeout, singleFlight } from '../src/dashboard/polling.ts'

describe('dashboard polling', () => {
	test('serializes overlapping dashboard refreshes and preserves one trailing request', async () => {
		let calls = 0
		let release: (() => void) | undefined
		const refresh = singleFlight(async () => {
			calls++
			if (calls === 1) {
				await new Promise<void>(resolve => {
					release = resolve
				})
			}
		})
		const first = refresh()
		const second = refresh()
		expect(calls).toBe(1)
		release?.()
		await Promise.all([first, second])
		expect(calls).toBe(2)
	})

	test('aborts and rejects a state request that never resolves', async () => {
		let aborted = false
		const request = requestWithTimeout(
			signal =>
				new Promise<never>(() => {
					signal.addEventListener('abort', () => {
						aborted = true
					})
				}),
			10,
		)

		await expect(request).rejects.toThrow('timed out')
		expect(aborted).toBe(true)
	})

	test('uses a surface-specific timeout message for bounded configuration reads', async () => {
		await expect(requestWithTimeout(() => new Promise<never>(() => {}), 10, 'Configuration request timed out.')).rejects.toThrow('Configuration request timed out.')
	})

	test('bounds the response body as well as the response headers', async () => {
		const stalled = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => new Response(new ReadableStream({ start: controller => controller.enqueue(new TextEncoder().encode('{"partial":')) }), { headers: { 'content-type': 'application/json' } }),
		})
		try {
			await expect(requestJson(`http://127.0.0.1:${stalled.port}/api/state`, 50, undefined, 'State body timed out')).rejects.toThrow('State body timed out')
		} finally {
			await stalled.stop(true)
		}
	})

	test('returns the decoded body with its response so callers can map rejected requests', async () => {
		const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json({ error: 'No' }, { status: 409 }) })
		try {
			const { response, value } = await requestJson(`http://127.0.0.1:${server.port}/api/state`, 1_000)
			expect(response.status).toBe(409)
			expect(value).toEqual({ error: 'No' })
		} finally {
			await server.stop(true)
		}
	})
})
