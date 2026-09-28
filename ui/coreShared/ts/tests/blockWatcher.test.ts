/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createBlockWatcher, type BlockWatcherEnvironment, type BlockWatcherEvent } from '../lib/blockWatcher.js'

function createFakeEnvironment() {
	const timers = new Map<number, { callback: () => void; milliseconds: number }>()
	const visibilityListeners = new Set<() => void>()
	let nextTimer = 0
	let hidden = false
	const environment: BlockWatcherEnvironment = {
		isHidden: () => hidden,
		schedule: (callback, milliseconds) => {
			const id = nextTimer++
			timers.set(id, { callback, milliseconds })
			return () => timers.delete(id)
		},
		subscribeVisibility: listener => {
			visibilityListeners.add(listener)
			return () => visibilityListeners.delete(listener)
		},
	}
	return {
		environment,
		pendingTimers: () => [...timers.values()].map(timer => timer.milliseconds),
		fireTimers: () => {
			const due = [...timers.entries()]
			for (const [id, timer] of due) {
				timers.delete(id)
				timer.callback()
			}
		},
		setHidden: (value: boolean) => {
			hidden = value
			for (const listener of visibilityListeners) listener()
		},
		visibilityListenerCount: () => visibilityListeners.size,
	}
}

async function flush() {
	for (let index = 0; index < 5; index++) await Promise.resolve()
}

describe('block watcher', () => {
	test('polls immediately, schedules the next poll, and notifies only when the block advances', async () => {
		const fake = createFakeEnvironment()
		const watcher = createBlockWatcher(fake.environment)
		const events: BlockWatcherEvent[] = []
		watcher.subscribe(event => events.push(event))
		let block = 10n
		let polls = 0
		watcher.start(async () => {
			polls += 1
			return block
		}, 12_000)
		await flush()
		expect(polls).toBe(1)
		// The first block establishes the baseline for data that was loaded on mount.
		expect(events).toEqual([])
		expect(fake.pendingTimers()).toEqual([12_000])

		fake.fireTimers()
		await flush()
		expect(polls).toBe(2)
		expect(events).toEqual([])

		block = 11n
		fake.fireTimers()
		await flush()
		expect(events).toEqual([{ blockNumber: 11n, reason: 'block' }])
		expect(watcher.getLatestBlockNumber()).toBe(11n)
		expect(fake.pendingTimers()).toEqual([12_000])
	})

	test('pauses while the page is hidden and polls immediately when it becomes visible', async () => {
		const fake = createFakeEnvironment()
		const watcher = createBlockWatcher(fake.environment)
		const events: BlockWatcherEvent[] = []
		watcher.subscribe(event => events.push(event))
		let block = 1n
		let polls = 0
		watcher.start(async () => {
			polls += 1
			return block
		}, 12_000)
		await flush()
		fake.setHidden(true)
		expect(fake.pendingTimers()).toEqual([])

		block = 5n
		fake.setHidden(false)
		await flush()
		expect(polls).toBe(2)
		expect(events).toEqual([{ blockNumber: 5n, reason: 'block' }])
		expect(fake.pendingTimers()).toEqual([12_000])
	})

	test('does not poll while starting in a hidden page', async () => {
		const fake = createFakeEnvironment()
		fake.setHidden(true)
		const watcher = createBlockWatcher(fake.environment)
		let polls = 0
		watcher.start(async () => {
			polls += 1
			return 1n
		}, 12_000)
		await flush()
		expect(polls).toBe(0)
		expect(fake.pendingTimers()).toEqual([])
	})

	test('shares one in-flight poll between concurrent refreshes and keeps the last block after a failed read', async () => {
		const fake = createFakeEnvironment()
		const watcher = createBlockWatcher(fake.environment)
		let resolvePoll: (block: bigint) => void = () => undefined
		let polls = 0
		let fail = false
		watcher.start(async () => {
			polls += 1
			if (fail) throw new Error('RPC unavailable')
			return await new Promise<bigint>(resolve => {
				resolvePoll = resolve
			})
		}, 12_000)
		void watcher.refresh()
		void watcher.refresh()
		expect(polls).toBe(1)
		resolvePoll(7n)
		await flush()
		expect(watcher.getLatestBlockNumber()).toBe(7n)

		fail = true
		await watcher.refresh()
		expect(watcher.getLatestBlockNumber()).toBe(7n)
	})

	test('announces explicit invalidations and blocks reported by other readers', async () => {
		const fake = createFakeEnvironment()
		const watcher = createBlockWatcher(fake.environment)
		const events: BlockWatcherEvent[] = []
		const unsubscribe = watcher.subscribe(event => events.push(event))
		watcher.reportBlock(3n)
		watcher.reportBlock(3n)
		watcher.reportBlock(4n)
		watcher.invalidate()
		expect(events).toEqual([
			{ blockNumber: 4n, reason: 'block' },
			{ blockNumber: 4n, reason: 'invalidate' },
		])
		unsubscribe()
		watcher.invalidate()
		expect(events).toHaveLength(2)
	})

	test('stopping ignores the in-flight answer and releases the timer and visibility listener', async () => {
		const fake = createFakeEnvironment()
		const watcher = createBlockWatcher(fake.environment)
		const events: BlockWatcherEvent[] = []
		watcher.subscribe(event => events.push(event))
		watcher.reportBlock(1n)
		let resolvePoll: (block: bigint) => void = () => undefined
		const stop = watcher.start(
			async () =>
				await new Promise<bigint>(resolve => {
					resolvePoll = resolve
				}),
			12_000,
		)
		expect(watcher.isRunning()).toBe(true)
		stop()
		resolvePoll(9n)
		await flush()
		expect(events).toEqual([])
		expect(watcher.isRunning()).toBe(false)
		expect(fake.pendingTimers()).toEqual([])
		expect(fake.visibilityListenerCount()).toBe(0)
	})

	test('a replaced poller cannot be stopped by its stale stop function', async () => {
		const fake = createFakeEnvironment()
		const watcher = createBlockWatcher(fake.environment)
		const stopFirst = watcher.start(async () => 1n, 12_000)
		watcher.start(async () => 2n, 30_000)
		stopFirst()
		await flush()
		expect(watcher.isRunning()).toBe(true)
		expect(fake.pendingTimers()).toEqual([30_000])
	})
})
