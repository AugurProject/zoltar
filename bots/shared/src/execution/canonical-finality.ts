import type { Hex } from '../ethereum.ts'
import { availableSettledValues, settledQuorumValue } from '../monitoring/read-quorum.ts'
import { ConnectivityDegradedError } from '../monitoring/resilience.ts'

export type CanonicalBlockReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined }>
	getBlockNumber: () => Promise<bigint>
}

export async function confirmCanonicalReceiptFinality(readers: readonly CanonicalBlockReader[], endpoints: readonly string[], label: string, receipt: { blockHash: Hex; blockNumber: bigint }, confirmationBlocks: bigint, knownMinimumHead?: bigint) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	if (readers.length < 2) throw new Error(`${label} requires at least two independent block readers`)
	if (confirmationBlocks < 1n) throw new Error(`${label} confirmation depth must be positive`)
	const finalityBlockNumber = receipt.blockNumber + confirmationBlocks
	if (knownMinimumHead === undefined) {
		const settledHeads = await Promise.allSettled(readers.map(reader => reader.getBlockNumber()))
		const heads = availableSettledValues(settledHeads)
		if (heads.length < 2) throw new ConnectivityDegradedError(`${label} finality head requires at least two available independent RPC endpoints`)
		if (heads.some(head => head < finalityBlockNumber)) return false
	} else if (knownMinimumHead < finalityBlockNumber) return false

	const ancestry = await settledQuorumValue(
		`${label} finality ancestry`,
		readers.map(async (reader, index) => {
			const descendant = await reader.getBlock({ blockNumber: finalityBlockNumber })
			if (descendant.hash == null) throw new Error(`${label} finality descendant is unavailable`)
			const receiptBlock = await reader.getBlock({ blockNumber: receipt.blockNumber })
			if (receiptBlock.hash == null) throw new Error(`${label} receipt block is missing its canonical hash`)
			return { endpoint: endpoints[index] ?? '', value: { descendantHash: descendant.hash, receiptBlockHash: receiptBlock.hash } }
		}),
	)
	if (ancestry.receiptBlockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`${label} receipt is no longer canonical`)
	return true
}
