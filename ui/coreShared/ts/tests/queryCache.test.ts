/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createQueryCache } from '../lib/queryCache.js'

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (error: unknown) => void = () => undefined
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, reject, resolve }
}

async function flush() {
	for (let index = 0; index < 5; index++) await Promise.resolve()
}

describe('query cache', () => {
	test('keeps the last data visible while a refetch is in flight and records when it was read', async () => {
		let now = 1_000
		const cache = createQueryCache({ now: () => now })
		const store = cache.createStore<string>()
		await store.fetch('pools', async () => 'first')
		expect(store.get('pools')).toEqual({ data: 'first', error: undefined, updatedAt: 1_000, fetching: false, stale: false })

		now = 5_000
		const next = deferred<string>()
		void store.fetch('pools', async () => await next.promise)
		expect(store.get('pools')).toMatchObject({ data: 'first', fetching: true, updatedAt: 1_000 })
		next.resolve('second')
		await flush()
		expect(store.get('pools')).toMatchObject({ data: 'second', fetching: false, updatedAt: 5_000 })
	})

	test('shares one in-flight read between concurrent requests for a key', async () => {
		const store = createQueryCache().createStore<number>()
		const read = deferred<number>()
		let loads = 0
		const loader = async () => {
			loads += 1
			return await read.promise
		}
		const first = store.fetch('count', loader)
		const second = store.fetch('count', loader)
		expect(loads).toBe(1)
		expect(second).toBe(first)
		read.resolve(3)
		expect(await second).toBe(3)
		void store.fetch('count', loader)
		expect(loads).toBe(2)
	})

	test('keeps the last data and records the error when a refetch fails', async () => {
		const store = createQueryCache({ now: () => 10 }).createStore<string>()
		await store.fetch('summary', async () => 'loaded')
		const failure = new Error('RPC unavailable')
		await expect(store.fetch('summary', async () => await Promise.reject(failure))).rejects.toBe(failure)
		expect(store.get('summary')).toMatchObject({ data: 'loaded', error: failure, fetching: false, updatedAt: 10 })
	})

	test('invalidation marks entries stale and notifies their subscribers, including across stores', async () => {
		const cache = createQueryCache()
		const pools = cache.createStore<string>()
		const questions = cache.createStore<string>()
		await pools.fetch('a', async () => 'pool')
		await questions.fetch('b', async () => 'question')
		const notifications: string[] = []
		const unsubscribe = pools.subscribe('a', () => notifications.push('a'))
		questions.subscribe('b', () => notifications.push('b'))
		cache.invalidateAll()
		expect(pools.get('a').stale).toBe(true)
		expect(questions.get('b').stale).toBe(true)
		expect(notifications).toEqual(['a', 'b'])
		unsubscribe()
		pools.invalidate('a')
		expect(notifications).toEqual(['a', 'b'])
	})

	test('a read requested after an invalidation starts again instead of sharing the older in-flight read', async () => {
		const store = createQueryCache().createStore<string>()
		const before = deferred<string>()
		const after = deferred<string>()
		let loads = 0
		const loader = async () => (++loads === 1 ? await before.promise : await after.promise)
		void store.fetch('page', loader)
		store.invalidate('page')
		expect(store.get('page').stale).toBe(true)
		const second = store.fetch('page', loader)
		expect(loads).toBe(2)
		after.resolve('after the new block')
		expect(await second).toBe('after the new block')
		before.resolve('before the new block')
		await flush()
		expect(store.get('page')).toMatchObject({ data: 'after the new block', stale: false, fetching: false })
	})

	test('an older in-flight read cannot overwrite a result stored with set', async () => {
		const store = createQueryCache().createStore<string>()
		const older = deferred<string>()
		void store.fetch('summary', async () => await older.promise)
		store.set('summary', 'foreground')
		expect(store.get('summary').fetching).toBe(false)
		older.resolve('stale background')
		await flush()
		expect(store.get('summary').data).toBe('foreground')
	})

	test('clear retires in-flight reads so an answer from a replaced environment is dropped', async () => {
		const cache = createQueryCache()
		const store = cache.createStore<string>()
		const read = deferred<string>()
		void store.fetch('universe', async () => await read.promise)
		cache.clear()
		read.resolve('old environment')
		await flush()
		expect(store.get('universe')).toEqual({ data: undefined, error: undefined, updatedAt: undefined, fetching: false, stale: false })
		let loads = 0
		await store.fetch('universe', async () => {
			loads += 1
			return 'new environment'
		})
		expect(loads).toBe(1)
		expect(store.get('universe').data).toBe('new environment')
	})

	test('set stores a result read elsewhere', () => {
		const store = createQueryCache({ now: () => 42 }).createStore<number>()
		store.set('balance', 7)
		expect(store.get('balance')).toEqual({ data: 7, error: undefined, updatedAt: 42, fetching: false, stale: false })
	})
})
