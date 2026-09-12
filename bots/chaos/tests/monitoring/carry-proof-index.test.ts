import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { computeNullifierRootFromProof, createMerkleMountainRangeProof, createSparseNullifierProof, hashCarryLeaf, nullifierPath, sparseNullifierRoot, type CarryLeaf, type CarryOutcome } from '../../src/monitoring/carry-proof-index.ts'
import { computeMerkleMountainRangeRootFromProof, consumeSparseNullifier, emptySparseNullifierState, hashCarryParent, verifyMerkleMountainRangeProof, verifySparseNullifierAbsence } from '../support/carry-proof-verification.ts'

function address(value: number): Address {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function hash(value: string): Hash {
	return keccak256(toHex(value))
}

function leaf(parameters: { amount?: bigint; cumulative?: bigint; depositor?: Address; outcome?: CarryOutcome; parentDepositIndex: bigint; sourceNodeId: bigint }): CarryLeaf {
	const amount = parameters.amount ?? 10n
	return {
		amountAttoRep: amount.toString(),
		cumulativeAmountAttoRep: (parameters.cumulative ?? amount).toString(),
		depositor: parameters.depositor ?? address(1),
		outcome: parameters.outcome ?? 1,
		parentDepositIndex: parameters.parentDepositIndex.toString(),
		sourceNodeId: parameters.sourceNodeId.toString(),
	}
}

describe('fork-carry proof index', () => {
	test('hashes a carry leaf with the exact Solidity abi.encode layout', () => {
		const value = leaf({ amount: 17n, cumulative: 41n, outcome: 2, parentDepositIndex: 9n, sourceNodeId: 7n })
		const expected = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [value.depositor, 2, 17n, 9n, 41n, 7n]))
		expect(hashCarryLeaf(value)).toBe(expected)
	})

	test('matches Solidity MMR proofs for every leaf across single and multi-peak vectors', () => {
		for (const leafCount of [1, 2, 3, 5, 6]) {
			const hashes = Array.from({ length: leafCount }, (_, index) => hash(`leaf-${leafCount.toString()}-${index.toString()}`))
			const root = (() => {
				// Arbitrary hashes are sufficient for the pure MMR verifier; construct the
				// root independently with the same append/bag shape below.
				const peaks: Array<Hash | undefined> = Array.from({ length: 64 }, () => undefined)
				let count = 0n
				for (const current of hashes) {
					let node = current
					let height = 0
					while (((count >> BigInt(height)) & 1n) === 1n) {
						const left = peaks[height]
						if (left === undefined) throw new Error('Missing fixture peak')
						node = hashCarryParent(left, node)
						peaks[height] = undefined
						height += 1
					}
					peaks[height] = node
					count += 1n
				}
				const occupied = peaks.filter((peak): peak is Hash => peak !== undefined)
				let bagged = occupied.at(-1)
				if (bagged === undefined) throw new Error('Missing fixture MMR root')
				for (let index = occupied.length - 2; index >= 0; index -= 1) {
					const peak = occupied[index]
					if (peak === undefined) throw new Error('Missing fixture bag peak')
					bagged = hashCarryParent(peak, bagged)
				}
				return bagged
			})()

			for (let index = 0; index < hashes.length; index += 1) {
				const proof = createMerkleMountainRangeProof(hashes, index)
				const leafHash = hashes[index]
				if (leafHash === undefined) throw new Error('Missing fixture leaf hash')
				expect(computeMerkleMountainRangeRootFromProof(leafHash, leafCount.toString(), proof)).toBe(root)
				expect(verifyMerkleMountainRangeProof(leafHash, leafCount.toString(), root, proof)).toBe(root)
			}
		}
	})

	test('uses a peak-relative leaf index and ascending-height other-peak order', () => {
		const hashes = Array.from({ length: 5 }, (_, index) => hash(`five-${index.toString()}`))
		const largePeakRoot = hashCarryParent(hashCarryParent(hashes[0] ?? zeroHash, hashes[1] ?? zeroHash), hashCarryParent(hashes[2] ?? zeroHash, hashes[3] ?? zeroHash))
		const tailProof = createMerkleMountainRangeProof(hashes, 4)
		expect(tailProof.leafIndex).toBe('0')
		expect(tailProof.merkleMountainRangePeakIndex).toBe('0')
		expect(tailProof.merkleMountainRangeSiblings).toEqual([largePeakRoot])

		const largePeakProof = createMerkleMountainRangeProof(hashes, 2)
		expect(largePeakProof.leafIndex).toBe('2')
		expect(largePeakProof.merkleMountainRangePeakIndex).toBe('2')
		expect(largePeakProof.merkleMountainRangeSiblings.at(-1)).toBe(hashes[4])
	})

	test('builds sequential 64-depth sparse nullifier proofs and rejects stale proofs', () => {
		const empty = emptySparseNullifierState()
		const firstProof = createSparseNullifierProof(empty, '0')
		expect(firstProof).toHaveLength(64)
		expect(verifySparseNullifierAbsence(empty, '0', firstProof)).toBe(sparseNullifierRoot(empty))

		const staleSecondProof = createSparseNullifierProof(empty, '1')
		const afterFirst = consumeSparseNullifier(empty, '0')
		const firstConsumedRoot = computeNullifierRootFromProof('0', firstProof, `0x${'0'.repeat(63)}1`)
		expect(firstConsumedRoot).toBe(sparseNullifierRoot(afterFirst))
		expect(() => verifySparseNullifierAbsence(afterFirst, '1', staleSecondProof)).toThrow('does not match')

		const currentSecondProof = createSparseNullifierProof(afterFirst, '1')
		expect(verifySparseNullifierAbsence(afterFirst, '1', currentSecondProof)).toBe(sparseNullifierRoot(afterFirst))
		const afterSecond = consumeSparseNullifier(afterFirst, '1')
		expect(sparseNullifierRoot(afterSecond)).not.toBe(sparseNullifierRoot(afterFirst))
	})

	test('detects explicit low-64-bit nullifier path collisions', () => {
		expect(() =>
			sparseNullifierRoot({
				consumed: [
					{ parentDepositIndex: '1', path: '9' },
					{ parentDepositIndex: '2', path: '9' },
				],
			}),
		).toThrow('path collision')
		expect(nullifierPath('1')).toBeLessThan(1n << 64n)
	})
})
