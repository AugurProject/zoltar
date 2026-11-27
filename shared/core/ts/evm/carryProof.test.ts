import { describe, expect, test } from 'bun:test'
import { bagCarryPeaks, buildCarryMerkleMountainRangeProof, buildCarryPeakRoots, hashCarryParent } from './carryProof.js'
import { concatHex, keccak256, toHex, type Hex } from './ethereum.js'

function leafHashes(count: number) {
	return Array.from({ length: count }, (_, index) => keccak256(toHex(`leaf-${index.toString()}`)))
}

function at(hashes: readonly Hex[], index: number) {
	const value = hashes[index]
	if (value === undefined) throw new Error(`Missing fixture hash ${index.toString()}`)
	return value
}

describe('carry proof primitives', () => {
	test('hashes a parent as keccak256 of the concatenated children', () => {
		const hashes = leafHashes(2)
		const left = at(hashes, 0)
		const right = at(hashes, 1)
		expect(hashCarryParent(left, right)).toBe(keccak256(concatHex([left, right])))
		expect(hashCarryParent(left, right)).not.toBe(hashCarryParent(right, left))
	})

	test('builds peak roots by descending height with their leaf offsets', () => {
		expect(buildCarryPeakRoots([])).toEqual([])
		const hashes = leafHashes(7)
		const h = (index: number) => at(hashes, index)
		expect(buildCarryPeakRoots(hashes)).toEqual([
			{ height: 2, leafOffset: 0, root: hashCarryParent(hashCarryParent(h(0), h(1)), hashCarryParent(h(2), h(3))) },
			{ height: 1, leafOffset: 4, root: hashCarryParent(h(4), h(5)) },
			{ height: 0, leafOffset: 6, root: h(6) },
		])
	})

	test('proves every leaf against the bagged peak roots', () => {
		for (const leafCount of [1, 2, 3, 5, 7, 8]) {
			const hashes = leafHashes(leafCount)
			const peaks = buildCarryPeakRoots(hashes)
			const expectedRoot = bagCarryPeaks(peaks.map(peak => peak.root).reverse())
			for (let index = 0; index < leafCount; index += 1) {
				const proof = buildCarryMerkleMountainRangeProof(hashes, index)
				expect(proof.root).toBe(expectedRoot)
				const targetPeak = peaks.find(peak => index >= peak.leafOffset && index < peak.leafOffset + 2 ** peak.height)
				if (targetPeak === undefined) throw new Error('Missing target peak')
				expect(proof.merkleMountainRangePeakIndex).toBe(BigInt(targetPeak.height))
				expect(proof.merkleMountainRangeSiblings).toHaveLength(targetPeak.height + peaks.length - 1)
			}
		}
	})
})
