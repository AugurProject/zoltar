import { EXECUTOR_FINALITY_BLOCKS } from '../operations/timing.ts'
import type { PendingTransactionIntent } from '../state/operator-state.ts'

export const BOT_COMPATIBLE_RECOVERY_TRANSACTION_TYPE = 'eip1559'

export function transactionMatchesIntent(
	transaction: {
		from: string
		input: string
		nonce: bigint
		to?: string | null | undefined
		type?: string | undefined
		value: bigint
	},
	intent: Pick<PendingTransactionIntent, 'data' | 'nonce' | 'sender' | 'to' | 'value'>,
) {
	return (
		transaction.type === BOT_COMPATIBLE_RECOVERY_TRANSACTION_TYPE &&
		transaction.from.toLowerCase() === intent.sender.toLowerCase() &&
		transaction.nonce === intent.nonce &&
		transaction.to?.toLowerCase() === intent.to.toLowerCase() &&
		transaction.input.toLowerCase() === intent.data.toLowerCase() &&
		transaction.value === intent.value
	)
}

export function transactionIsStrictNonceCancellation(
	transaction: {
		from: string
		input: string
		nonce: bigint
		to?: string | null | undefined
		type?: string | undefined
		value: bigint
	},
	intent: Pick<PendingTransactionIntent, 'nonce' | 'sender'>,
) {
	return transaction.type === BOT_COMPATIBLE_RECOVERY_TRANSACTION_TYPE && transaction.from.toLowerCase() === intent.sender.toLowerCase() && transaction.nonce === intent.nonce && transaction.to?.toLowerCase() === intent.sender.toLowerCase() && transaction.input.toLowerCase() === '0x' && transaction.value === 0n
}

export function assertRecoverySubmissionMode(intentMode: PendingTransactionIntent['mode'], configuredMode: PendingTransactionIntent['mode']) {
	if (intentMode !== configuredMode) {
		throw new Error(`Pending ${intentMode} transaction recovery requires submission.mode to remain ${intentMode}`)
	}
}

export function pendingIntentRecoveryAction(intent: Pick<PendingTransactionIntent, 'maxBlockNumber' | 'mode' | 'nonce'>, pendingNonce: bigint, heads: readonly bigint[], finalityBlocks = EXECUTOR_FINALITY_BLOCKS, exactTransactionVisible = false, rpcQuorum = heads.length) {
	if (heads.length === 0) throw new Error('Pending intent recovery requires at least one canonical head')
	if (finalityBlocks < 1n) throw new Error('Pending intent recovery finality must be positive')
	if (!Number.isSafeInteger(rpcQuorum) || rpcQuorum < 1 || rpcQuorum > heads.length) {
		throw new Error('Pending intent recovery requires a valid RPC quorum')
	}
	if (pendingNonce < intent.nonce) return 'manual-reconciliation' as const
	if (exactTransactionVisible) return 'wait-known-pending' as const
	if (pendingNonce > intent.nonce) return 'manual-reconciliation' as const
	const descendingHeads = [...heads].sort((left, right) => {
		if (left === right) return 0
		return left > right ? -1 : 1
	})
	const sharedHead = descendingHeads[rpcQuorum - 1]
	if (sharedHead === undefined) {
		throw new Error('Pending intent recovery could not determine a shared head')
	}
	if (sharedHead >= intent.maxBlockNumber) {
		return 'submission-window-closed' as const
	}
	return 'resubmit-identical' as const
}
