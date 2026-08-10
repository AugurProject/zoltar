import { expect, test } from 'bun:test'
import { LiveBus } from '../src/live.ts'

const decoder = new TextDecoder()
const streamFrom = (bus: LiveBus, lastEventId?: number): ReadableStream<Uint8Array> => {
	const stream = bus.stream(lastEventId)
	if (stream === undefined) throw new Error('Expected live stream capacity')
	return stream
}

test('replays durable events after the browser Last-Event-ID and closes cleanly', async () => {
	const events = [
		{ id: 1, event: 'block', payload: { blockNumber: '1' } },
		{ id: 2, event: 'reorg', payload: { depth: '1' } },
	]
	const bus = new LiveBus({
		latestEventId: async () => 2,
		eventsAfter: async (id) => events.filter((event) => event.id > id),
	})
	const reader = streamFrom(bus, 1).getReader()
	expect(decoder.decode((await reader.read()).value)).toBe('retry: 5000\n: connected\n\n')
	await bus.poll()
	const replay = decoder.decode((await reader.read()).value)
	expect(replay).toContain('id: 2\nevent: reorg')
	expect(replay).toContain('"depth":"1"')

	bus.heartbeat()
	expect(decoder.decode((await reader.read()).value)).toBe(': heartbeat\n\n')
	await bus.close()
	expect(await reader.read()).toEqual({ done: true, value: undefined })
})

test('new streams start at the latest durable event without replaying history', async () => {
	let requestedAfter: number | undefined
	const bus = new LiveBus({
		latestEventId: async () => 41,
		eventsAfter: async (id) => {
			requestedAfter = id
			return []
		},
	})
	const reader = streamFrom(bus).getReader()
	await reader.read()
	await bus.poll()
	expect(requestedAfter).toBe(41)
	await bus.close()
})

test('does not enqueue or query more events while a client is backpressured', async () => {
	let queries = 0
	const bus = new LiveBus({
		latestEventId: async () => 0,
		eventsAfter: async () => {
			queries++
			return [
				{ id: 1, event: 'block', payload: {} },
				{ id: 2, event: 'block', payload: {} },
			]
		},
	})
	const reader = streamFrom(bus, 0).getReader()
	await reader.read()
	await bus.poll()
	expect(queries).toBe(1)
	await bus.poll()
	await bus.poll()
	expect(queries).toBe(1)
	expect(decoder.decode((await reader.read()).value)).toContain('id: 1')
	await bus.close()
})

test('delivers the current cursor cohort without waiting for a replaying client', async () => {
	const requested: number[] = []
	const bus = new LiveBus({
		latestEventId: async () => 1_000,
		eventsAfter: async (id) => {
			requested.push(id)
			return [{ id: id + 1, event: 'block', payload: { cursor: id } }]
		},
	})
	const stale = streamFrom(bus, 0).getReader()
	const current = streamFrom(bus, 1_000).getReader()
	await Promise.all([stale.read(), current.read()])
	await bus.poll()
	expect(requested).toContain(0)
	expect(requested).toContain(1_000)
	expect(decoder.decode((await current.read()).value)).toContain('id: 1001')
	await bus.close()
})

test('bounds stream admission and releases capacity when a reader disconnects', async () => {
	const bus = new LiveBus({ latestEventId: async () => 0, eventsAfter: async () => [] }, 1)
	const first = streamFrom(bus, 0)
	expect(bus.stream(0)).toBeUndefined()
	await first.cancel()
	const replacement = streamFrom(bus, 0)
	await replacement.cancel()
	await bus.close()
})

test('coalesces cursor initialization for concurrent new streams', async () => {
	let latestQueries = 0
	let resolveLatest: ((cursor: number) => void) | undefined
	const latest = new Promise<number>((resolve) => {
		resolveLatest = resolve
	})
	const bus = new LiveBus({
		latestEventId: async () => {
			latestQueries++
			return await latest
		},
		eventsAfter: async () => [],
	})
	const first = streamFrom(bus).getReader()
	const second = streamFrom(bus).getReader()
	expect(latestQueries).toBe(1)
	resolveLatest?.(8)
	await Promise.all([first.read(), second.read()])
	expect(latestQueries).toBe(1)
	await bus.close()
})
