import { expect, test } from 'bun:test'
import { findEarliestAvailableBlock } from './availability.js'

const pruned = new Error('pruned')
const isPruned = (error: unknown) => error === pruned

function prunedBefore(firstAvailable: bigint, probes: bigint[] = []) {
	return async (blockNumber: bigint) => {
		probes.push(blockNumber)
		if (blockNumber < firstAvailable) throw pruned
	}
}

test('returns the start block when it is available', async () => {
	const probes: bigint[] = []
	expect(await findEarliestAvailableBlock(5n, 100n, prunedBefore(0n, probes), isPruned)).toBe(5n)
	expect(probes).toEqual([5n])
})

test('bisects to the first available block of a pruned prefix', async () => {
	expect(await findEarliestAvailableBlock(0n, 1_000_000n, prunedBefore(123_457n), isPruned)).toBe(123_457n)
	expect(await findEarliestAvailableBlock(10n, 11n, prunedBefore(11n), isPruned)).toBe(11n)
})

test('skips the start probe when the start is known to be unavailable', async () => {
	const probes: bigint[] = []
	expect(await findEarliestAvailableBlock(10n, 20n, prunedBefore(0n, probes), isPruned, { startKnownUnavailable: true })).toBe(11n)
	expect(probes[0]).toBe(20n)
	expect(probes).not.toContain(10n)
})

test('rejects searches that start after the head or below zero', async () => {
	await expect(findEarliestAvailableBlock(10n, 9n, async () => undefined, isPruned)).rejects.toThrow('must not exceed')
	await expect(findEarliestAvailableBlock(-1n, 9n, async () => undefined, isPruned)).rejects.toThrow('be negative')
})

test('propagates the head probe error unless a head-unavailable error is supplied', async () => {
	await expect(findEarliestAvailableBlock(0n, 10n, prunedBefore(11n), isPruned)).rejects.toBe(pruned)
	const headError = new Error('head unavailable')
	await expect(findEarliestAvailableBlock(0n, 10n, prunedBefore(11n), isPruned, { headUnavailableError: () => headError })).rejects.toBe(headError)
})

test('propagates failures that are not classified as unavailable', async () => {
	const unrelated = new Error('timeout')
	await expect(
		findEarliestAvailableBlock(
			0n,
			10n,
			async blockNumber => {
				if (blockNumber === 5n) throw unrelated
				if (blockNumber < 7n) throw pruned
			},
			isPruned,
		),
	).rejects.toBe(unrelated)
})
