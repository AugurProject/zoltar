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
