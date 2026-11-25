import { describe, expect, jest, test } from 'bun:test'
import { requestJson, requestWithTimeout, singleFlight, waitForProfileReconnect } from '../src/dashboard/polling.ts'

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

// Fake time is scoped to these tests; the real HTTP body smoke above still covers native scheduling.
describe('controlled dashboard deadlines', () => {
	test.each([999, 1000, 1001])('bounds and aborts a late response at %i ms', async elapsed => {
		jest.useFakeTimers()
		try {
			let release: (value: string) => void = () => {
				throw new Error('Request not started')
			}
			let signal: AbortSignal | undefined
			let outcome = 'pending'
			const request = requestWithTimeout(currentSignal => {
				signal = currentSignal
				return new Promise<string>(resolve => {
					release = resolve
				})
			}, 1000).then(
				value => {
					outcome = value
				},
				() => {
					outcome = 'timeout'
				},
			)
			jest.advanceTimersByTime(elapsed)
			await Promise.resolve()
			await Promise.resolve()
			expect(signal?.aborted).toBe(elapsed >= 1000)
			if (elapsed < 1000) expect(outcome).toBe('pending')
			release('success')
			await request
			expect(outcome).toBe(elapsed < 1000 ? 'success' : 'timeout')
			expect(jest.getTimerCount()).toBe(0)
		} finally {
			jest.useRealTimers()
		}
	})

	test.each(['reconnected', 'abandoned'] as const)('stops reconnect checks after %s, including a held response', async result => {
		jest.useFakeTimers()
		try {
			let release: (value: typeof result) => void = () => {
				throw new Error('Check not started')
			}
			let checks = 0
			let timedOut = false
			const reconnect = waitForProfileReconnect(
				() => {
					checks++
					return new Promise<typeof result>(resolve => {
						release = resolve
					})
				},
				() => {
					timedOut = true
				},
			)
			jest.advanceTimersByTime(499)
			await Promise.resolve()
			expect(checks).toBe(0)
			jest.advanceTimersByTime(1)
			await Promise.resolve()
			expect(checks).toBe(1)
			jest.advanceTimersByTime(20000)
			await Promise.resolve()
			expect(checks).toBe(1)
			release(result)
			await reconnect
			jest.advanceTimersByTime(20000)
			expect(checks).toBe(1)
			expect(timedOut).toBe(false)
			expect(jest.getTimerCount()).toBe(0)
		} finally {
			jest.useRealTimers()
		}
	})

	test('times out only after the last reconnect check completes', async () => {
		jest.useFakeTimers()
		try {
			let checks = 0
			let timedOut = false
			const reconnect = waitForProfileReconnect(
				async () => {
					checks++
					return 'waiting'
				},
				() => {
					timedOut = true
				},
				2,
			)
			jest.advanceTimersByTime(500)
			await Promise.resolve()
			await Promise.resolve()
			expect(checks).toBe(1)
			jest.advanceTimersByTime(499)
			await Promise.resolve()
			expect(timedOut).toBe(false)
			jest.advanceTimersByTime(1)
			await reconnect
			expect(checks).toBe(2)
			expect(timedOut).toBe(true)
			expect(jest.getTimerCount()).toBe(0)
		} finally {
			jest.useRealTimers()
		}
	})
})
