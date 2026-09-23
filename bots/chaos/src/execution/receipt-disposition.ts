import type { Hex } from '@zoltar/bot-shared/ethereum'
import type { DurableWorkflow, PendingTransactionIntent } from '../state/operator-state.ts'
import type { ExecutionEnvironment } from './execution-context.ts'
import { assertReceiptStillCanonical, retainIncludedTransaction } from './inclusion-journal.ts'
import { persist } from './recovery-journal.ts'
import { TransactionAwaitingRecovery } from './receipt-validation.ts'

export async function commitReceiptDisposition(environment: ExecutionEnvironment, intent: PendingTransactionIntent, workflow: DurableWorkflow, receipt: { blockHash: Hex; blockNumber: bigint; transactionHash: Hex }, apply: () => void) {
	await assertReceiptStillCanonical(environment, receipt)
	if (!environment.state.workflows.some(candidate => candidate.id === workflow.id)) throw new Error('Receipt disposition workflow is unavailable')
	const journal = structuredClone({ activities: environment.state.activities, pendingTransactions: environment.state.pendingTransactions, workflows: environment.state.workflows, includedTransactions: environment.state.includedTransactions })
	try {
		retainIncludedTransaction(environment.state, intent, receipt)
		apply()
	} catch (error) {
		Object.assign(environment.state, journal)
		throw error
	}
	try {
		await persist(environment)
	} catch (error) {
		Object.assign(environment.state, journal)
		let restorationError: unknown
		try {
			await persist(environment)
		} catch (failure) {
			restorationError = failure
		}
		const failure = error instanceof Error ? error.message : String(error)
		const restoration = restorationError === undefined ? '' : `; restoring the submitted journal also failed: ${String(restorationError)}`
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, `receipt disposition was not durably committed: ${failure}${restoration}`)
	}
}
