import { parseTransaction, type TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import type { PendingTransactionIntent } from '#state/operator-state'

/** Portfolio actions complete atomically; no deferred coordinator outcome exists. */
export function validateReceiptExpectation(receipt: TransactionReceipt, expectation: PendingTransactionIntent['receiptExpectation'], intent?: PendingTransactionIntent) {
	if (expectation.type !== 'transaction') throw new Error('Unsupported receipt expectation')
	if (intent !== undefined) {
		if (receipt.transactionHash.toLowerCase() !== intent.hash.toLowerCase()) throw new Error('Receipt transaction does not match signed intent')
		const transaction = parseTransaction(intent.serializedTransaction)
		if (!sameAddress(receipt.from, intent.sender) || transaction.to === undefined || receipt.to === undefined || receipt.to === null || !sameAddress(receipt.to, transaction.to)) throw new Error('Receipt sender or target does not match signed intent')
	}
	if (receipt.status === 'reverted') return { type: 'terminal-failure' as const, reason: `Transaction ${receipt.transactionHash} reverted` }
	return { type: 'terminal-success' as const }
}
