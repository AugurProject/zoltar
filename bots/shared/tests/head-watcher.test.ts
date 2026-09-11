import { expect, test } from 'bun:test'
import { createHeadWatcher, type ObservedHead } from '../src/monitoring/head-watcher.ts'

function head(number: bigint, suffix = 'aa'): ObservedHead {
	return { hash: `0x${suffix.repeat(32)}`, number, timestamp: number * 12n }
}

function watcherHarness(initialBlockNumber: bigint | undefined) {
	let blockNumber = initialBlockNumber
	let blockReads = 0
	let numberReads = 0
	const heads: { head: ObservedHead; previous: ObservedHead | undefined }[] = []
	const errors: unknown[] = []
	const watcher = createHeadWatcher({
		intervalMilliseconds: 5,
		onError: error => errors.push(error),
		onHead: (observed, previous) => heads.push({ head: observed, previous }),
		readBlock: async number => {
			blockReads += 1
			return head(number)
		},
		readBlockNumber: async () => {
			numberReads += 1
			return blockNumber
		},
	})
	return {
		advance: (next: bigint) => {
			blockNumber = next
		},
		blockReads: () => blockReads,
		errors,
		heads,
		numberReads: () => numberReads,
		watcher,
	}
}

test('reports every new head once and wakes a waiter immediately', async () => {
	const harness = watcherHarness(10n)
	harness.watcher.start()
	expect(await harness.watcher.waitForNewHead(undefined, 1_000)).toBe('head')
	expect(harness.heads.map(entry => entry.head.number)).toEqual([10n])
	const waiting = harness.watcher.waitForNewHead(head(10n), 1_000)
	harness.advance(11n)
	expect(await waiting).toBe('head')
	expect(harness.heads.map(entry => [entry.head.number, entry.previous?.number])).toEqual([
		[10n, undefined],
		[11n, 10n],
	])
	// A waiter that already scanned the latest head keeps waiting until the timeout.
	expect(await harness.watcher.waitForNewHead(head(11n), 20)).toBe('timeout')
	// Unchanged heights cost one block-number read per tick and no block reads.
	expect(harness.blockReads()).toBe(2)
	expect(harness.numberReads()).toBeGreaterThan(2)
	await harness.watcher.stop()
})

test('stop releases waiters and ends the polling loop', async () => {
	const harness = watcherHarness(undefined)
	harness.watcher.start()
	const waiting = harness.watcher.waitForNewHead(undefined, 60_000)
	await harness.watcher.stop()
	expect(await waiting).toBe('stopped')
	expect(await harness.watcher.waitForNewHead(undefined, 60_000)).toBe('stopped')
	const readsAfterStop = harness.numberReads()
	await Bun.sleep(20)
	expect(harness.numberReads()).toBe(readsAfterStop)
	expect(harness.heads).toEqual([])
})

test('surfaces read failures without stopping and resumes on recovery', async () => {
	let fail = true
	const heads: bigint[] = []
	const errors: string[] = []
	const watcher = createHeadWatcher({
		intervalMilliseconds: 5,
		onError: error => errors.push(error instanceof Error ? error.message : String(error)),
		onHead: observed => heads.push(observed.number),
		readBlock: async number => head(number),
		readBlockNumber: async () => {
			if (fail) throw new Error('RPC unavailable')
			return 7n
		},
	})
	watcher.start()
	await Bun.sleep(15)
	expect(errors.length).toBeGreaterThan(0)
	fail = false
	expect(await watcher.waitForNewHead(undefined, 1_000)).toBe('head')
	expect(heads).toEqual([7n])
	await watcher.stop()
})

test('ignores a lower height after failover so observed heads stay monotonic', async () => {
	const harness = watcherHarness(11n)
	harness.watcher.start()
	expect(await harness.watcher.waitForNewHead(undefined, 1_000)).toBe('head')
	harness.advance(10n)
	expect(await harness.watcher.waitForNewHead(head(11n), 20)).toBe('timeout')
	expect(harness.heads.map(entry => entry.head.number)).toEqual([11n])
	expect(harness.blockReads()).toBe(1)
	harness.advance(12n)
	expect(await harness.watcher.waitForNewHead(head(11n), 1_000)).toBe('head')
	await harness.watcher.stop()
})

test('does not wake a scan whose head is already ahead of the watcher', async () => {
	const harness = watcherHarness(9n)
	harness.watcher.start()
	expect(await harness.watcher.waitForNewHead(undefined, 1_000)).toBe('head')
	// The scan read block 10 directly while the watcher still reports 9: no wake until the watcher passes 10.
	expect(await harness.watcher.waitForNewHead(head(10n), 20)).toBe('timeout')
	const waiting = harness.watcher.waitForNewHead(head(10n), 1_000)
	harness.advance(10n)
	expect(await harness.watcher.waitForNewHead(head(9n), 1_000)).toBe('head')
	harness.advance(11n)
	expect(await waiting).toBe('head')
	expect(harness.heads.map(entry => entry.head.number)).toEqual([9n, 10n, 11n])
	// A replaced block at the scanned height still counts as new.
	expect(await harness.watcher.waitForNewHead(head(11n, 'bb'), 20)).toBe('head')
	await harness.watcher.stop()
})

test('rejects an invalid interval', () => {
	expect(() => createHeadWatcher({ intervalMilliseconds: 0, onError: () => undefined, onHead: () => undefined, readBlock: () => Promise.resolve(head(1n)), readBlockNumber: () => Promise.resolve(1n) })).toThrow('positive integer')
})
