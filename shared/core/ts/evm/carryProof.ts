import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from './ethereum.js'

const ZERO_HASH: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'
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
	if (root === undefined) throw new Error('Missing deposit proof checkpoint')
	for (let index = peaks.length - 1; index > 0; index -= 1) {
		const previousPeak = peaks[index - 1]
		if (previousPeak === undefined) throw new Error('Missing deposit proof checkpoint')
		root = hashCarryParent(previousPeak, root)
	}
	return root
}

function buildCarryPeakHeights(leafCount: bigint) {
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
		if (left === undefined || right === undefined) throw new Error('Invalid deposit proof level')
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
		if (root === undefined) throw new Error('Missing deposit proof checkpoint')
		peaks.push({ height, leafOffset, root })
		leafOffset += peakSize
	}
	return peaks
}

export function buildCarryMerkleMountainRangeProof(leafHashes: readonly Hex[], targetLeafIndex: number) {
	const peaks = buildCarryPeakRoots(leafHashes)
	const targetPeak = peaks.find(peak => targetLeafIndex >= peak.leafOffset && targetLeafIndex < peak.leafOffset + 2 ** peak.height)
	if (targetPeak === undefined) throw new Error('The selected deposit is missing from the proof')

	let relativeLeafIndex = targetLeafIndex - targetPeak.leafOffset
	let levelHashes = leafHashes.slice(targetPeak.leafOffset, targetPeak.leafOffset + 2 ** targetPeak.height)
	const merkleMountainRangeSiblings: Hex[] = []
	while (levelHashes.length > 1) {
		const siblingHash = levelHashes[relativeLeafIndex ^ 1]
		if (siblingHash === undefined) throw new Error('Missing deposit proof entry')
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
