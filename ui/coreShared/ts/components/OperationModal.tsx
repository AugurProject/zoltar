import { registerTransactionReviewScope } from '../transactions/transactionReviewScope.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { TransactionStepsContent } from './TransactionStepsContent.js'
import * as commonCopy from '../copy/common.js'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useModalFocusIsolation } from '../hooks/useModalFocusIsolation.js'
import type { OperationModalProps } from '../types/components.js'
import { useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { TransactionPresentationNotice } from './TransactionPresentationNotice.js'
import { TransactionObjectContext } from './TransactionObjectContext.js'

function getTransactionOperationKey(transaction: ReturnType<typeof useGlobalTransactionPresentation>) {
	return transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash
}

function getModalTransactionPresentation(transaction: ReturnType<typeof useGlobalTransactionPresentation>, context: NonNullable<OperationModalProps['context']>) {
	if (transaction === undefined) return undefined
	const contextIdentityKeys = new Set(context.flatMap(item => (item.identityKey === undefined ? [] : [item.identityKey])))
	const contextLabels = new Set(context.flatMap(item => (typeof item.label === 'string' ? [item.label] : [])))
	const { technicalRows: _technicalRows, ...modalTransaction } = transaction
	if (transaction.rows === undefined) return modalTransaction
	return {
		...modalTransaction,
		rows: transaction.rows.filter(row => (row.identityKey === undefined || !contextIdentityKeys.has(row.identityKey)) && !contextLabels.has(row.label)),
	}
}

export function OperationModal({ children, closeDisabled = false, closeOnSuccessKey, context = [], description, embedTransactionSteps = true, isOpen, onClose, title }: OperationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const [dismissedOperationKey, setDismissedOperationKey] = useState<string>()
	const [reviewScope, setReviewScope] = useState<AbortController>()
	useLayoutEffect(() => {
		if (!isOpen || !embedTransactionSteps) return
		setDismissedOperationKey(undefined)
		const scope = new AbortController()
		const unregister = registerTransactionReviewScope(scope.signal)
		setReviewScope(scope)
		return () => {
			scope.abort()
			unregister()
		}
	}, [isOpen, embedTransactionSteps])
	const workflow = transactionSteps.value
	const ownsWorkflow = reviewScope !== undefined && !reviewScope.signal.aborted && workflow?.reviewSignal === reviewScope.signal
	const showSteps = ownsWorkflow && workflow?.steps[workflow.activeIndex] !== undefined
	const activeTransaction = useGlobalTransactionPresentation()
	const pending = ownsWorkflow && workflow.steps.some(step => step.phase === 'pending' && step.error === undefined) && activeTransaction?.tone !== 'error'
	const cannotClose = closeDisabled || pending
	const activeTransactionOperationKey = getTransactionOperationKey(activeTransaction)
	const modalTransaction = getModalTransactionPresentation(activeTransaction, context)
	const titleId = useId()
	const descriptionElementId = useId()
	const descriptionId = description === undefined ? undefined : descriptionElementId
	const modalOperationKeysRef = useRef<Set<string>>(new Set())
	const transactionOperationKeyAtOpenRef = useRef<string | undefined>()
	const wasOpenRef = useRef(false)
	const requestClose = () => {
		if (!cannotClose) {
			if (ownsWorkflow) workflow.cancel()
			onClose()
		}
	}

	useLayoutEffect(() => {
		if (!isOpen) {
			wasOpenRef.current = false
			modalOperationKeysRef.current = new Set()
			return
		}
		if (!wasOpenRef.current) {
			wasOpenRef.current = true
			modalOperationKeysRef.current = new Set()
			transactionOperationKeyAtOpenRef.current = activeTransactionOperationKey
			return
		}
		if (activeTransactionOperationKey !== undefined && activeTransactionOperationKey !== transactionOperationKeyAtOpenRef.current) {
			modalOperationKeysRef.current.add(activeTransactionOperationKey)
		}
		const submittedActionSucceeded = activeTransaction?.tone === 'success' && activeTransaction.hash !== undefined && activeTransaction.hash === closeOnSuccessKey && activeTransactionOperationKey !== undefined && modalOperationKeysRef.current.has(activeTransactionOperationKey)
		if (submittedActionSucceeded) {
			if (ownsWorkflow) workflow.cancel()
			onClose()
		} else if (ownsWorkflow && activeTransaction?.tone === 'success' && activeTransaction.hash !== undefined && workflow.steps.some(step => step.hash === activeTransaction.hash)) {
			// A standalone approval completed; keep the form for the actual action.
			workflow.cancel()
		}
	}, [activeTransaction?.hash, activeTransaction?.tone, activeTransactionOperationKey, closeOnSuccessKey, isOpen, onClose, ownsWorkflow, workflow?.cancel])

	useLayoutEffect(() => {
		if (!isOpen || !dialogRef.current?.contains(document.activeElement)) return
		if (cannotClose) dialogRef.current.focus()
		else closeButtonRef.current?.focus()
	}, [showSteps])

	useModalFocusIsolation({
		dialogRef,
		initialFocusRef: closeButtonRef,
		isOpen,
		onClose: requestClose,
	})

	if (!isOpen) return undefined

	const returnToForm = () => {
		setDismissedOperationKey(activeTransactionOperationKey)
		if (ownsWorkflow) workflow.cancel()
	}

	return (
		<>
			<div className='modal-backdrop' role='presentation' onClick={requestClose}>
				<section ref={dialogRef} className='modal-panel operation-modal-panel' role='dialog' tabIndex={-1} aria-busy={cannotClose || undefined} aria-modal='true' aria-labelledby={titleId} aria-describedby={descriptionId} onClick={event => event.stopPropagation()}>
					<div className='modal-header'>
						<div className='modal-header-title'>
							<h3 id={titleId}>{title}</h3>
						</div>
						<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={commonCopy.close} title={commonCopy.close} disabled={cannotClose} onClick={requestClose}>
							×
						</button>
					</div>
					{description === undefined ? undefined : (
						<p id={descriptionId} className='detail'>
							{description}
						</p>
					)}
					<TransactionObjectContext items={context} />
					{showSteps || !wasOpenRef.current || modalTransaction === undefined || activeTransactionOperationKey === undefined || activeTransactionOperationKey === transactionOperationKeyAtOpenRef.current || activeTransactionOperationKey === dismissedOperationKey ? undefined : (
						<TransactionPresentationNotice className='operation-modal-transaction-notice' transaction={modalTransaction} />
					)}
					<div className='operation-modal-body'>{children}</div>
				</section>
			</div>
			{showSteps ? (
				<OperationModal embedTransactionSteps={false} isOpen title={workflow.steps.at(-1)?.title ?? title} closeDisabled={pending} onClose={returnToForm}>
					<TransactionStepsContent contextKey={titleId} onClose={returnToForm} onBack={returnToForm} />
				</OperationModal>
			) : undefined}
		</>
	)
}
