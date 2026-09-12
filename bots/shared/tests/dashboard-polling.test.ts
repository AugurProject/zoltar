import { describe, expect, test } from 'bun:test'
import { requestWithTimeout, singleFlight } from '../src/dashboard/polling.ts'

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
})
