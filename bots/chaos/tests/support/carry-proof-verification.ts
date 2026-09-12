import { concatHex, keccak256, zeroHash, type Hash } from '@zoltar/bot-shared/ethereum'
import { computeNullifierRootFromProof, createMerkleMountainRangeProof, nullifierPath, sparseNullifierRoot } from '../../src/monitoring/carry-proof-index.ts'

// Reference verifiers mirroring the Solidity fork-carry proof checks. The bot only
// creates proofs, so the tests keep an independent verifier as their oracle.

type MerkleMountainRangeProof = ReturnType<typeof createMerkleMountainRangeProof>
type SparseNullifierState = Parameters<typeof sparseNullifierRoot>[0]

const CARRY_MMR_MAXIMUM_PEAKS = 64
const MAXIMUM_CARRY_LEAF_COUNT = 1n << BigInt(CARRY_MMR_MAXIMUM_PEAKS)

export function hashCarryParent(left: Hash, right: Hash): Hash {
	return keccak256(concatHex([left, right]))
}

function occupiedPeakCount(leafCount: bigint) {
	let count = 0
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 1n) count += 1
	}
	return count
}

export function computeMerkleMountainRangeRootFromProof(leafHash: Hash, leafCountValue: string, proof: MerkleMountainRangeProof): Hash {
	const leafCount = BigInt(leafCountValue)
	if (leafCount === 0n || leafCount >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry proof leaf count is outside the MMR capacity')
	const peakHeight = BigInt(proof.merkleMountainRangePeakIndex)
	if (peakHeight >= BigInt(CARRY_MMR_MAXIMUM_PEAKS)) throw new Error('Carry proof peak height is too high')
	if (((leafCount >> peakHeight) & 1n) !== 1n) throw new Error('Carry proof selected peak is absent')
	const leafIndex = BigInt(proof.leafIndex)
	if (leafIndex >= 1n << peakHeight) throw new Error('Carry proof leaf index is outside its peak')
	const expectedLength = Number(peakHeight) + occupiedPeakCount(leafCount) - 1
	if (proof.merkleMountainRangeSiblings.length !== expectedLength) throw new Error(`Carry proof has ${proof.merkleMountainRangeSiblings.length.toString()} siblings instead of ${expectedLength.toString()}`)

	let peakRoot = leafHash
	for (let level = 0; level < Number(peakHeight); level += 1) {
		const sibling = proof.merkleMountainRangeSiblings[level]
		if (sibling === undefined) throw new Error(`Carry proof path sibling ${level.toString()} is missing`)
		peakRoot = ((leafIndex >> BigInt(level)) & 1n) === 0n ? hashCarryParent(peakRoot, sibling) : hashCarryParent(sibling, peakRoot)
	}
	const peaks: Hash[] = []
	let siblingIndex = Number(peakHeight)
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		if (BigInt(height) === peakHeight) peaks.push(peakRoot)
		else {
			const siblingPeak = proof.merkleMountainRangeSiblings[siblingIndex]
			if (siblingPeak === undefined) throw new Error(`Carry proof other peak ${height.toString()} is missing`)
			peaks.push(siblingPeak)
			siblingIndex += 1
		}
	}
	let root = peaks.at(-1)
	if (root === undefined) throw new Error('Carry proof contains no peaks')
	for (let index = peaks.length - 2; index >= 0; index -= 1) {
		const peak = peaks[index]
		if (peak === undefined) throw new Error(`Carry proof peak ${index.toString()} is missing`)
		root = hashCarryParent(peak, root)
	}
	return root
}

export function verifyMerkleMountainRangeProof(leafHash: Hash, leafCount: string, expectedRoot: Hash, proof: MerkleMountainRangeProof) {
	const actualRoot = computeMerkleMountainRangeRootFromProof(leafHash, leafCount, proof)
	if (actualRoot.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error(`Carry proof root ${actualRoot} does not match ${expectedRoot}`)
	return actualRoot
}

export function emptySparseNullifierState(): SparseNullifierState {
	return { consumed: [] }
}

export function verifySparseNullifierAbsence(state: SparseNullifierState, parentDepositIndex: string, siblings: readonly Hash[]) {
	const rootFromProof = computeNullifierRootFromProof(parentDepositIndex, siblings, zeroHash)
	const expectedRoot = sparseNullifierRoot(state)
	if (rootFromProof.toLowerCase() !== expectedRoot.toLowerCase()) throw new Error(`Nullifier proof root ${rootFromProof} does not match ${expectedRoot}`)
	return rootFromProof
}

export function consumeSparseNullifier(state: SparseNullifierState, parentDepositIndex: string): SparseNullifierState {
	if (state.consumed.some(entry => entry.parentDepositIndex === parentDepositIndex)) throw new Error(`Parent deposit ${parentDepositIndex} is already nullified`)
	const entry = { parentDepositIndex, path: nullifierPath(parentDepositIndex).toString() }
	const consumed = [...state.consumed.map(value => ({ ...value })), entry].sort((left, right) => {
		const leftParent = BigInt(left.parentDepositIndex)
		const rightParent = BigInt(right.parentDepositIndex)
		if (leftParent < rightParent) return -1
		if (leftParent > rightParent) return 1
		return 0
	})
	const next = { consumed }
	// The production root computation validates path ownership and collisions.
	sparseNullifierRoot(next)
	return next
}
