import { expect, test } from 'bun:test'
import { createBlockPrefetch } from '../../src/indexer/block-prefetch.ts'

test('prefetch overlaps reads, stays bounded, and consumes out-of-order responses in order', async () => {
	const started: bigint[] = []
	const complete = new Map<bigint, (value: bigint) => void>()
	const take = createBlockPrefetch(
		10n,
		15n,
		number => {
			started.push(number)
			return new Promise<bigint>(resolve => complete.set(number, resolve))
		},
		new AbortController().signal,
	)
	const first = take(10n)
	await Promise.resolve()
	expect(started).toEqual([10n, 11n, 12n, 13n])
	for (const number of [13n, 12n, 11n, 10n]) complete.get(number)?.(number)
	expect(await first).toBe(10n)
	for (const number of [11n, 12n, 13n, 14n, 15n]) {
		const result = take(number)
		await Promise.resolve()
		expect(started.filter(candidate => candidate >= number).length).toBeLessThanOrEqual(4)
		complete.get(number)?.(number)
		expect(await result).toBe(number)
	}
	expect(started).toEqual([10n, 11n, 12n, 13n, 14n, 15n])
	await expect(take(16n)).rejects.toThrow('within the scan range')
})

test('speculative failures are surfaced only when their block is consumed', async () => {
	const take = createBlockPrefetch(
		10n,
		12n,
		async number => {
			if (number === 11n) throw new Error('RPC failed')
			return number
		},
		new AbortController().signal,
	)
	expect(await take(10n)).toBe(10n)
	await expect(take(11n)).rejects.toThrow('RPC failed')
})

test('abort prevents further scheduling and rejects an in-flight consumption', async () => {
	const controller = new AbortController()
	const started: bigint[] = []
	const take = createBlockPrefetch(
		10n,
		20n,
		async number => {
			started.push(number)
			controller.abort(new Error('Stopped'))
			return number
		},
		controller.signal,
	)
	await expect(take(10n)).rejects.toThrow('Stopped')
	expect(started).toEqual([10n])
	await expect(take(10n)).rejects.toThrow('Stopped')
	expect(started).toEqual([10n])
})
