import { registerTransactionReviewScope } from '../transactions/transactionReviewScope.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { TransactionStepsActions, TransactionStepsContent } from './TransactionStepsContent.js'
import * as commonCopy from '../copy/common.js'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { ReviewActionsSlotContext } from './reviewActionsSlot.js'
import { useModalFocusIsolation } from '../hooks/useModalFocusIsolation.js'
import type { OperationModalProps } from '../types/components.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { TransactionPresentationNotice } from './TransactionPresentationNotice.js'

function getTransactionOperationKey(transaction: ReturnType<typeof useGlobalTransactionPresentation>) {
	return transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash
}

function getModalTransactionPresentation(transaction: ReturnType<typeof useGlobalTransactionPresentation>, context: NonNullable<OperationModalProps['context']>) {
	if (transaction === undefined) return undefined
	// Keep every submitted value with the outcome, even when the initiating form no longer shows that value.
	const { technicalRows, ...compactTransaction } = transaction
	if (transaction.tone === 'error') return transaction
	if (transaction.tone === 'success') return compactTransaction
	if (transaction.rows === undefined) return compactTransaction
	const contextIdentityKeys = new Set(context.flatMap(item => (item.identityKey === undefined ? [] : [item.identityKey])))
	const contextLabels = new Set(context.flatMap(item => (typeof item.label === 'string' ? [item.label] : [])))
	return { ...compactTransaction, rows: transaction.rows.filter(row => (row.identityKey === undefined || !contextIdentityKeys.has(row.identityKey)) && !contextLabels.has(row.label)) }
}

export function OperationModal({ children, closeDisabled = false, closeOnSuccessKey, context = [], description, embedTransactionSteps = true, isOpen, onClose, title }: OperationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const bodyRef = useRef<HTMLDivElement | null>(null)
	const [reviewActionsSlot, setReviewActionsSlot] = useState<HTMLElement | null>(null)
	const [reviewScope, setReviewScope] = useState<AbortController>()
	useLayoutEffect(() => {
		if (!isOpen || !embedTransactionSteps) return
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
	const ownedWorkflow = ownsWorkflow ? workflow : undefined
	const activeStep = ownedWorkflow?.steps[ownedWorkflow.activeIndex]
	// A workflow made only of approvals was started by the form's own approve control, which already shows the amount and its pending state.
	const approvalOnly = ownedWorkflow !== undefined && activeStep !== undefined && ownedWorkflow.steps.every(step => step.spender !== undefined)
	const showSteps = activeStep !== undefined && !approvalOnly
	// Stable handlers keep the form's action group from re-claiming the slot on every render.
	const reviewActionsSlotHandlers = useMemo(() => ({ claim: (element: HTMLElement) => setReviewActionsSlot(element), release: () => setReviewActionsSlot(null) }), [])
	// With a claimed action row the rest of the form goes inert around it; without one the whole form does.
	useLayoutEffect(() => {
		const body = bodyRef.current
		if (!showSteps || reviewActionsSlot === null || body === null) return
		const marked: HTMLElement[] = []
		for (let node: HTMLElement | null = reviewActionsSlot; node !== null && node !== body; node = node.parentElement) {
			for (const sibling of Array.from(node.parentElement?.children ?? [])) {
				if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute('inert')) continue
				sibling.setAttribute('inert', '')
				marked.push(sibling)
			}
		}
		return () => {
			for (const element of marked) element.removeAttribute('inert')
		}
	}, [showSteps, reviewActionsSlot])
	useEffect(() => {
		if (ownedWorkflow === undefined || activeStep === undefined || !approvalOnly || activeStep.phase !== 'review') return
		ownedWorkflow.confirmStep(ownedWorkflow.activeIndex)
	}, [activeStep, approvalOnly, ownedWorkflow])
	// A step that fails after it was sent returns to the form on its own; the outcome notice below the form explains what happened.
	const activeTransactionTone = useGlobalTransactionPresentation()?.tone
	useEffect(() => {
		if (ownedWorkflow === undefined || activeStep === undefined || activeStep.phase === 'review' || activeStep.phase === 'upcoming') return
		if (activeStep.phase !== 'failed' && activeTransactionTone !== 'error') return
		ownedWorkflow.cancel()
	}, [activeStep, activeTransactionTone, ownedWorkflow])
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

	// The inline review takes focus itself when it appears; returning to the form hands focus back to the close control.
	useLayoutEffect(() => {
		if (!isOpen || showSteps || !dialogRef.current?.contains(document.activeElement)) return
		if (cannotClose) dialogRef.current.focus()
		else closeButtonRef.current?.focus()
	}, [showSteps])

	useModalFocusIsolation({
		dialogRef,
		initialFocusRef: closeButtonRef,
		isOpen,
		onClose: requestClose,
	})

	const showNotice = !(showSteps || !wasOpenRef.current || modalTransaction === undefined || activeTransactionOperationKey === undefined || activeTransactionOperationKey === transactionOperationKeyAtOpenRef.current)

	if (!isOpen) return undefined

	const returnToForm = () => {
		if (ownsWorkflow) workflow.cancel()
	}
	const reviewActionsSlotContext = showSteps
		? {
				...reviewActionsSlotHandlers,
				actions: (
					<GlobalTransactionPresentationProvider transaction={modalTransaction}>
						<TransactionStepsActions contextKey={titleId} focusOnMount keepActionsVisible onClose={returnToForm} />
					</GlobalTransactionPresentationProvider>
				),
			}
		: undefined

	return (
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
				{/* Only this region scrolls, so the title and close control stay pinned. */}
				<div className='operation-modal-scroll'>
					{description === undefined ? undefined : (
						<p id={descriptionId} className='detail'>
							{description}
						</p>
					)}
					<div className='operation-modal-body' inert={(showSteps && reviewActionsSlot === null) || undefined} ref={bodyRef}>
						<ReviewActionsSlotContext.Provider value={reviewActionsSlotContext}>{children}</ReviewActionsSlotContext.Provider>
						{showNotice ? <TransactionPresentationNotice className='operation-modal-transaction-notice' transaction={modalTransaction} /> : undefined}
					</div>
					{showSteps ? (
						<div className='operation-modal-steps'>
							{/* The dialog already shows its context rows above the form, so the step review only keeps the rows it does not cover. */}
							<GlobalTransactionPresentationProvider transaction={modalTransaction}>
								<TransactionStepsContent actions={reviewActionsSlot === null ? 'inline' : 'external'} contextKey={titleId} focusOnMount keepActionsVisible onClose={returnToForm} />
							</GlobalTransactionPresentationProvider>
						</div>
					) : undefined}
				</div>
			</section>
		</div>
	)
}
