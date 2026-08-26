import type { Hex } from '../ethereum.ts'
import { availableSettledValues, settledQuorumValue } from '../monitoring/read-quorum.ts'
import { ConnectivityDegradedError } from '../monitoring/resilience.ts'
import { rpcQuorumRequirement } from '../monitoring/rpc-quorum-policy.ts'

export type CanonicalBlockReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined }>
	getBlockNumber: () => Promise<bigint>
}

export async function confirmCanonicalReceiptFinality(readers: readonly CanonicalBlockReader[], endpoints: readonly string[], label: string, receipt: { blockHash: Hex; blockNumber: bigint }, confirmationBlocks: bigint, knownMinimumHead?: bigint, requirement = rpcQuorumRequirement()) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	if (readers.length < requirement) throw new Error(`${label} requires at least ${requirement === 1 ? 'one block reader' : 'two independent block readers'}`)
	if (confirmationBlocks < 1n) throw new Error(`${label} confirmation depth must be positive`)
	const finalityBlockNumber = receipt.blockNumber + confirmationBlocks
	let capableReaders = readers.map((reader, index) => ({
		endpoint: endpoints[index] ?? '',
		reader,
	}))
	if (knownMinimumHead === undefined) {
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
	} else if (knownMinimumHead < finalityBlockNumber) return false

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
