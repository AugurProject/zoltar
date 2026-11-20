import { expect, test } from 'bun:test'
import { findSparseCanonicalAncestor } from '../../src/indexer/runtime-chain.ts'

test('finds the retained ancestor of a reorganization deeper than the confirmation depth', async () => {
	// Block 71 is retained; 72 to 140 were replaced, 69 blocks, more than a 64-block confirmation depth.
	const retained = `0x${'7'.repeat(64)}` as const
	const stored = new Map<bigint, `0x${string}`>([
		[3n, `0x${'3'.repeat(64)}`],
		[71n, retained],
		[100n, `0x${'a'.repeat(64)}`],
		[139n, `0x${'b'.repeat(64)}`],
	])
	const headerReads: bigint[] = []
	const ancestor = await findSparseCanonicalAncestor(
		139n,
		async atOrBefore => {
			const number = [...stored.keys()].filter(candidate => candidate <= atOrBefore).toSorted((left, right) => (left < right ? 1 : -1))[0]
			const hash = number === undefined ? undefined : stored.get(number)
			return number === undefined || hash === undefined ? undefined : { number, hash }
		},
		async number => {
			headerReads.push(number)
			return number <= 71n ? (stored.get(number) ?? `0x${'0'.repeat(64)}`) : `0x${'f'.repeat(64)}`
		},
	)
	// The rewind keeps block 71, so the recorded depth is the 69 replaced blocks rather than a full replay.
	expect(ancestor).toEqual({ number: 71n, hash: retained })
	expect(headerReads).toEqual([139n, 100n, 71n])
})

test('reports no ancestor when no stored anchor survives', async () => {
	const ancestor = await findSparseCanonicalAncestor(
		10n,
		async atOrBefore => (atOrBefore >= 5n ? { number: 5n, hash: `0x${'5'.repeat(64)}` } : undefined),
		async () => `0x${'6'.repeat(64)}`,
	)
	expect(ancestor).toBeUndefined()
})

const storedChain = (count: bigint) => {
	const hash = (number: bigint) => `0x${number.toString(16).padStart(64, '0')}` as const
	return {
		atOrBefore: async (blockNumber: bigint) => (blockNumber < 0n ? undefined : { number: blockNumber < count ? blockNumber : count - 1n, hash: hash(blockNumber < count ? blockNumber : count - 1n) }),
		hash,
	}
}

test('bounds header reads logarithmically across a long stored history', async () => {
	const count = 10_000n
	const { atOrBefore, hash } = storedChain(count)
	for (const retained of [9_990n, 4_321n, 0n, -1n]) {
		let reads = 0
		const ancestor = await findSparseCanonicalAncestor(count - 1n, atOrBefore, async number => {
			reads += 1
			return number <= retained ? hash(number) : `0x${'f'.repeat(64)}`
		})
		expect(ancestor).toEqual(retained < 0n ? undefined : { number: retained, hash: hash(retained) })
		// log2(10,000) is about 13.3, so a doubling search and a bisection stay well under 2·log2(n) + 2 reads.
		expect(reads).toBeLessThanOrEqual(29)
	}
})

test('stops an ancestor search when indexing is aborted', async () => {
	const { atOrBefore } = storedChain(10_000n)
	const controller = new AbortController()
	let reads = 0
	const search = findSparseCanonicalAncestor(
		9_999n,
		atOrBefore,
		async () => {
			reads += 1
			if (reads === 3) controller.abort()
			return `0x${'f'.repeat(64)}`
		},
		controller.signal,
	)
	await expect(search).rejects.toThrow()
	expect(reads).toBe(3)
})
