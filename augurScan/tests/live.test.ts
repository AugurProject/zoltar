import { afterEach, expect, jest, test } from 'bun:test'
import { HEARTBEAT_INTERVAL_MS, LiveBus, startHeartbeat } from '../src/live.ts'

afterEach(() => jest.useRealTimers())

test('closes active event streams during shutdown', async () => {
	const bus = new LiveBus()
	const reader = bus.stream().getReader()
	const connected = await reader.read()
	expect(new TextDecoder().decode(connected.value)).toBe('retry: 5000\n: connected\n\n')
	bus.heartbeat()
	const heartbeat = await reader.read()
	expect(new TextDecoder().decode(heartbeat.value)).toBe(': heartbeat\n\n')

	bus.close()

	expect(await reader.read()).toEqual({ done: true, value: undefined })
	bus.publish('block', { number: 1 })
})

test('schedules heartbeats every 15 seconds and stops cleanly', () => {
	jest.useFakeTimers()
	let heartbeatCount = 0
	const stop = startHeartbeat({
		heartbeat: () => {
			heartbeatCount += 1
		},
	})

	jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1)
	expect(heartbeatCount).toBe(0)
	jest.advanceTimersByTime(1)
	expect(heartbeatCount).toBe(1)
	jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
	expect(heartbeatCount).toBe(3)
	stop()
	jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
	expect(heartbeatCount).toBe(3)
})
