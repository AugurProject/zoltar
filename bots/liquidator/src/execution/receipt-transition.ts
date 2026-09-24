import type { TransactionReceipt } from '@zoltar/bot-shared/ethereum'
import { recordActivity, resolveRecoveredIntentJournal, saveDurableState, type PendingTransactionIntent, type RuntimeState } from '#state/operator-state'
import { requireRecoveredTransactionSuccess } from '#core/cycle-control'
import { validateReceiptExpectation } from '#execution/receipt-validation'

// Commit the replacement tracking and removal together. Publish in-memory state only
// after persistence succeeds, so a failed write remains retryable in this process.
export async function resolveFinalizedReceipt(path: string, state: RuntimeState, intent: PendingTransactionIntent, receipt: TransactionReceipt) {
	if (!state.pendingTransactions.some(pending => pending.hash.toLowerCase() === intent.hash.toLowerCase())) return
	const outcome = validateReceiptExpectation(receipt, intent.receiptExpectation, intent)
	const next = { ...state, activities: [...state.activities], pendingStagedOperations: [...state.pendingStagedOperations], pendingTransactions: [...state.pendingTransactions] }
	resolveRecoveredIntentJournal(next, intent.hash, receipt.status)
	if (outcome.type === 'queued') {
		const { identity, queuedOperationId } = outcome
		const existing = next.pendingStagedOperations.find(pending => pending.coordinator.toLowerCase() === identity.coordinator.toLowerCase() && pending.operationId === queuedOperationId)
		if (existing !== undefined) {
			if (existing.target.toLowerCase() !== identity.target.toLowerCase() || (existing.operation ?? 0) !== identity.operation || existing.queuedBlock !== receipt.blockNumber) throw new Error('Conflicting staged-operation journal identity')
		} else next.pendingStagedOperations.push({ coordinator: identity.coordinator, operation: identity.operation, operationId: queuedOperationId, queuedBlock: receipt.blockNumber, target: identity.target })
	}
	let message = `${intent.label}: completed`
	if (outcome.type === 'terminal-failure') message = `${intent.label} failed: ${outcome.reason}`
	if (outcome.type === 'queued') message = `${intent.label}: queued for settlement`
	const statuses = { 'terminal-failure': 'failed', queued: 'pending', 'terminal-success': 'confirmed' } as const
	recordActivity(next, {
		hash: intent.hash,
		kind: intent.kind,
		message,
		status: statuses[outcome.type],
	})
	await saveDurableState(path, next)
	state.activities = next.activities
	state.pendingStagedOperations = next.pendingStagedOperations
	state.pendingTransactions = next.pendingTransactions
	requireRecoveredTransactionSuccess(receipt.status, intent.hash)
	if (outcome.type === 'terminal-failure') throw new Error(`${intent.label} failed: ${outcome.reason}`)
}
