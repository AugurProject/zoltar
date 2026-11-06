import type { TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { recordActivity, resolveRecoveredIntentJournal, saveDurableState, type PendingTransactionIntent, type RuntimeState } from '#state/operator-state'
import { validateReceiptExpectation } from '#execution/receipt-validation'

// Persist removal and activity together before publishing the in-memory transition.
// A failed disk write leaves the original intent retryable.
export async function resolveFinalizedReceipt(path: string, state: RuntimeState, intent: PendingTransactionIntent, receipt: TransactionReceipt) {
	if (!state.pendingTransactions.some(pending => pending.hash.toLowerCase() === intent.hash.toLowerCase())) return
	const outcome = validateReceiptExpectation(receipt, intent.receiptExpectation, intent)
	const next = { ...state, activities: [...state.activities], pendingTransactions: [...state.pendingTransactions] }
	resolveRecoveredIntentJournal(next, intent.hash, receipt.status)
	recordActivity(next, {
		hash: intent.hash,
		kind: intent.kind,
		message: outcome.type === 'terminal-failure' ? `${intent.label} failed: ${outcome.reason}` : `${intent.label}: completed`,
		status: outcome.type === 'terminal-failure' ? 'failed' : 'confirmed',
	})
	await saveDurableState(path, next)
	state.activities = next.activities
	state.pendingTransactions = next.pendingTransactions
	if (outcome.type === 'terminal-failure') throw new Error(`${intent.label} failed: ${outcome.reason}`)
}
