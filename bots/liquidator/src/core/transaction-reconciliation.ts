import { getAddress, parseTransaction, type Hex } from '@zoltar/bot-shared/ethereum'
import type { PendingTransactionIntent } from '#state/operator-state'

export type FinalizedReplacementEvidence = {
	blockHash: Hex
	blockNumber: bigint
	from: `0x${string}`
	hash: Hex
	nonce: bigint
	status: 'reverted' | 'success'
}

type ReconciliationEvidenceReaders = {
	canonicalBlockHash: (blockNumber: bigint) => Promise<Hex>
	currentHeads: () => Promise<readonly bigint[]>
	replacement: () => Promise<FinalizedReplacementEvidence | undefined>
}

function transactionHash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a transaction hash`)
	return value as Hex
}

export function parseTransactionReconciliation(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Transaction reconciliation request must be an object')
	return {
		intentHash: transactionHash(Reflect.get(value, 'intentHash'), 'intentHash'),
		replacementHash: transactionHash(Reflect.get(value, 'replacementHash'), 'replacementHash'),
	}
}

export function validateReconciliationIntentChain(serializedTransaction: Hex, chainId: number) {
	if (parseTransaction(serializedTransaction).chainId !== BigInt(chainId)) throw new Error('Pending transaction intent was signed for a different chain')
}

export function validateFinalizedReplacement(intent: Pick<PendingTransactionIntent, 'hash' | 'nonce' | 'sender'>, requestedHash: Hex, replacement: FinalizedReplacementEvidence) {
	if (replacement.hash.toLowerCase() === intent.hash.toLowerCase()) throw new Error('Use automatic receipt recovery for the original transaction hash')
	if (replacement.hash.toLowerCase() !== requestedHash.toLowerCase()) throw new Error('Replacement RPC returned another transaction')
	if (getAddress(replacement.from).toLowerCase() !== intent.sender.toLowerCase()) throw new Error('Replacement transaction was sent by another account')
	if (replacement.nonce !== intent.nonce) throw new Error('Replacement transaction did not consume the pending intent nonce')
}

export async function verifyFinalizedReplacement(intent: Pick<PendingTransactionIntent, 'hash' | 'nonce' | 'sender'>, requestedHash: Hex, finalityBlocks: bigint, readers: ReconciliationEvidenceReaders) {
	const replacement = await readers.replacement()
	if (replacement === undefined) throw new Error('Replacement transaction is not confirmed by the RPC quorum')
	validateFinalizedReplacement(intent, requestedHash, replacement)
	const finalityBlock = replacement.blockNumber + finalityBlocks
	const heads = await readers.currentHeads()
	if (heads.some(head => head < finalityBlock)) throw new Error('Replacement transaction has not reached the required canonical finality depth')
	const receiptBlockHash = await readers.canonicalBlockHash(replacement.blockNumber)
	if (receiptBlockHash.toLowerCase() !== replacement.blockHash.toLowerCase()) throw new Error('Replacement transaction receipt is no longer canonical')
	await readers.canonicalBlockHash(finalityBlock)
	return replacement
}
