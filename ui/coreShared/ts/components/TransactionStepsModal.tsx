import { useEffect } from 'preact/hooks'
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
	useEffect(() => {
		if (presentation?.tone === 'success' && presentation.hash !== undefined && workflow?.steps.some(step => step.hash === presentation.hash)) workflow.finish()
	}, [presentation?.tone, presentation?.hash])
	if (workflow === undefined || workflow.reviewSignal?.aborted) return undefined
	if (isEmbeddedTransactionReview(workflow.reviewSignal)) return undefined
	if (embeddedTransactionSteps.value !== undefined && workflow.reviewSignal === embeddedTransactionSteps.value) return undefined
	const current = workflow.steps[workflow.activeIndex]
	if (current === undefined) return undefined
	const pending = presentation?.tone !== 'error' && workflow.steps.some(step => step.phase === 'pending' && step.error === undefined)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<OperationModal embedTransactionSteps={false} isOpen closeDisabled={pending} title={workflow.steps.at(-1)?.title ?? current.title} onClose={workflow.cancel}>
				<GlobalTransactionPresentationProvider transaction={presentation}>
					<TransactionStepsContent contextKey={contextKey} onRetry={workflow.cancel} />
				</GlobalTransactionPresentationProvider>
			</OperationModal>
		</GlobalTransactionPresentationProvider>
	)
}
