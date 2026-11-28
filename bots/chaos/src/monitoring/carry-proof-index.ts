import { getAddress, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { bagCarryPeaks, buildCarryMerkleMountainRangeProof, buildCarryPeakRoots, hashCarryLeaf as hashSharedCarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { maxUint256 } from '@zoltar/core-shared/evm/ethereum'

import type { CanonicalUintString } from '../core/units.ts'

const CARRY_MMR_MAXIMUM_PEAKS = 64

const MAXIMUM_CARRY_LEAF_COUNT = 1n << BigInt(CARRY_MMR_MAXIMUM_PEAKS)

const MAXIMUM_UINT256_DECIMAL = maxUint256.toString()

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/

export type CarryOutcome = 0 | 1 | 2

export interface CarryLeaf {
	depositor: Address
	outcome: CarryOutcome
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	cumulativeAmountAttoRep: CanonicalUintString
	sourceNodeId: string
}

export interface CarryLeafSlot {
	hash: Hash
	originGame: Address
	leaf: CarryLeaf
}

interface MerkleMountainRangeProof {
	/** Global MMR slot; the verifier derives the offset within the selected peak. */
	leafIndex: string
	/** The Solidity field is named peakIndex, but its value is the selected peak height. */
	merkleMountainRangePeakIndex: string
	/** Intra-peak siblings bottom-up, followed by other peak roots in ascending-height order. */
	merkleMountainRangeSiblings: Hash[]
}

interface CarryCommitment {
	leafCount: string
	peaks: Hash[]
	root: Hash
}

function unsignedInteger(value: string, label: string) {
	if (!UNSIGNED_INTEGER_PATTERN.test(value)) throw new Error(`${label} must be an unsigned decimal integer`)
	if (value.length > MAXIMUM_UINT256_DECIMAL.length || (value.length === MAXIMUM_UINT256_DECIMAL.length && value > MAXIMUM_UINT256_DECIMAL)) {
		throw new Error(`${label} exceeds uint256`)
	}
	const parsed = BigInt(value)
	return parsed
}

function requireHash(value: string, label: string) {
	if (!HASH_PATTERN.test(value)) throw new Error(`${label} must be a 32-byte hash`)
}

function requireOutcome(value: number, label = 'Carry outcome'): asserts value is CarryOutcome {
	if (value !== 0 && value !== 1 && value !== 2) throw new Error(`${label} must be Invalid, Yes, or No`)
}

function requireLeaf(leaf: CarryLeaf, label = 'Carry leaf') {
	requireOutcome(leaf.outcome, `${label} outcome`)
	getAddress(leaf.depositor)
	const amountAttoRep = unsignedInteger(leaf.amountAttoRep, `${label} amountAttoRep`)
	const cumulativeAmountAttoRep = unsignedInteger(leaf.cumulativeAmountAttoRep, `${label} cumulativeAmountAttoRep`)
	unsignedInteger(leaf.parentDepositIndex, `${label} parentDepositIndex`)
	const sourceNodeId = unsignedInteger(leaf.sourceNodeId, `${label} sourceNodeId`)
	if (amountAttoRep === 0n) throw new Error(`${label} amountAttoRep must be positive`)
	if (cumulativeAmountAttoRep < amountAttoRep) throw new Error(`${label} cumulativeAmountAttoRep is below its amount`)
	if (sourceNodeId === 0n) throw new Error(`${label} sourceNodeId must be positive`)
}

export function hashCarryLeaf(leaf: CarryLeaf): Hash {
	requireLeaf(leaf)
	return hashSharedCarryLeaf(
		{
			amountAttoRep: BigInt(leaf.amountAttoRep),
			cumulativeAmountAttoRep: BigInt(leaf.cumulativeAmountAttoRep),
			depositor: leaf.depositor,
			parentDepositIndex: BigInt(leaf.parentDepositIndex),
			sourceNodeId: BigInt(leaf.sourceNodeId),
		},
		leaf.outcome,
	)
}

function requireSlots(slots: readonly CarryLeafSlot[], label: string) {
	if (BigInt(slots.length) >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error(`${label} exceeds the 64-peak MMR capacity`)
	for (let index = 0; index < slots.length; index += 1) {
		const slot = slots[index]
		if (slot === undefined) throw new Error(`${label} has a missing slot at ${index.toString()}`)
		requireHash(slot.hash, `${label}[${index.toString()}].hash`)
		getAddress(slot.originGame)
		requireLeaf(slot.leaf, `${label}[${index.toString()}].leaf`)
		// Carry is append-only: consumed leaves keep their hash in every later snapshot.
		if (slot.hash.toLowerCase() !== hashCarryLeaf(slot.leaf).toLowerCase()) throw new Error(`${label}[${index.toString()}] hash does not match its carry leaf`)
	}
}

function requireHashes(hashes: readonly Hash[]) {
	if (BigInt(hashes.length) >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry hashes exceed the 64-peak MMR capacity')
	for (const hash of hashes) requireHash(hash, 'Carry leaf slot hash')
}

export function carryCommitment(slots: readonly CarryLeafSlot[]): CarryCommitment {
	requireSlots(slots, 'Carry slots')
	const peakRoots = buildCarryPeakRoots(slots.map(slot => slot.hash))
	const peaks: Hash[] = Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => zeroHash)
	for (const peak of peakRoots) peaks[peak.height] = peak.root
	return {
		leafCount: slots.length.toString(),
		peaks,
		root: bagCarryPeaks(peakRoots.map(peak => peak.root).reverse()),
	}
}

export function createMerkleMountainRangeProof(hashes: readonly Hash[], globalLeafIndex: number): MerkleMountainRangeProof {
	if (!Number.isSafeInteger(globalLeafIndex) || globalLeafIndex < 0 || globalLeafIndex >= hashes.length) throw new Error('Carry proof global leaf index is outside the MMR')
	requireHashes(hashes)
	const proof = buildCarryMerkleMountainRangeProof(hashes, globalLeafIndex)
	return {
		leafIndex: proof.leafIndex.toString(),
		merkleMountainRangePeakIndex: proof.merkleMountainRangePeakIndex.toString(),
		merkleMountainRangeSiblings: proof.merkleMountainRangeSiblings,
	}
}
