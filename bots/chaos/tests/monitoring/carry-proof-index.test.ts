import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { buildCarryMerkleMountainRangeProof, hashCarryParent } from '@zoltar/core-shared/evm/carryProof'
import { carryCommitment, createMerkleMountainRangeProof, hashCarryLeaf, type CarryLeaf, type CarryOutcome } from '../../src/monitoring/carry-proof-index.ts'
import { computeMerkleMountainRangeRootFromProof, verifyMerkleMountainRangeProof } from '../support/carry-proof-verification.ts'

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

// Arbitrary hashes are sufficient for the pure MMR verifier; construct the root
// independently with the Solidity append/bag shape.
function independentMerkleMountainRangeRoot(hashes: readonly Hash[]) {
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
	return { peaks, root: bagged }
}

describe('fork-carry proof index', () => {
	test('hashes a carry leaf with the exact Solidity abi.encode layout', () => {
		const value = leaf({ amount: 17n, cumulative: 41n, outcome: 2, parentDepositIndex: 9n, sourceNodeId: 7n })
		const expected = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [value.depositor, 2, 17n, 9n, 41n, 7n]))
		expect(hashCarryLeaf(value)).toBe(expected)
	})

	test('matches Solidity MMR proofs for every leaf across single and multi-peak vectors', () => {
		for (const leafCount of [1, 2, 3, 5, 6, 7, 8]) {
			const hashes = Array.from({ length: leafCount }, (_, index) => hash(`leaf-${leafCount.toString()}-${index.toString()}`))
			const { root } = independentMerkleMountainRangeRoot(hashes)
			for (let index = 0; index < hashes.length; index += 1) {
				const proof = createMerkleMountainRangeProof(hashes, index)
				const leafHash = hashes[index]
				if (leafHash === undefined) throw new Error('Missing fixture leaf hash')
				expect(computeMerkleMountainRangeRootFromProof(leafHash, leafCount.toString(), proof)).toBe(root)
				expect(verifyMerkleMountainRangeProof(leafHash, leafCount.toString(), root, proof)).toBe(root)
			}
		}
	})

	test('uses the global leaf index with its containing peak height and ascending-height other-peak order', () => {
		const hashes = Array.from({ length: 5 }, (_, index) => hash(`five-${index.toString()}`))
		const largePeakRoot = hashCarryParent(hashCarryParent(hashes[0] ?? zeroHash, hashes[1] ?? zeroHash), hashCarryParent(hashes[2] ?? zeroHash, hashes[3] ?? zeroHash))
		const tailProof = createMerkleMountainRangeProof(hashes, 4)
		expect(tailProof.leafIndex).toBe('4')
		expect(tailProof.merkleMountainRangePeakIndex).toBe('0')
		expect(tailProof.merkleMountainRangeSiblings).toEqual([largePeakRoot])

		const largePeakProof = createMerkleMountainRangeProof(hashes, 2)
		expect(largePeakProof.leafIndex).toBe('2')
		expect(largePeakProof.merkleMountainRangePeakIndex).toBe('2')
		expect(largePeakProof.merkleMountainRangeSiblings.at(-1)).toBe(hashes[4])
	})

	test('adapts the shared carry-proof math without changing commitments or proofs', () => {
		for (const leafCount of [1, 2, 3, 5, 7, 8]) {
			const slots = Array.from({ length: leafCount }, (_, index) => {
				const value = leaf({ amount: BigInt(index + 1), cumulative: BigInt(index + 3), depositor: address(index + 1), outcome: 2, parentDepositIndex: BigInt(index), sourceNodeId: BigInt(index + 1) })
				return { hash: hashCarryLeaf(value), leaf: value, originGame: address(100) }
			})
			const hashes = slots.map(slot => slot.hash)
			const independent = independentMerkleMountainRangeRoot(hashes)
			const commitment = carryCommitment(slots)
			expect(commitment.leafCount).toBe(leafCount.toString())
			expect(commitment.root).toBe(independent.root)
			expect(commitment.peaks).toEqual(independent.peaks.map(peak => peak ?? zeroHash))
			for (let index = 0; index < leafCount; index += 1) {
				const shared = buildCarryMerkleMountainRangeProof(hashes, index)
				expect(shared.root).toBe(commitment.root)
				expect(createMerkleMountainRangeProof(hashes, index)).toEqual({
					leafIndex: shared.leafIndex.toString(),
					merkleMountainRangePeakIndex: shared.merkleMountainRangePeakIndex.toString(),
					merkleMountainRangeSiblings: shared.merkleMountainRangeSiblings,
				})
			}
		}
	})

	test('keeps strict input validation in the adapter', () => {
		const hashes = [hash('a'), hash('b'), hash('c')]
		expect(() => createMerkleMountainRangeProof(hashes, 3)).toThrow('outside the MMR')
		expect(() => createMerkleMountainRangeProof(hashes, 0.5)).toThrow('outside the MMR')
		expect(() => createMerkleMountainRangeProof([hash('a'), hash('b'), '0x1234'], 0)).toThrow('Carry leaf slot hash must be a 32-byte hash')
		const value = leaf({ parentDepositIndex: 0n, sourceNodeId: 1n })
		expect(() => carryCommitment([{ hash: zeroHash, leaf: value, originGame: address(100) }])).toThrow('hash does not match its carry leaf')
	})
})
