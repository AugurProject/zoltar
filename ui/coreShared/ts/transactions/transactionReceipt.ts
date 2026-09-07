import type { Hash, ReplacementReason, TransactionReceipt } from '@zoltar/shared/ethereum'
import type { WriteClient } from './chainBackend.js'

export type SubmittedTransactionClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = {
	onTransactionSubmitted?: ((hash: Hash) => void) | undefined
	waitForTransactionReceipt: (...args: Parameters<WriteClient['waitForTransactionReceipt']>) => Promise<TReceipt>
}

export type SubmittedTransactionReceiptOptions = {
	allowRevertedReceipt?: boolean
	onKnownReceipt?: () => void
	onTransactionReplaced?: (hash: Hash, reason: ReplacementReason) => void
}

function replacementFailureMessage(reason: ReplacementReason) {
	if (reason === 'cancelled') return 'Transaction was cancelled in the wallet before confirmation.'
	return 'Transaction was replaced in the wallet before confirmation.'
}

export async function waitForSubmittedTransactionReceipt<TReceipt extends Pick<TransactionReceipt, 'status'>>(
	client: SubmittedTransactionClient<TReceipt>,
	hash: Hash,
	{ allowRevertedReceipt = false, onKnownReceipt, onTransactionReplaced }: SubmittedTransactionReceiptOptions = {},
): Promise<{ hash: Hash; receipt: TReceipt }> {
	let resolvedHash = hash
	let replacementReason: ReplacementReason | undefined
	const receipt = await client.waitForTransactionReceipt({
		hash,
		onReplaced: replacement => {
			resolvedHash = replacement.transaction.hash
			replacementReason = replacement.reason
			client.onTransactionSubmitted?.(resolvedHash)
			onTransactionReplaced?.(resolvedHash, replacement.reason)
		},
	})
	onKnownReceipt?.()
	if (replacementReason === 'cancelled' || replacementReason === 'replaced') throw new Error(replacementFailureMessage(replacementReason))
	if (!allowRevertedReceipt && receipt.status === 'reverted') throw new Error('Transaction reverted')
	return {
		hash: resolvedHash,
		receipt,
	}
}
