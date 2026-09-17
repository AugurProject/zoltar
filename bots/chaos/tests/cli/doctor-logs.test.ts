import { expect, test } from 'bun:test'
import { probeDoctorLogRange } from '../../src/cli/doctor.ts'
import type { ChaosReadClient } from '../../src/monitoring/discovery-client.ts'

const addresses = ['0x0000000000000000000000000000000000000001'] as const

test.each([0n, 42n, 999n, 1_000n])('probes a bounded available range with log floor %s', async floor => {
	const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
	const client: Pick<ChaosReadClient, 'getLogs'> = {
		getLogs: async range => {
			if (typeof range.fromBlock !== 'bigint' || typeof range.toBlock !== 'bigint') throw new Error('Expected explicit log range')
			ranges.push({ fromBlock: range.fromBlock, toBlock: range.toBlock })
			if (range.fromBlock < floor) throw new Error('pruned history unavailable')
			return []
		},
	}
	const result = await probeDoctorLogRange(client, addresses, 0n, 1_000n, 512n)
	expect(result).toMatchObject({ fromBlock: floor, toBlock: floor + 511n < 1_000n ? floor + 511n : 1_000n, logCount: 0, prunedBeforeBlock: floor === 0n ? undefined : floor.toString() })
	expect(ranges.every(range => range.toBlock - range.fromBlock < 256n && range.toBlock <= 1_000n)).toBe(true)
	expect(ranges.length).toBeLessThan(16)
})

test.each(['permission denied', 'request timed out', 'rate limit exceeded'])('does not treat %s as pruned history', async failure => {
	let calls = 0
	await expect(
		probeDoctorLogRange(
			{
				getLogs: async () => {
					calls += 1
					throw new Error(failure)
				},
			},
			addresses,
			0n,
			1_000n,
			256n,
		),
	).rejects.toThrow(failure)
	expect(calls).toBe(1)
})

test('still rejects readers that cannot serve logs at the canonical head', async () => {
	let calls = 0
	await expect(
		probeDoctorLogRange(
			{
				getLogs: async () => {
					calls += 1
					throw new Error('pruned history unavailable')
				},
			},
			addresses,
			0n,
			1_000n,
			256n,
		),
	).rejects.toThrow('pruned history unavailable')
	expect(calls).toBe(3)
})
