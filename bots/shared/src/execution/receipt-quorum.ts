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

/**
 * Reads one receipt from every reader and requires the configured quorum to agree on its evidence.
 * A missing receipt is an observation of its own, so readers must agree that the receipt is missing too.
 */
export async function observeReceiptWithQuorum(readers: readonly { client: TransactionReceiptReader; endpoint: string }[], hash: Hex, requirement: RpcQuorumRequirement) {
	const observations = readers.map(async ({ client, endpoint }) => {
		const receipt = await readReceiptOrMissing(client, hash)
		return { endpoint, evidence: receipt === undefined ? undefined : receiptEvidence(receipt), receipt }
	})
	const evidence = await settledQuorumValue(
		`receipt ${hash}`,
		observations.map(async observation => {
			const { endpoint, evidence: value } = await observation
			return { endpoint, value }
		}),
		requirement,
	)
	if (evidence === undefined) return undefined
	const receipt = availableSettledValues(await Promise.allSettled(observations)).find(observation => observation.receipt !== undefined)?.receipt
	if (receipt === undefined) throw new Error(`Receipt ${hash} quorum did not retain its matching transaction receipt`)
	return receipt
}
