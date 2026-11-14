import { getAddress, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { bagCarryPeaks, buildCarryMerkleMountainRangeProof, buildCarryPeakRoots, CARRY_NULLIFIER_DEPTH, computeCarryNullifierRootFromProof, createSparseNullifier, getCarryNullifierPath, hashCarryLeaf as hashSharedCarryLeaf } from '@zoltar/core-shared/evm/carryProof'
import { maxUint256 } from '@zoltar/core-shared/evm/ethereum'

import { type CanonicalUintString } from '../core/units.ts'

const CARRY_MMR_MAXIMUM_PEAKS = 64

const MAXIMUM_CARRY_LEAF_COUNT = 1n << BigInt(CARRY_MMR_MAXIMUM_PEAKS)

const MAXIMUM_UINT256_DECIMAL = maxUint256.toString()

const NULLIFIER_PATH_MASK = (1n << BigInt(CARRY_NULLIFIER_DEPTH)) - 1n

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
	consumedLocally: boolean
}

interface SparseNullifierEntry {
	parentDepositIndex: string
	/** Decimal encoding of the low 64 bits of keccak256(abi.encode(parentDepositIndex)). */
	path: string
}

interface SparseNullifierState {
	consumed: SparseNullifierEntry[]
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
		const expectedHash = hashCarryLeaf(slot.leaf)
		if (slot.consumedLocally) {
			if (slot.hash !== zeroHash) throw new Error(`${label}[${index.toString()}] locally consumed slot is not the literal zero hash`)
		} else if (slot.hash.toLowerCase() !== expectedHash.toLowerCase()) {
			throw new Error(`${label}[${index.toString()}] hash does not match its carry leaf`)
		}
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

function nullifierParent(parentDepositIndex: string) {
	return unsignedInteger(parentDepositIndex, 'Nullifier parentDepositIndex')
}

export function nullifierPath(parentDepositIndex: string) {
	return getCarryNullifierPath(nullifierParent(parentDepositIndex))
}

function assertNoNullifierPathCollisions(entries: readonly SparseNullifierEntry[]) {
	const ownerByPath = new Map<string, string>()
	for (const entry of entries) {
		unsignedInteger(entry.parentDepositIndex, 'Nullifier entry parentDepositIndex')
		const path = unsignedInteger(entry.path, 'Nullifier entry path')
		if (path > NULLIFIER_PATH_MASK) throw new Error('Nullifier entry path exceeds 64 bits')
		const previous = ownerByPath.get(entry.path)
		if (previous !== undefined && previous !== entry.parentDepositIndex) {
			throw new Error(`Nullifier path collision between parent deposits ${previous} and ${entry.parentDepositIndex}`)
		}
		ownerByPath.set(entry.path, entry.parentDepositIndex)
	}
}

function validateSparseNullifierState(state: SparseNullifierState) {
	assertNoNullifierPathCollisions(state.consumed)
	const parents = new Set<string>()
	let previous: bigint | undefined
	for (const entry of state.consumed) {
		const parent = unsignedInteger(entry.parentDepositIndex, 'Nullifier entry parentDepositIndex')
		if (parents.has(entry.parentDepositIndex)) throw new Error(`Nullifier parent deposit ${entry.parentDepositIndex} is duplicated`)
		parents.add(entry.parentDepositIndex)
		if (previous !== undefined && parent <= previous) throw new Error('Nullifier entries are not in canonical parent-deposit order')
		previous = parent
		const expectedPath = nullifierPath(entry.parentDepositIndex).toString()
		if (entry.path !== expectedPath) throw new Error(`Nullifier path for parent deposit ${entry.parentDepositIndex} is invalid`)
	}
}

function sparseNullifier(state: SparseNullifierState) {
	validateSparseNullifierState(state)
	return createSparseNullifier(state.consumed.map(entry => BigInt(entry.parentDepositIndex)))
}

export function sparseNullifierRoot(state: SparseNullifierState): Hash {
	return sparseNullifier(state).getRoot()
}

export function createSparseNullifierProof(state: SparseNullifierState, parentDepositIndex: string): Hash[] {
	return sparseNullifier(state).getProof(nullifierParent(parentDepositIndex))
}

export function computeNullifierRootFromProof(parentDepositIndex: string, siblings: readonly Hash[], leafValue: Hash): Hash {
	if (siblings.length !== CARRY_NULLIFIER_DEPTH) throw new Error(`Nullifier proof has ${siblings.length.toString()} siblings instead of ${CARRY_NULLIFIER_DEPTH.toString()}`)
	requireHash(leafValue, 'Nullifier leaf value')
	const parent = nullifierParent(parentDepositIndex)
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const sibling = siblings[depth]
		if (sibling === undefined) throw new Error(`Nullifier sibling ${depth.toString()} is missing`)
		requireHash(sibling, `Nullifier sibling ${depth.toString()}`)
	}
	return computeCarryNullifierRootFromProof(parent, siblings, leafValue)
}
