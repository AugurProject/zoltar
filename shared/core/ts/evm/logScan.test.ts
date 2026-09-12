import { expect, test } from 'bun:test'
import { fetchLogsWithAdaptiveRanges } from './logScan.js'

test('appends large successful batches completely and in order', async () => {
	const batch = Array.from({ length: 1_000_000 }, (_, index) => index)
	const logs = await fetchLogsWithAdaptiveRanges(0n, 2n, 1n, async ({ fromBlock }) => (fromBlock === 1n ? batch : [fromBlock === 0n ? -1 : batch.length]))
	expect(logs).toHaveLength(batch.length + 2)
	expect(logs[0]).toBe(-1)
	expect(logs.slice(1, -1)).toEqual(batch)
	expect(logs.at(-1)).toBe(batch.length)
})

test('narrows rejected ranges, preserves order, and restores the maximum range after success', async () => {
	const ranges: Array<readonly [bigint, bigint]> = []
	const logs = await fetchLogsWithAdaptiveRanges(0n, 5n, 4n, async ({ fromBlock, toBlock }) => {
		ranges.push([fromBlock, toBlock])
		if (fromBlock === 0n && toBlock === 3n) throw new Error('block range is too large')
		return Array.from({ length: Number(toBlock - fromBlock + 1n) }, (_, index) => fromBlock + BigInt(index))
	})
	expect(ranges).toEqual([
		[0n, 3n],
		[0n, 1n],
		[2n, 5n],
	])
	expect(logs).toEqual([0n, 1n, 2n, 3n, 4n, 5n])
})
