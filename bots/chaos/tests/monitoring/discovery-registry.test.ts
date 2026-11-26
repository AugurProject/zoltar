import { expect, test } from 'bun:test'
import { collectCountedPages } from '../../src/monitoring/discovery-registry.ts'

test('exhausts a counted pool-style collection in bounded pages', async () => {
	const calls: Array<[bigint, bigint]> = []
	const values = [10n, 11n, 12n, 13n, 14n]
	const discovered = await collectCountedPages({
		count: BigInt(values.length),
		label: 'Pool discovery',
		maximumItems: values.length,
		pageSize: 2,
		readPage: async (start, count) => {
			calls.push([start, count])
			return values.slice(Number(start), Number(start + count))
		},
		start: 0n,
	})
	expect(discovered).toEqual({ complete: true, nextStart: 5n, values })
	expect(calls).toEqual([
		[0n, 2n],
		[2n, 2n],
		[4n, 1n],
	])
})

test('bounds a counted collection to one cycle and resumes from its durable cursor', async () => {
	const calls: Array<[bigint, bigint]> = []
	const values = Array.from({ length: 11 }, (_, index) => BigInt(index + 10))
	const readPage = async (start: bigint, count: bigint) => {
		calls.push([start, count])
		return values.slice(Number(start), Number(start + count))
	}
	const first = await collectCountedPages({ count: BigInt(values.length), label: 'Question discovery', maximumItems: 3, pageSize: 2, readPage, start: 0n })
	expect(first).toEqual({ complete: false, nextStart: 3n, values: [10n, 11n, 12n] })
	const second = await collectCountedPages({ count: BigInt(values.length), label: 'Question discovery', maximumItems: 3, pageSize: 2, readPage, start: first.nextStart })
	expect(second).toEqual({ complete: false, nextStart: 6n, values: [13n, 14n, 15n] })
	expect(calls).toEqual([
		[0n, 2n],
		[2n, 1n],
		[3n, 2n],
		[5n, 1n],
	])
})
