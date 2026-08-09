import { expect, test } from 'bun:test'
import { LiveBus } from '../src/live.ts'

test('closes active event streams during shutdown', async () => {
	const bus = new LiveBus()
	const reader = bus.stream().getReader()
	const connected = await reader.read()
	expect(new TextDecoder().decode(connected.value)).toBe(': connected\n\n')

	bus.close()

	expect(await reader.read()).toEqual({ done: true, value: undefined })
	bus.publish('block', { number: 1 })
})
