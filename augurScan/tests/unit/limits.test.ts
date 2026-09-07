import { expect, test } from 'bun:test'
import { createConcurrencyGate } from '../src/limits.ts'

test('rejects excess concurrent work and recovers capacity after completion', async () => {
	let release: (() => void) | undefined
	const stalled = new Promise<void>((resolve) => {
		release = resolve
	})
	const gate = createConcurrencyGate(2, () => 'busy')
	const first = gate(async () => {
		await stalled
		return 'first'
	})
	const second = gate(async () => {
		await stalled
		return 'second'
	})
	expect(await gate(async () => 'unexpected')).toBe('busy')
	release?.()
	expect(await Promise.all([first, second])).toEqual(['first', 'second'])
	expect(await gate(async () => 'recovered')).toBe('recovered')
})
