import type { Hex } from '../ethereum.ts'
import { availableSettledValues, quorumValue, settledQuorumValue } from '../monitoring/read-quorum.ts'
import { ConnectivityDegradedError } from '../monitoring/resilience.ts'
import { rpcQuorumRequirement, type RpcQuorumRequirement } from '../monitoring/rpc-quorum-policy.ts'

export type CanonicalBlockReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined; number?: bigint | null | undefined }>
	getBlockNumber: () => Promise<bigint>
	getFinalizedBlock?: (() => Promise<{ hash?: Hex | null | undefined; number?: bigint | null | undefined }>) | undefined
}

export type CanonicalReceiptFinalityPolicy =
	| { blockTag: 'finalized' }
	| {
			confirmationBlocks: bigint
			knownMinimumHead?: bigint | undefined
	  }

function confirmationPolicy(policy: CanonicalReceiptFinalityPolicy | bigint, knownMinimumHead?: bigint | undefined): CanonicalReceiptFinalityPolicy {
	return typeof policy === 'bigint' ? { confirmationBlocks: policy, knownMinimumHead } : policy
}

function canonicalBlockHash(block: Awaited<ReturnType<CanonicalBlockReader['getBlock']>>, expectedNumber: bigint, label: string) {
	if (block.number !== expectedNumber || block.hash == null) throw new Error(`${label} block ${expectedNumber.toString()} is missing its canonical identity`)
	return block.hash
}

async function confirmFinalizedCheckpointReceipt(readers: readonly CanonicalBlockReader[], endpoints: readonly string[], label: string, receipt: { blockHash: Hex; blockNumber: bigint }, requirement: RpcQuorumRequirement) {
	const settled = await Promise.allSettled(
		readers.map(async (reader, index) => {
			const endpoint = endpoints[index] ?? ''
			if (reader.getFinalizedBlock === undefined) throw new Error(`${label} reader does not support the finalized block tag`)
			const finalized = await reader.getFinalizedBlock()
			if (finalized.hash == null || finalized.number == null) throw new Error(`${label} finalized checkpoint is unavailable`)
			const [finalizedBlockBefore, receiptBlockBefore] = await Promise.all([reader.getBlock({ blockNumber: finalized.number }), finalized.number < receipt.blockNumber ? undefined : reader.getBlock({ blockNumber: receipt.blockNumber })])
			const finalizedHash = finalized.hash.toLowerCase()
			if (canonicalBlockHash(finalizedBlockBefore, finalized.number, `${label} finalized checkpoint`).toLowerCase() !== finalizedHash) {
				throw new Error(`${label} finalized checkpoint does not match its canonical block identity`)
			}
			const repeatedFinalized = await reader.getFinalizedBlock()
			if (repeatedFinalized.hash == null || repeatedFinalized.number == null) throw new Error(`${label} repeated finalized checkpoint is unavailable`)
			if (repeatedFinalized.number < finalized.number || (repeatedFinalized.number === finalized.number && repeatedFinalized.hash.toLowerCase() !== finalizedHash)) {
				throw new Error(`${label} finalized checkpoint changed during receipt verification`)
			}
			const [finalizedBlockAfter, repeatedFinalizedBlock, receiptBlockAfter] = await Promise.all([reader.getBlock({ blockNumber: finalized.number }), reader.getBlock({ blockNumber: repeatedFinalized.number }), finalized.number < receipt.blockNumber ? undefined : reader.getBlock({ blockNumber: receipt.blockNumber })])
			if (canonicalBlockHash(finalizedBlockAfter, finalized.number, `${label} finalized-checkpoint stability`).toLowerCase() !== finalizedHash) {
				throw new Error(`${label} finalized checkpoint changed during receipt verification`)
			}
			if (canonicalBlockHash(repeatedFinalizedBlock, repeatedFinalized.number, `${label} repeated finalized checkpoint`).toLowerCase() !== repeatedFinalized.hash.toLowerCase()) {
				throw new Error(`${label} repeated finalized checkpoint does not match its canonical block identity`)
			}
			let receiptBlockHash: Hex | undefined
			if (receiptBlockBefore !== undefined && receiptBlockAfter !== undefined) {
				const beforeHash = canonicalBlockHash(receiptBlockBefore, receipt.blockNumber, `${label} receipt ancestry`)
				const afterHash = canonicalBlockHash(receiptBlockAfter, receipt.blockNumber, `${label} repeated receipt ancestry`)
				if (afterHash.toLowerCase() !== beforeHash.toLowerCase()) throw new Error(`${label} receipt ancestry changed during finalized-checkpoint verification`)
				receiptBlockHash = afterHash
			}
			return {
				endpoint,
				value: {
					finalizedBlockHash: finalized.hash,
					finalizedBlockNumber: finalized.number,
					receiptBlockHash,
				},
			}
		}),
	)
	const observations = availableSettledValues(settled)
	if (observations.length < requirement) {
		throw new ConnectivityDegradedError(`${label} finalized checkpoint requires at least ${requirement === 1 ? 'one available RPC endpoint' : 'two available independent RPC endpoints'}`)
	}
	for (const [index, observation] of observations.entries()) {
		const conflictingCheckpoint = observations.slice(index + 1).find(candidate => candidate.value.finalizedBlockNumber === observation.value.finalizedBlockNumber && candidate.value.finalizedBlockHash.toLowerCase() !== observation.value.finalizedBlockHash.toLowerCase())
		if (conflictingCheckpoint !== undefined) {
			throw new Error(`RPC disagreement for ${label} finalized checkpoint at block ${observation.value.finalizedBlockNumber.toString()}: ${observation.endpoint} and ${conflictingCheckpoint.endpoint} returned different hashes`)
		}
	}
	const finalizedObservations = observations.flatMap(observation =>
		observation.value.finalizedBlockNumber >= receipt.blockNumber && observation.value.receiptBlockHash != null
			? [
					{
						endpoint: observation.endpoint,
						value: observation.value.receiptBlockHash,
					},
				]
			: [],
	)
	if (finalizedObservations.length < requirement) return false
	const receiptBlockHash = quorumValue(`${label} finalized receipt ancestry`, finalizedObservations, requirement)
	if (receiptBlockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`${label} receipt is no longer canonical`)
	return true
}

async function confirmDescendantReceipt(readers: readonly CanonicalBlockReader[], endpoints: readonly string[], label: string, receipt: { blockHash: Hex; blockNumber: bigint }, policy: Extract<CanonicalReceiptFinalityPolicy, { confirmationBlocks: bigint }>, requirement: RpcQuorumRequirement) {
	if (policy.confirmationBlocks < 1n) throw new Error(`${label} confirmation depth must be positive`)
	const finalityBlockNumber = receipt.blockNumber + policy.confirmationBlocks
	let capableReaders = readers.map((reader, index) => ({
		endpoint: endpoints[index] ?? '',
		reader,
	}))
	if (policy.knownMinimumHead === undefined) {
		const settledHeads = await Promise.allSettled(
			capableReaders.map(async candidate => ({
				...candidate,
				head: await candidate.reader.getBlockNumber(),
			})),
		)
		const heads = availableSettledValues(settledHeads)
		if (heads.length < requirement) throw new ConnectivityDegradedError(`${label} finality head requires at least ${requirement === 1 ? 'one available RPC endpoint' : 'two available independent RPC endpoints'}`)
		capableReaders = heads.filter(candidate => candidate.head >= finalityBlockNumber)
		if (capableReaders.length < requirement) return false
	} else if (policy.knownMinimumHead < finalityBlockNumber) return false

	const ancestry = await settledQuorumValue(
		`${label} finality ancestry`,
		capableReaders.map(async ({ endpoint, reader }) => {
			const descendant = await reader.getBlock({ blockNumber: finalityBlockNumber })
			if (descendant.hash == null) throw new Error(`${label} finality descendant is unavailable`)
			const receiptBlock = await reader.getBlock({ blockNumber: receipt.blockNumber })
			if (receiptBlock.hash == null) throw new Error(`${label} receipt block is missing its canonical hash`)
			return { endpoint, value: { descendantHash: descendant.hash, receiptBlockHash: receiptBlock.hash } }
		}),
		requirement,
	)
	if (ancestry.receiptBlockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`${label} receipt is no longer canonical`)
	return true
}

/**
 * Confirms a receipt against a quorum-agreed consensus-finalized checkpoint.
 * Numeric confirmation depth remains available for local chains and callers whose
 * network does not expose the standard `finalized` block tag.
 */
export async function confirmCanonicalReceiptFinality(
	readers: readonly CanonicalBlockReader[],
	endpoints: readonly string[],
	label: string,
	receipt: { blockHash: Hex; blockNumber: bigint },
	policy: CanonicalReceiptFinalityPolicy | bigint = { blockTag: 'finalized' },
	knownMinimumHead?: bigint | undefined,
	requirement = rpcQuorumRequirement(),
) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	if (readers.length < requirement) throw new Error(`${label} requires at least ${requirement === 1 ? 'one block reader' : 'two independent block readers'}`)
	const normalized = confirmationPolicy(policy, knownMinimumHead)
	return 'confirmationBlocks' in normalized ? confirmDescendantReceipt(readers, endpoints, label, receipt, normalized, requirement) : confirmFinalizedCheckpointReceipt(readers, endpoints, label, receipt, requirement)
}
