import { expect, test } from 'bun:test'
import { createRegistryIndex, readIncrementalRegistry, type RegistryAnchor } from '../lib/incrementalRegistry.js'

const anchor: RegistryAnchor = { blockNumber: 10n, blockHash: '0x01' }

test('reads only new registry entries and rebuilds after a reorg, rewind, or changed deployment', async () => {
	const index = createRegistryIndex<bigint>()
	let count = 205n
	let canonical = true
	const ranges: bigint[][] = []
	const read = async (key = 'factory', nextAnchor = anchor) =>
		await readIncrementalRegistry({
			index,
			key,
			anchor: nextAnchor,
			loadCount: async () => count,
			loadRange: async (start, size) => {
				ranges.push([start, size])
				return Array.from({ length: Number(size) }, (_, offset) => start + BigInt(offset))
			},
			isCanonical: async candidate => candidate === nextAnchor || canonical,
		})
	expect(await read()).toHaveLength(205)
	expect(ranges).toEqual([
		[0n, 100n],
		[100n, 100n],
		[200n, 5n],
	])
	ranges.length = 0
	count = 207n
	expect(await read('factory', { blockNumber: 11n, blockHash: '0x02' })).toHaveLength(207)
	expect(ranges).toEqual([[205n, 2n]])
	ranges.length = 0
	canonical = false
	await read('factory', { blockNumber: 12n, blockHash: '0x03' })
	expect(ranges[0]).toEqual([0n, 100n])
	ranges.length = 0
	canonical = true
	count = 2n
	await read()
	expect(ranges).toEqual([[0n, 2n]])
	ranges.length = 0
	await read('other-factory')
	expect(ranges).toEqual([[0n, 2n]])
})

test('does not cache incomplete pages or a replaced discovery anchor', async () => {
	const index = createRegistryIndex<number>()
	const options = { index, key: 'factory', anchor, loadCount: async () => 2n, isCanonical: async () => true }
	await expect(readIncrementalRegistry({ ...options, loadRange: async () => [1] })).rejects.toThrow('incomplete page')
	expect(index.snapshot).toBeUndefined()
	await expect(readIncrementalRegistry({ ...options, loadRange: async () => [1, 2], isCanonical: async () => false })).rejects.toThrow('changed during discovery')
	expect(index.snapshot).toBeUndefined()
	expect(await readIncrementalRegistry({ ...options, loadRange: async () => [1, 2] })).toEqual([1, 2])
})
