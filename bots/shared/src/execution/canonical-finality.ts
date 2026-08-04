import type { Hex } from '../ethereum.ts'
import { quorumValue } from '../monitoring/read-quorum.ts'

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
		const heads = await Promise.all(readers.map(reader => reader.getBlockNumber()))
		if (heads.some(head => head < finalityBlockNumber)) return false
	} else if (knownMinimumHead < finalityBlockNumber) return false

	const canonicalReceiptBlockHash = quorumValue(
		`${label} receipt block`,
		await Promise.all(
			readers.map(async (reader, index) => {
				const block = await reader.getBlock({ blockNumber: receipt.blockNumber })
				if (block.hash == null) throw new Error(`${label} receipt block is missing its canonical hash`)
				return { endpoint: endpoints[index] ?? '', value: block.hash }
			}),
		),
	)
	if (canonicalReceiptBlockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`${label} receipt is no longer canonical`)

	const descendants = await Promise.allSettled(readers.map(reader => reader.getBlock({ blockNumber: finalityBlockNumber })))
	if (descendants.some(result => result.status === 'rejected' || result.value.hash == null)) return false
	quorumValue(
		`${label} finality descendant`,
		descendants.map((result, index) => {
			if (result.status === 'rejected' || result.value.hash == null) throw new Error(`${label} finality descendant is unavailable`)
			return { endpoint: endpoints[index] ?? '', value: result.value.hash }
		}),
	)
	return true
}
