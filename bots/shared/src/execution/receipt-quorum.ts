import type { Hex, TransactionReceipt } from '../ethereum.ts'
import { availableSettledValues, settledQuorumValue } from '../monitoring/read-quorum.ts'
import type { RpcQuorumRequirement } from '../monitoring/rpc-quorum-policy.ts'

type TransactionReceiptReader = {
	getTransactionReceipt: (parameters: { hash: Hex }) => Promise<TransactionReceipt>
}

/**
 * Recognizes a "receipt not found" lookup failure from viem (by error name) or from an RPC or
 * wrapper that only preserves the message, such as `Transaction receipt with hash ... could not be found`.
 */
export function isReceiptNotFound(error: unknown) {
	if (!(error instanceof Error)) return false
	if (error.name === 'TransactionReceiptNotFoundError') return true
	const message = error.message.toLowerCase()
	return message.includes('could not be found') || (message.includes('transaction receipt') && message.includes('not found'))
}

export async function readReceiptOrMissing(reader: TransactionReceiptReader, hash: Hex) {
	try {
		return await reader.getTransactionReceipt({ hash })
	} catch (error) {
		if (isReceiptNotFound(error)) return undefined
		throw error
	}
}

export function receiptEvidence(receipt: TransactionReceipt) {
	return {
		blockHash: receipt.blockHash,
		blockNumber: receipt.blockNumber,
		hash: receipt.transactionHash,
		logs: receipt.logs.map(log => ({
			address: log.address,
			data: log.data,
			topics: log.topics,
		})),
		status: receipt.status,
	}
}

type ReceiptQuorumReader = TransactionReceiptReader & {
	getBlockNumber: () => Promise<bigint>
}

export type ReceiptQuorumObservation = { status: 'found'; receipt: TransactionReceipt } | { status: 'missing' } | { status: 'pending' }

/** The head a reader had served before its receipt lookup; an unreadable head proves no lag. */
async function headBeforeLookup(reader: ReceiptQuorumReader) {
	return await reader.getBlockNumber().then(
		head => head,
		() => undefined,
	)
}

/**
 * Reads one receipt from every reader and requires the configured quorum to agree on its evidence.
 * A missing receipt is an observation of its own, so readers must agree that the receipt is missing too.
 * When every reader missing it had, before its lookup, a head below the receipt's block, the receipt is `pending`:
 * read it again once they catch up instead of treating propagation lag as a disagreement. The head is read first
 * because a reader can import the block between its lookup and a later head read.
 */
export async function observeReceiptWithQuorum(readers: readonly { client: ReceiptQuorumReader; endpoint: string }[], hash: Hex, requirement: RpcQuorumRequirement): Promise<ReceiptQuorumObservation> {
	const observations = readers.map(async ({ client, endpoint }) => {
		const head = await headBeforeLookup(client)
		const receipt = await readReceiptOrMissing(client, hash)
		return { head, endpoint, evidence: receipt === undefined ? undefined : receiptEvidence(receipt), receipt }
	})
	const settled = await Promise.allSettled(observations)
	const available = availableSettledValues(settled, { requirement, endpointOf: observation => observation.endpoint })
	const found = available.flatMap(observation => (observation.receipt === undefined ? [] : [observation.receipt]))
	const missing = available.filter(observation => observation.receipt === undefined)
	if (found.length !== 0 && missing.length !== 0) {
		const receiptBlock = found.reduce((highest, receipt) => (receipt.blockNumber > highest ? receipt.blockNumber : highest), 0n)
		if (missing.every(observation => observation.head !== undefined && observation.head < receiptBlock)) return { status: 'pending' }
	}
	const evidence = await settledQuorumValue(
		`receipt ${hash}`,
		observations.map(async observation => {
			const { endpoint, evidence: value } = await observation
			return { endpoint, value }
		}),
		requirement,
	)
	if (evidence === undefined) return { status: 'missing' }
	const receipt = found[0]
	if (receipt === undefined) throw new Error(`Receipt ${hash} quorum did not retain its matching transaction receipt`)
	return { status: 'found', receipt }
}
