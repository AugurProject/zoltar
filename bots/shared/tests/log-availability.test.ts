import { expect, test } from 'bun:test'
import { RpcEndpointPoolFailure } from '../src/ethereum/rpc-resilience.ts'
import { findEarliestAvailableLogBlock, permanentHistoricalLogError } from '../src/monitoring/log-availability.ts'

test('distinguishes permanent log pruning from mixed provider failures and state errors', () => {
	const pruned = { error: 'eth_getLogs: pruned history unavailable', target: 'pruned' }
	expect(permanentHistoricalLogError(new RpcEndpointPoolFailure([pruned]))).toBe(true)
	expect(permanentHistoricalLogError(new Error('pruned history unavailable', { cause: new RpcEndpointPoolFailure([pruned, { error: 'timed out', target: 'offline' }]) }))).toBe(false)
	expect(permanentHistoricalLogError(Object.assign(new Error('provider-specific description'), { code: 4444 }))).toBe(true)
	for (const message of ['missing trie node', 'historical state unavailable', 'permission denied', 'rate limit exceeded', 'request timed out']) expect(permanentHistoricalLogError(new Error(message))).toBe(false)
	const cycle = new Error('unclassified failure')
	cycle.cause = cycle
	expect(permanentHistoricalLogError(cycle)).toBe(false)
})

test('locates an exact log floor with logarithmic probes, including an empty successful response', async () => {
	for (const floor of [0n, 1n, 42n, 999_999n, 1_000_000n]) {
		let probes = 0
		const result = await findEarliestAvailableLogBlock(0n, 1_000_000n, async block => {
			probes += 1
			if (block < floor) throw new Error('pruned history unavailable')
			return []
		})
		expect(result).toBe(floor)
		expect(probes).toBeLessThanOrEqual(22)
	}
})

test('does not skip timeouts, rate limits, or permission failures encountered during boundary probing', async () => {
	for (const failure of ['request timed out', 'rate limit exceeded', 'permission denied']) {
		await expect(
			findEarliestAvailableLogBlock(0n, 100n, async block => {
				if (block === 0n) throw new Error('pruned history unavailable')
				if (block !== 100n) throw new Error(failure)
			}),
		).rejects.toThrow(failure)
	}
	await expect(findEarliestAvailableLogBlock(10n, 9n, async () => [])).rejects.toThrow('must not exceed')
	await expect(
		findEarliestAvailableLogBlock(10n, 10n, async () => {
			throw new Error('pruned history unavailable')
		}),
	).rejects.toThrow('pruned history unavailable')
})
