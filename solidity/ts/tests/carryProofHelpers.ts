import { concatHex, encodeAbiParameters, keccak256, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_EscalationGame_EscalationGame } from '../types/contractArtifact'

type EscalationGameNode = readonly [bigint, Address, bigint, bigint, bigint, bigint, bigint]

type CarryProofReadClient = {
	readContract(parameters: { abi: typeof statoblast_EscalationGame_EscalationGame.abi; address: Address; functionName: 'nodes'; args: [bigint] }): Promise<EscalationGameNode>
}

type CreateCarryProofParameters = {
	expectedOutcome?: bigint | number
	leafIndex: bigint
	merkleMountainRangePeakIndex: bigint
	merkleMountainRangeSiblings: readonly Hex[]
	parentDepositIndex: bigint
	sourceNodeId?: bigint | undefined
}

const readCarryNode = async (client: CarryProofReadClient, escalationGameAddress: Address, nodeId: bigint) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		address: escalationGameAddress,
		functionName: 'nodes',
		args: [nodeId],
	})

export const hashParent = (left: Hex, right: Hex) => keccak256(concatHex([left, right]))

export const hashCarryLeaf = (depositor: Address, outcome: bigint | number, amountAttoRep: bigint, parentDepositIndex: bigint, cumulativeAmountAttoRep: bigint, sourceNodeId: bigint) =>
	keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [depositor, BigInt(outcome), amountAttoRep, parentDepositIndex, cumulativeAmountAttoRep, sourceNodeId]))

export const computeForkContinuationParentDepositIndex = (escalationGameAddress: Address, outcome: bigint | number, depositIndex: bigint) => (BigInt(escalationGameAddress) << 96n) | (BigInt(outcome) << 88n) | depositIndex

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
		amountAttoRep: node[3],
		parentDepositIndex: parameters.parentDepositIndex,
		cumulativeAmountAttoRep: node[5],
		sourceNodeId,
		leafIndex: parameters.leafIndex,
		merkleMountainRangeSiblings: parameters.merkleMountainRangeSiblings,
		merkleMountainRangePeakIndex: parameters.merkleMountainRangePeakIndex,
	}
}
