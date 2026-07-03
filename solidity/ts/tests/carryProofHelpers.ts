import { concatHex, encodeAbiParameters, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { peripherals_EscalationGame_EscalationGame } from '../types/contractArtifact'

const NULLIFIER_DEPTH = 64
const NULLIFIER_PATH_MASK = (1n << BigInt(NULLIFIER_DEPTH)) - 1n

type EscalationGameNode = readonly [bigint, Address, bigint, bigint, bigint, bigint, bigint]

type CarryProofReadClient = {
	readContract(parameters: { abi: typeof peripherals_EscalationGame_EscalationGame.abi; address: Address; functionName: 'nodes'; args: [bigint] }): Promise<EscalationGameNode>
}

type CreateCarryProofParameters = {
	expectedOutcome?: bigint | number
	leafIndex: bigint
	merkleMountainRangePeakIndex: bigint
	merkleMountainRangeSiblings: readonly Hex[]
	nullifierSiblings: readonly Hex[]
	parentDepositIndex: bigint
	sourceNodeId?: bigint
}

const zeroHash = () => `0x${'0'.repeat(64)}` as Hex

const readCarryNode = async (client: CarryProofReadClient, escalationGameAddress: Address, nodeId: bigint) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'nodes',
		args: [nodeId],
	})

export const hashParent = (left: Hex, right: Hex) => keccak256(concatHex([left, right]))

export const hashCarryLeaf = (depositor: Address, outcome: bigint | number, amount: bigint, parentDepositIndex: bigint, cumulativeAmount: bigint, sourceNodeId: bigint) =>
	keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [depositor, BigInt(outcome), amount, parentDepositIndex, cumulativeAmount, sourceNodeId]))

const buildZeroHashes = () => {
	const zeroHashes: Hex[] = [zeroHash()]
	for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
		zeroHashes.push(hashParent(zeroHashes[depth], zeroHashes[depth]))
	}
	return zeroHashes
}

export class SparseNullifierTree {
	private readonly zeroHashes = buildZeroHashes()
	private readonly nodes = new Map<string, Hex>()
	private readonly pathMask = NULLIFIER_PATH_MASK
	root: Hex = this.zeroHashes[NULLIFIER_DEPTH]

	private getPath(parentDepositIndex: bigint) {
		return BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [parentDepositIndex]))) & this.pathMask
	}

	getProof(parentDepositIndex: bigint) {
		const path = this.getPath(parentDepositIndex)
		const siblings: Hex[] = []
		let nodeIndex = path
		for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
			const siblingIndex = nodeIndex ^ 1n
			const siblingHash = this.nodes.get(`${depth}:${siblingIndex}`) ?? this.zeroHashes[depth]
			siblings.push(siblingHash)
			nodeIndex >>= 1n
		}
		return siblings
	}

	consume(parentDepositIndex: bigint) {
		const path = this.getPath(parentDepositIndex)
		let nodeIndex = path
		let nodeHash = `0x${'0'.repeat(63)}1` as Hex
		this.nodes.set(`0:${nodeIndex}`, nodeHash)
		for (let depth = 0; depth < NULLIFIER_DEPTH; depth += 1) {
			const isRightNode = (nodeIndex & 1n) === 1n
			const siblingIndex = nodeIndex ^ 1n
			const siblingHash = this.nodes.get(`${depth}:${siblingIndex}`) ?? this.zeroHashes[depth]
			nodeHash = isRightNode ? hashParent(siblingHash, nodeHash) : hashParent(nodeHash, siblingHash)
			nodeIndex >>= 1n
			this.nodes.set(`${depth + 1}:${nodeIndex}`, nodeHash)
		}
		this.root = nodeHash
	}
}

export const readCarryLeafHash = async (client: CarryProofReadClient, escalationGameAddress: Address, nodeId: bigint) => {
	const node = await readCarryNode(client, escalationGameAddress, nodeId)
	return hashCarryLeaf(node[1], node[2], node[3], node[4], node[5], nodeId)
}

export const createCarryProof = async (client: CarryProofReadClient, escalationGameAddress: Address, parameters: CreateCarryProofParameters) => {
	const sourceNodeId = parameters.sourceNodeId ?? parameters.leafIndex + 1n
	const node = await readCarryNode(client, escalationGameAddress, sourceNodeId)
	if (node[4] !== parameters.parentDepositIndex) {
		throw new Error('Carry proof source node parent deposit index mismatch')
	}
	if (parameters.expectedOutcome !== undefined && node[2] !== BigInt(parameters.expectedOutcome)) {
		throw new Error('Carry proof source node outcome mismatch')
	}
	return {
		depositor: node[1],
		amount: node[3],
		parentDepositIndex: parameters.parentDepositIndex,
		cumulativeAmount: node[5],
		sourceNodeId,
		leafIndex: parameters.leafIndex,
		merkleMountainRangeSiblings: parameters.merkleMountainRangeSiblings,
		merkleMountainRangePeakIndex: parameters.merkleMountainRangePeakIndex,
		nullifierSiblings: parameters.nullifierSiblings,
	}
}
