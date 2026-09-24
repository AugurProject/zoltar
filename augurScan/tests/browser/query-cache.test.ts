import { expect, test } from 'bun:test'
import { createQueryCache } from '../../browser/query-cache.ts'

test('deduplicates concurrent reads and clears cached results', async () => {
	let calls = 0
	const cache = createQueryCache(async () => ++calls, 5_000)
	const [first, second] = await Promise.all([cache.get('/one'), cache.get('/one')])
	expect([first, second, calls]).toEqual([1, 1, 1])
	cache.clear()
	expect(await cache.get('/one')).toBe(2)
})

test('an old rejection does not evict a newer request for the same path', async () => {
	let calls = 0
	let rejectOld: ((reason?: unknown) => void) | undefined
	let resolveNew: ((value: unknown) => void) | undefined
	const cache = createQueryCache(
		() =>
			new Promise<unknown>((resolve, reject) => {
				if (calls++ === 0) rejectOld = reject
				else resolveNew = resolve
			}),
		5_000,
	)
	const oldRequest = cache.get('/evidence')
	cache.clear()
	const newRequest = cache.get('/evidence')
	rejectOld?.(new Error('Earlier request failed'))
	await expect(oldRequest).rejects.toThrow('Earlier request failed')
	expect(cache.get('/evidence')).toBe(newRequest)
	expect(calls).toBe(2)
	resolveNew?.('current evidence')
	expect(await newRequest).toBe('current evidence')
})
