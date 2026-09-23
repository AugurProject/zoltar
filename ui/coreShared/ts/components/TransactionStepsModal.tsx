import { useEffect, useLayoutEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { OperationModal } from './OperationModal.js'
import { TransactionStepsContent } from './TransactionStepsContent.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { isEmbeddedTransactionReview } from '../transactions/transactionReviewScope.js'

export const embeddedTransactionSteps = signal<AbortSignal | undefined>(undefined)

export function TransactionStepsModal({ contextKey }: { contextKey: string }) {
	useEffect(() => () => transactionSteps.peek()?.cancel(), [contextKey])
	const presentation = useGlobalTransactionPresentation()
	const workflow = transactionSteps.value
	const embedded = workflow !== undefined && (isEmbeddedTransactionReview(workflow.reviewSignal) || (embeddedTransactionSteps.value !== undefined && workflow.reviewSignal === embeddedTransactionSteps.value))
	useEffect(() => {
		if (!embedded && presentation?.tone === 'success' && presentation.hash !== undefined && workflow?.steps.some(step => step.hash === presentation.hash)) workflow.finish()
	}, [embedded, presentation?.tone, presentation?.hash])
	useLayoutEffect(() => {
		if (workflow === undefined || embedded) return
		const active = workflow.steps[workflow.activeIndex]
		const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
		if (active?.phase === 'failed' || presentation?.tone === 'error' || completed) workflow.cancel()
	}, [workflow, embedded, presentation?.tone])
	if (workflow === undefined || workflow.reviewSignal?.aborted) return undefined
	if (embedded) return undefined
	const current = workflow.steps[workflow.activeIndex]
	if (current === undefined) return undefined
	const pending = presentation?.tone !== 'error' && workflow.steps.some(step => step.phase === 'pending' && step.error === undefined)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<OperationModal embedTransactionSteps={false} isOpen closeDisabled={pending} title={workflow.steps.at(-1)?.title ?? current.title} onClose={workflow.cancel}>
				<GlobalTransactionPresentationProvider transaction={presentation}>
					<TransactionStepsContent contextKey={contextKey} />
				</GlobalTransactionPresentationProvider>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}
