import { expect, test } from 'bun:test'
import type { LiveEvent } from '../src/database.ts'
import { liveStreamResponse } from '../src/http.ts'
import { LiveBus } from '../src/live.ts'

const decoder = new TextDecoder()
const streamFrom = (bus: LiveBus, lastEventId?: number): ReadableStream<Uint8Array> => {
	const stream = bus.stream(lastEventId)
	if (stream === undefined) throw new Error('Expected live stream capacity')
	return stream
}

test('keeps a quiet SSE response open beyond Bun server idle timeout', async () => {
	const encoder = new TextEncoder()
	const server = Bun.serve({
		port: 0,
		idleTimeout: 1,
		fetch(request, activeServer) {
			return liveStreamResponse(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(': connected\n\n'))
						setTimeout(() => {
							controller.enqueue(encoder.encode(': heartbeat\n\n'))
							controller.close()
						}, 1_250)
					},
				}),
				request,
				activeServer,
			)
		},
	})
	try {
		const response = await fetch(`http://127.0.0.1:${server.port}`)
		expect(response.status).toBe(200)
		expect(await response.text()).toBe(': connected\n\n: heartbeat\n\n')
	} finally {
		await server.stop(true)
	}
})

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

test('new streams refresh the durable cursor after an idle period', async () => {
	let latest = 1
	const requestedAfter: number[] = []
	const bus = new LiveBus({
		latestEventId: async () => latest,
		eventsAfter: async (id) => {
			requestedAfter.push(id)
			return []
		},
	})
	const first = streamFrom(bus).getReader()
	await first.read()
	await first.cancel()

	latest = 41
	const second = streamFrom(bus).getReader()
	await second.read()
	await bus.poll()

	expect(requestedAfter.at(-1)).toBe(41)
	await second.cancel()
	await bus.close()
})

test('delivers a reset when a reconnect cursor is ahead of the durable event head', async () => {
	let events: LiveEvent[] = [{ id: 50, event: 'reset', payload: { reason: 'cursor-ahead-of-head', refreshRequired: true } }]
	const bus = new LiveBus({
		latestEventId: async () => 50,
		eventsAfter: async (id) => events.filter((event) => event.event === 'reset' ? id > event.id : event.id > id),
	})
	const reader = streamFrom(bus, 1_000).getReader()
	expect(decoder.decode((await reader.read()).value)).toContain('connected')
	await bus.poll()
	bus.heartbeat()
	expect(decoder.decode((await reader.read()).value)).toContain('id: 50\nevent: reset')

	events = [{ id: 51, event: 'block', payload: { blockNumber: '51' } }]
	await bus.poll()
	expect(decoder.decode((await reader.read()).value)).toContain('id: 51\nevent: block')
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
