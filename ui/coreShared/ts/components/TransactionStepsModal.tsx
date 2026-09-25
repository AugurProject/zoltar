import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { OperationModal } from './OperationModal.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { isEmbeddedTransactionReview } from '../transactions/transactionReviewScope.js'

/** Marks a review whose initiating surface renders the steps itself, such as the pool creation page. */
export const embeddedTransactionSteps = signal<AbortSignal | undefined>(undefined)

/**
 * Hosts the review of a transaction started outside any dialog. It is the same `OperationModal` review path a
 * dialog uses for its own transactions, so both surfaces share one review, focus trap, and close behavior.
 */
export function TransactionStepsModal({ contextKey }: { contextKey: string }) {
	useEffect(() => () => transactionSteps.peek()?.cancel(), [contextKey])
	const workflow = transactionSteps.value
	const embedded = workflow !== undefined && (isEmbeddedTransactionReview(workflow.reviewSignal) || (embeddedTransactionSteps.value !== undefined && workflow.reviewSignal === embeddedTransactionSteps.value))
	const completed = workflow?.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped') ?? false
	useEffect(() => {
		// A finished or failed review has nothing left to confirm; its outcome moves to the transaction status notice.
		if (workflow === undefined || embedded) return
		if (completed || workflow.steps[workflow.activeIndex]?.phase === 'failed') workflow.cancel()
	}, [workflow, embedded, completed])
	if (workflow === undefined || embedded || workflow.reviewSignal?.aborted) return undefined
	const current = workflow.steps[workflow.activeIndex]
	if (current === undefined) return undefined
	return <OperationModal hostsExternalReview isOpen title={workflow.steps.at(-1)?.title ?? current.title} onClose={workflow.cancel} />
}
