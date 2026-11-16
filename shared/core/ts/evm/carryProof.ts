import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from './ethereum.js'

export const CARRY_NULLIFIER_DEPTH = 64
const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
const NULLIFIER_CONSUMED_LEAF: Hex = '0x0000000000000000000000000000000000000000000000000000000000000001'
const NULLIFIER_PATH_ABI = parseAbiParameters('uint256 parentDepositIndex')
const CARRY_LEAF_ABI = parseAbiParameters('address depositor, uint8 outcome, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 cumulativeAmountAttoRep, uint256 sourceNodeId')

export type CarryLeaf = {
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	depositor: Address
	parentDepositIndex: bigint
	sourceNodeId: bigint
}

export function hashCarryLeaf(leaf: CarryLeaf, outcome: number): Hex {
	return keccak256(encodeAbiParameters(CARRY_LEAF_ABI, [leaf.depositor, outcome, leaf.amountAttoRep, leaf.parentDepositIndex, leaf.cumulativeAmountAttoRep, leaf.sourceNodeId]))
}

/** @internal Used by test oracles that verify carry proofs independently. */
export function hashCarryParent(left: Hex, right: Hex): Hex {
	return keccak256(concatHex([left, right]))
}

export function bagCarryPeaks(peaks: readonly Hex[]): Hex {
	if (peaks.length === 0) return ZERO_HASH
	let root = peaks[peaks.length - 1]
	if (root === undefined) throw new Error('Missing carry peak root')
	for (let index = peaks.length - 1; index > 0; index -= 1) {
		const previousPeak = peaks[index - 1]
		if (previousPeak === undefined) throw new Error('Missing carry peak root')
		root = hashCarryParent(previousPeak, root)
	}
	return root
}

export function buildCarryPeakHeights(leafCount: bigint) {
	const peakHeights: number[] = []
	let remainingLeafCount = leafCount
	let currentHeight = 0
	while (remainingLeafCount > 0n) {
		if ((remainingLeafCount & 1n) === 1n) peakHeights.unshift(currentHeight)
		remainingLeafCount >>= 1n
		currentHeight += 1
	}
	return peakHeights
}

function hashCarryLevel(levelHashes: readonly Hex[]) {
	const nextLevelHashes: Hex[] = []
	for (let index = 0; index < levelHashes.length; index += 2) {
		const left = levelHashes[index]
		const right = levelHashes[index + 1]
		if (left === undefined || right === undefined) throw new Error('Invalid carry Merkle Mountain Range level')
		nextLevelHashes.push(hashCarryParent(left, right))
	}
	return nextLevelHashes
}

/** Peak roots from left to right (descending height), with the global index of each peak's first leaf. */
export function buildCarryPeakRoots(leafHashes: readonly Hex[]) {
	const peaks: { height: number; leafOffset: number; root: Hex }[] = []
	let leafOffset = 0
	for (const height of buildCarryPeakHeights(BigInt(leafHashes.length))) {
		const peakSize = 2 ** height
		let levelHashes = leafHashes.slice(leafOffset, leafOffset + peakSize)
		while (levelHashes.length > 1) levelHashes = hashCarryLevel(levelHashes)
		const root = levelHashes[0]
		if (root === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
		peaks.push({ height, leafOffset, root })
		leafOffset += peakSize
	}
	return peaks
}

export function buildCarryMerkleMountainRangeProof(leafHashes: readonly Hex[], targetLeafIndex: number) {
	const peaks = buildCarryPeakRoots(leafHashes)
	const targetPeak = peaks.find(peak => targetLeafIndex >= peak.leafOffset && targetLeafIndex < peak.leafOffset + 2 ** peak.height)
	if (targetPeak === undefined) throw new Error('Target carry leaf is not inside the Merkle Mountain Range')

	let relativeLeafIndex = targetLeafIndex - targetPeak.leafOffset
	let levelHashes = leafHashes.slice(targetPeak.leafOffset, targetPeak.leafOffset + 2 ** targetPeak.height)
	const merkleMountainRangeSiblings: Hex[] = []
	while (levelHashes.length > 1) {
		const siblingHash = levelHashes[relativeLeafIndex ^ 1]
		if (siblingHash === undefined) throw new Error('Missing carry Merkle Mountain Range sibling')
		merkleMountainRangeSiblings.push(siblingHash)
		levelHashes = hashCarryLevel(levelHashes)
		relativeLeafIndex = Math.floor(relativeLeafIndex / 2)
	}
	const ascendingPeaks = [...peaks].reverse()
	for (const peak of ascendingPeaks) {
		if (peak.height !== targetPeak.height) merkleMountainRangeSiblings.push(peak.root)
	}
	const root = bagCarryPeaks(ascendingPeaks.map(peak => peak.root))
	// The verifier takes the global leaf position and derives the in-peak offset itself.
	return { leafIndex: BigInt(targetLeafIndex), merkleMountainRangePeakIndex: BigInt(targetPeak.height), merkleMountainRangeSiblings, root }
}

function buildZeroHashes() {
	const zeroHashes: Hex[] = [ZERO_HASH]
	let currentHash = ZERO_HASH
	for (let depth = 0; depth < CARRY_NULLIFIER_DEPTH; depth += 1) {
		currentHash = hashCarryParent(currentHash, currentHash)
		zeroHashes.push(currentHash)
	}
	return zeroHashes
}

export function createSparseNullifier(consumedParentDepositIndexes: readonly bigint[]) {
	const nodes = new Map<string, Hex>()
	const zeroHashes = buildZeroHashes()
	const getNode = (level: number, index: bigint) => nodes.get(`${level}:${index.toString()}`) ?? zeroHashes[level]

	const getProof = (parentDepositIndex: bigint) => {
		const siblings: Hex[] = []
		let index = getCarryNullifierPath(parentDepositIndex)
		for (let level = 0; level < CARRY_NULLIFIER_DEPTH; level += 1) {
			const siblingHash = getNode(level, index ^ 1n)
			if (siblingHash === undefined) throw new Error('Missing nullifier sibling hash')
			siblings.push(siblingHash)
			index >>= 1n
		}
		return siblings
	}

	const consume = (parentDepositIndex: bigint) => {
		let index = getCarryNullifierPath(parentDepositIndex)
		let currentHash = NULLIFIER_CONSUMED_LEAF
		for (let level = 0; level < CARRY_NULLIFIER_DEPTH; level += 1) {
			nodes.set(`${level}:${index.toString()}`, currentHash)
			const siblingHash = getNode(level, index ^ 1n)
			if (siblingHash === undefined) throw new Error('Missing nullifier sibling hash')
			currentHash = (index & 1n) === 0n ? hashCarryParent(currentHash, siblingHash) : hashCarryParent(siblingHash, currentHash)
			index >>= 1n
		}
		nodes.set(`${CARRY_NULLIFIER_DEPTH}:0`, currentHash)
	}

	const getRoot = () => {
		const fallbackRoot = zeroHashes[CARRY_NULLIFIER_DEPTH]
		if (fallbackRoot === undefined) throw new Error('Missing empty nullifier root')
		return nodes.get(`${CARRY_NULLIFIER_DEPTH}:0`) ?? fallbackRoot
	}

	for (const parentDepositIndex of consumedParentDepositIndexes) consume(parentDepositIndex)
	return { consume, getProof, getRoot }
}

/** The sparse nullifier slot: the low 64 bits of keccak256(abi.encode(parentDepositIndex)). */
export function getCarryNullifierPath(parentDepositIndex: bigint) {
	return BigInt.asUintN(CARRY_NULLIFIER_DEPTH, BigInt(keccak256(encodeAbiParameters(NULLIFIER_PATH_ABI, [parentDepositIndex]))))
}

export function computeCarryNullifierRootFromProof(parentDepositIndex: bigint, siblings: readonly Hex[], leafValue: Hex) {
	if (siblings.length !== CARRY_NULLIFIER_DEPTH) throw new Error(`Nullifier proof has ${siblings.length.toString()} siblings instead of ${CARRY_NULLIFIER_DEPTH.toString()}`)
	let path = getCarryNullifierPath(parentDepositIndex)
	let root = leafValue
	for (const sibling of siblings) {
		root = (path & 1n) === 0n ? hashCarryParent(root, sibling) : hashCarryParent(sibling, root)
		path >>= 1n
	}
	return root
}
