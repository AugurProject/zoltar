import { recordActivity, saveDurableState, type PendingTransactionIntent } from '../state/operator-state.ts'
import { observePendingTransaction, type PendingTransactionObservationInput } from '../state/pending-transaction-observation.ts'
import { TransactionAwaitingRecovery } from './receipt-validation.ts'
import type { ExecutionEnvironment } from './transaction-executor.ts'

export async function persist(environment: ExecutionEnvironment) {
	if (environment.persistState !== undefined) {
		await environment.persistState(environment.state)
		return
	}
	await saveDurableState(environment.settings.runtime.stateFile, environment.state)
}

/** Journals what this recovery pass learned so the dashboard can explain the wait instead of a bare status. */
export async function observeIntent(environment: ExecutionEnvironment, intent: PendingTransactionIntent, observation: PendingTransactionObservationInput) {
	observePendingTransaction(intent, observation)
	await persist(environment)
}

/** A finalized receipt whose confirmation evidence cannot be read yet stays pending; the journal records the inclusion so the wait is explained. */
export async function retainUnreadableReceiptEvidence(environment: ExecutionEnvironment, intent: PendingTransactionIntent, head: bigint, includedBlock: bigint, error: unknown) {
	intent.status = 'confirmation-unknown'
	delete intent.recoveryBlocker
	observePendingTransaction(intent, { head, includedBlock, kind: 'evidence-unavailable' })
	await persist(environment)
	return new TransactionAwaitingRecovery(intent.label, intent.hash, `confirmed receipt evidence is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`)
}

export async function retainClosedSubmissionWindow(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const blocker = 'Automatic resubmission window closed; verify a receipt, exact replacement, or nonce cancellation'
	if (intent.recoveryBlocker !== blocker) {
		intent.recoveryBlocker = blocker
		recordActivity(environment.state, {
			hash: intent.hash,
			message: `Automatic resubmission window closed; exact intent retained for receipt or replacement verification: ${intent.label}`,
			operationId: intent.operationId,
			status: 'pending',
			type: 'recovery',
		})
	}
	await persist(environment)
}

export function manualReconciliationBlocker(intent: PendingTransactionIntent, nonce: bigint) {
	return nonce > intent.nonce
		? `Signer nonce ${intent.nonce.toString()} was consumed without a quorum receipt; verify an exact replacement or nonce cancellation`
		: `Signer pending nonce moved backward to ${nonce.toString()}, below journaled nonce ${intent.nonce.toString()}; manual reconciliation is required before any resubmission`
}

export async function retainManualReconciliation(environment: ExecutionEnvironment, intent: PendingTransactionIntent, nonce: bigint): Promise<never> {
	const blocker = manualReconciliationBlocker(intent, nonce)
	intent.recoveryBlocker = blocker
	await persist(environment)
	throw new Error(`Transaction ${intent.hash}: ${blocker}`)
}
