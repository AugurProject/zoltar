import { concatHex, encodeAbiParameters, getAddress, keccak256, toHex, zeroHash, type Address, type Hash } from '@zoltar/bot-shared/ethereum'

import { type CanonicalUintString } from '../core/units.ts'

const CARRY_MMR_MAXIMUM_PEAKS = 64

const CARRY_NULLIFIER_DEPTH = 64

const MAXIMUM_CARRY_LEAF_COUNT = 1n << BigInt(CARRY_MMR_MAXIMUM_PEAKS)

const MAXIMUM_UINT256 = (1n << 256n) - 1n

const MAXIMUM_UINT256_DECIMAL = MAXIMUM_UINT256.toString()

const NULLIFIER_PATH_MASK = (1n << BigInt(CARRY_NULLIFIER_DEPTH)) - 1n

const NULLIFIER_CONSUMED_LEAF = toHex(1n, { size: 32 })

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
	/** Offset within the selected peak, not the global MMR slot. */
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

function hashCarryParent(left: Hash, right: Hash): Hash {
	requireHash(left, 'Left carry hash')
	requireHash(right, 'Right carry hash')
	return keccak256(concatHex([left, right]))
}

export function hashCarryLeaf(leaf: CarryLeaf): Hash {
	requireLeaf(leaf)
	return keccak256(
		encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [leaf.depositor, leaf.outcome, BigInt(leaf.amountAttoRep), BigInt(leaf.parentDepositIndex), BigInt(leaf.cumulativeAmountAttoRep), BigInt(leaf.sourceNodeId)]),
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

function computedPeaks(hashes: readonly Hash[]) {
	if (BigInt(hashes.length) >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry hashes exceed the 64-peak MMR capacity')
	const peaks: Array<Hash | undefined> = Array.from({ length: CARRY_MMR_MAXIMUM_PEAKS }, () => undefined)
	let leafCount = 0n
	for (const hash of hashes) {
		requireHash(hash, 'Carry leaf slot hash')
		let node = hash
		let height = 0
		while (((leafCount >> BigInt(height)) & 1n) === 1n) {
			const left = peaks[height]
			if (left === undefined) throw new Error(`Carry MMR peak ${height.toString()} is missing during append`)
			node = hashCarryParent(left, node)
			peaks[height] = undefined
			height += 1
		}
		if (height >= CARRY_MMR_MAXIMUM_PEAKS) throw new Error('Carry MMR is too tall')
		peaks[height] = node
		leafCount += 1n
	}
	return peaks
}

function bagComputedPeaks(peaks: readonly (Hash | undefined)[], leafCount: bigint): Hash {
	if (leafCount === 0n) return zeroHash
	const occupied: Hash[] = []
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const peak = peaks[height]
		if (peak === undefined) throw new Error(`Occupied carry peak ${height.toString()} is missing`)
		occupied.push(peak)
	}
	const last = occupied.at(-1)
	if (last === undefined) throw new Error('Nonempty carry MMR has no occupied peak')
	let root = last
	for (let index = occupied.length - 2; index >= 0; index -= 1) {
		const peak = occupied[index]
		if (peak === undefined) throw new Error(`Carry peak ${index.toString()} is missing during bagging`)
		root = hashCarryParent(peak, root)
	}
	return root
}

export function carryCommitment(slots: readonly CarryLeafSlot[]): CarryCommitment {
	requireSlots(slots, 'Carry slots')
	const leafCount = BigInt(slots.length)
	const peaks = computedPeaks(slots.map(slot => slot.hash))
	return {
		leafCount: leafCount.toString(),
		peaks: peaks.map(peak => peak ?? zeroHash),
		root: bagComputedPeaks(peaks, leafCount),
	}
}

function peakForGlobalLeaf(leafCount: bigint, globalLeafIndex: bigint) {
	if (leafCount <= 0n || globalLeafIndex < 0n || globalLeafIndex >= leafCount) throw new Error('Carry global leaf index is outside the MMR')
	let peakStartIndex = 0n
	for (let height = CARRY_MMR_MAXIMUM_PEAKS - 1; height >= 0; height -= 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const nextPeakStartIndex = peakStartIndex + (1n << BigInt(height))
		if (globalLeafIndex < nextPeakStartIndex) {
			return { height, peakStartIndex, relativeLeafIndex: globalLeafIndex - peakStartIndex }
		}
		peakStartIndex = nextPeakStartIndex
	}
	throw new Error('Carry leaf has no occupied MMR peak')
}

function merkleRoot(hashes: readonly Hash[]) {
	if (hashes.length === 0 || (hashes.length & (hashes.length - 1)) !== 0) throw new Error('Merkle peak must contain a positive power-of-two number of leaves')
	let level = [...hashes]
	while (level.length > 1) {
		const next: Hash[] = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = level[index + 1]
			if (left === undefined || right === undefined) throw new Error('Merkle peak contains an incomplete pair')
			next.push(hashCarryParent(left, right))
		}
		level = next
	}
	const root = level[0]
	if (root === undefined) throw new Error('Merkle peak root is missing')
	return root
}

export function createMerkleMountainRangeProof(hashes: readonly Hash[], globalLeafIndex: number): MerkleMountainRangeProof {
	if (!Number.isSafeInteger(globalLeafIndex) || globalLeafIndex < 0 || globalLeafIndex >= hashes.length) throw new Error('Carry proof global leaf index is outside the MMR')
	const leafCount = BigInt(hashes.length)
	if (leafCount >= MAXIMUM_CARRY_LEAF_COUNT) throw new Error('Carry hashes exceed the 64-peak MMR capacity')
	const selected = peakForGlobalLeaf(leafCount, BigInt(globalLeafIndex))
	const peakSize = Number(1n << BigInt(selected.height))
	if (!Number.isSafeInteger(peakSize)) throw new Error('Carry proof peak cannot be represented by an in-memory JavaScript array')
	const peakStart = Number(selected.peakStartIndex)
	let indexWithinLevel = Number(selected.relativeLeafIndex)
	let level = hashes.slice(peakStart, peakStart + peakSize)
	const siblings: Hash[] = []
	for (let height = 0; height < selected.height; height += 1) {
		const sibling = level[indexWithinLevel ^ 1]
		if (sibling === undefined) throw new Error(`Carry proof sibling is missing at height ${height.toString()}`)
		siblings.push(sibling)
		const next: Hash[] = []
		for (let index = 0; index < level.length; index += 2) {
			const left = level[index]
			const right = level[index + 1]
			if (left === undefined || right === undefined) throw new Error('Carry proof peak contains an incomplete pair')
			next.push(hashCarryParent(left, right))
		}
		level = next
		indexWithinLevel = Math.floor(indexWithinLevel / 2)
	}

	let otherPeakStart = 0
	const otherPeaks = new Map<number, Hash>()
	for (let height = CARRY_MMR_MAXIMUM_PEAKS - 1; height >= 0; height -= 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n) continue
		const size = Number(1n << BigInt(height))
		if (!Number.isSafeInteger(size)) throw new Error('Carry proof peak cannot be represented by an in-memory JavaScript array')
		if (height !== selected.height) otherPeaks.set(height, merkleRoot(hashes.slice(otherPeakStart, otherPeakStart + size)))
		otherPeakStart += size
	}
	for (let height = 0; height < CARRY_MMR_MAXIMUM_PEAKS; height += 1) {
		if (((leafCount >> BigInt(height)) & 1n) === 0n || height === selected.height) continue
		const peak = otherPeaks.get(height)
		if (peak === undefined) throw new Error(`Other carry peak ${height.toString()} is missing`)
		siblings.push(peak)
	}
	return {
		leafIndex: selected.relativeLeafIndex.toString(),
		merkleMountainRangePeakIndex: selected.height.toString(),
		merkleMountainRangeSiblings: siblings,
	}
}

function buildZeroHashes() {
	const hashes: Hash[] = [zeroHash]
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const current = hashes[depth]
		if (current === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
		hashes.push(hashCarryParent(current, current))
	}
	return hashes
}

const NULLIFIER_ZERO_HASHES = buildZeroHashes()

export function nullifierPath(parentDepositIndex: string) {
	const value = unsignedInteger(parentDepositIndex, 'Nullifier parentDepositIndex')
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [value]))) & NULLIFIER_PATH_MASK
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

function sparseNullifierNodes(state: SparseNullifierState) {
	validateSparseNullifierState(state)
	const nodes = new Map<string, Hash>()
	for (const entry of state.consumed) {
		let nodeIndex = BigInt(entry.path)
		let nodeHash = NULLIFIER_CONSUMED_LEAF
		nodes.set(`0:${nodeIndex.toString()}`, nodeHash)
		for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
			const siblingIndex = nodeIndex ^ 1n
			const zero = NULLIFIER_ZERO_HASHES[depth]
			if (zero === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
			const siblingHash = nodes.get(`${depth.toString()}:${siblingIndex.toString()}`) ?? zero
			nodeHash = (nodeIndex & 1n) === 0n ? hashCarryParent(nodeHash, siblingHash) : hashCarryParent(siblingHash, nodeHash)
			nodeIndex >>= 1n
			nodes.set(`${(depth + 1).toString()}:${nodeIndex.toString()}`, nodeHash)
		}
	}
	return nodes
}

export function sparseNullifierRoot(state: SparseNullifierState) {
	const nodes = sparseNullifierNodes(state)
	const emptyRoot = NULLIFIER_ZERO_HASHES[CARRY_NULLIFIER_DEPTH]
	if (emptyRoot === undefined) throw new Error('Empty nullifier root is missing')
	return nodes.get(`${CARRY_NULLIFIER_DEPTH.toString()}:0`) ?? emptyRoot
}

export function createSparseNullifierProof(state: SparseNullifierState, parentDepositIndex: string) {
	const nodes = sparseNullifierNodes(state)
	let nodeIndex = nullifierPath(parentDepositIndex)
	const siblings: Hash[] = []
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const zero = NULLIFIER_ZERO_HASHES[depth]
		if (zero === undefined) throw new Error(`Nullifier zero hash ${depth.toString()} is missing`)
		siblings.push(nodes.get(`${depth.toString()}:${(nodeIndex ^ 1n).toString()}`) ?? zero)
		nodeIndex >>= 1n
	}
	return siblings
}

export function computeNullifierRootFromProof(parentDepositIndex: string, siblings: readonly Hash[], leafValue: Hash) {
	if (siblings.length !== CARRY_NULLIFIER_DEPTH) throw new Error(`Nullifier proof has ${siblings.length.toString()} siblings instead of ${CARRY_NULLIFIER_DEPTH.toString()}`)
	requireHash(leafValue, 'Nullifier leaf value')
	let path = nullifierPath(parentDepositIndex)
	let root = leafValue
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		const sibling = siblings[depth]
		if (sibling === undefined) throw new Error(`Nullifier sibling ${depth.toString()} is missing`)
		requireHash(sibling, `Nullifier sibling ${depth.toString()}`)
		root = (path & 1n) === 0n ? hashCarryParent(root, sibling) : hashCarryParent(sibling, root)
		path >>= 1n
	}
	return root
}
