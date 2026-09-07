import { concatHex, encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from '@zoltar/shared/ethereum'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getReportingOutcomeValue } from './helpers.js'

const NULLIFIER_DEPTH = 64
const CARRY_LEAF_ABI = parseAbiParameters('address depositor, uint8 outcome, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 cumulativeAmountAttoRep, uint256 sourceNodeId')

type CarryLeaf = {
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	depositor: Address
	parentDepositIndex: bigint
	sourceNodeId: bigint
}

export function hashCarryLeaf(leaf: CarryLeaf, outcome: ReportingOutcomeKey): Hex {
	return keccak256(encodeAbiParameters(CARRY_LEAF_ABI, [leaf.depositor, getReportingOutcomeValue(outcome), leaf.amountAttoRep, leaf.parentDepositIndex, leaf.cumulativeAmountAttoRep, leaf.sourceNodeId]))
}

function hashCarryParent(left: Hex, right: Hex): Hex {
	return keccak256(concatHex([left, right]))
}

export function bagCarryPeaks(peaks: readonly Hex[]): Hex {
	if (peaks.length === 0) return ('0x' + '00'.repeat(32)) as Hex
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

export function compareBigintAscending(left: bigint, right: bigint) {
	if (left < right) return -1
	if (left > right) return 1
	return 0
}

export function buildCarryMerkleMountainRangeProof(leafHashes: readonly Hex[], targetLeafIndex: number) {
	const peakHeights = buildCarryPeakHeights(BigInt(leafHashes.length))
	let offset = 0
	let targetPeakHeight: number | undefined
	let targetPeakLeaves: Hex[] | undefined
	let targetPeakOffset: number | undefined
	const peakRootsByHeight = new Map<number, Hex>()
	for (const peakHeight of peakHeights) {
		const peakSize = 1 << peakHeight
		const peakLeaves = leafHashes.slice(offset, offset + peakSize)
		let levelHashes = [...peakLeaves]
		while (levelHashes.length > 1) {
			const nextLevelHashes: Hex[] = []
			for (let index = 0; index < levelHashes.length; index += 2) {
				const left = levelHashes[index]
				const right = levelHashes[index + 1]
				if (left === undefined || right === undefined) throw new Error('Invalid carry Merkle Mountain Range level')
				nextLevelHashes.push(hashCarryParent(left, right))
			}
			levelHashes = nextLevelHashes
		}
		const peakRoot = levelHashes[0]
		if (peakRoot === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
		peakRootsByHeight.set(peakHeight, peakRoot)
		if (targetLeafIndex >= offset && targetLeafIndex < offset + peakSize) {
			targetPeakHeight = peakHeight
			targetPeakLeaves = peakLeaves
			targetPeakOffset = offset
		}
		offset += peakSize
	}
	if (targetPeakHeight === undefined || targetPeakLeaves === undefined || targetPeakOffset === undefined) throw new Error('Target carry leaf is not inside the Merkle Mountain Range')

	let relativeLeafIndex = targetLeafIndex - targetPeakOffset
	const peakRelativeLeafIndex = relativeLeafIndex
	let levelHashes = [...targetPeakLeaves]
	const merkleMountainRangeSiblings: Hex[] = []
	while (levelHashes.length > 1) {
		const siblingHash = levelHashes[relativeLeafIndex ^ 1]
		if (siblingHash === undefined) throw new Error('Missing carry Merkle Mountain Range sibling')
		merkleMountainRangeSiblings.push(siblingHash)
		const nextLevelHashes: Hex[] = []
		for (let index = 0; index < levelHashes.length; index += 2) {
			const left = levelHashes[index]
			const right = levelHashes[index + 1]
			if (left === undefined || right === undefined) throw new Error('Invalid carry Merkle Mountain Range level')
			nextLevelHashes.push(hashCarryParent(left, right))
		}
		levelHashes = nextLevelHashes
		relativeLeafIndex = Math.floor(relativeLeafIndex / 2)
	}
	const orderedPeakHeights = [...peakRootsByHeight.keys()].sort((left, right) => left - right)
	for (const peakHeight of orderedPeakHeights) {
		if (peakHeight === targetPeakHeight) continue
		const peakRoot = peakRootsByHeight.get(peakHeight)
		if (peakRoot === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
		merkleMountainRangeSiblings.push(peakRoot)
	}
	const root = bagCarryPeaks(
		orderedPeakHeights.map(peakHeight => {
			const peakRoot = peakRootsByHeight.get(peakHeight)
			if (peakRoot === undefined) throw new Error('Missing carry Merkle Mountain Range peak root')
			return peakRoot
		}),
	)
	return { merkleMountainRangePeakIndex: BigInt(targetPeakHeight), merkleMountainRangeSiblings, peakRelativeLeafIndex, root }
}

function buildZeroHashes() {
	const zeroHashes: Hex[] = [('0x' + '00'.repeat(32)) as Hex]
	let currentHash = ('0x' + '00'.repeat(32)) as Hex
	for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
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
		let index = getNullifierIndex(parentDepositIndex)
		for (let level = 0; level < NULLIFIER_DEPTH; level += 1) {
			const siblingHash = getNode(level, index ^ 1n)
			if (siblingHash === undefined) throw new Error('Missing nullifier sibling hash')
			siblings.push(siblingHash)
			index >>= 1n
		}
		return siblings
	}

	const consume = (parentDepositIndex: bigint) => {
		let index = getNullifierIndex(parentDepositIndex)
		let currentHash = ('0x' + '00'.repeat(31) + '01') as Hex
		for (let level = 0; level < NULLIFIER_DEPTH; level += 1) {
			nodes.set(`${level}:${index.toString()}`, currentHash)
			const siblingHash = getNode(level, index ^ 1n)
			if (siblingHash === undefined) throw new Error('Missing nullifier sibling hash')
			currentHash = (index & 1n) === 0n ? hashCarryParent(currentHash, siblingHash) : hashCarryParent(siblingHash, currentHash)
			index >>= 1n
		}
		nodes.set(`${NULLIFIER_DEPTH}:0`, currentHash)
	}

	const getRoot = () => {
		const fallbackRoot = zeroHashes[NULLIFIER_DEPTH]
		if (fallbackRoot === undefined) throw new Error('Missing empty nullifier root')
		return nodes.get(`${NULLIFIER_DEPTH}:0`) ?? fallbackRoot
	}

	for (const parentDepositIndex of consumedParentDepositIndexes) consume(parentDepositIndex)
	return { consume, getProof, getRoot }
}

function getNullifierIndex(parentDepositIndex: bigint) {
	return BigInt.asUintN(64, BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256 parentDepositIndex'), [parentDepositIndex]))))
}
