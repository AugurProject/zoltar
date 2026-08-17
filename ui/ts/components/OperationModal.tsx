import * as commonCopy from '../copy/common.js'
import { useEffect, useId, useRef } from 'preact/hooks'
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

export function OperationModal({ children, closeDisabled = false, closeOnSuccessKey, context = [], description, isOpen, onClose, title }: OperationModalProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const activeTransaction = useGlobalTransactionPresentation()
	const activeTransactionOperationKey = getTransactionOperationKey(activeTransaction)
	const modalTransaction = getModalTransactionPresentation(activeTransaction, context)
	const titleId = useId()
	const descriptionElementId = useId()
	const descriptionId = description === undefined ? undefined : descriptionElementId
	const modalOperationKeysRef = useRef<Set<string>>(new Set())
	const transactionOperationKeyAtOpenRef = useRef<string | undefined>()
	const wasOpenRef = useRef(false)
	const requestClose = () => {
		if (!closeDisabled) onClose()
	}

	useEffect(() => {
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
		if (submittedActionSucceeded) onClose()
	}, [activeTransaction?.hash, activeTransaction?.tone, activeTransactionOperationKey, closeOnSuccessKey, isOpen, onClose])

	useModalFocusIsolation({
		dialogRef,
		initialFocusRef: closeButtonRef,
		isOpen,
		onClose: requestClose,
	})

	if (!isOpen) return undefined

	return (
		<div className='modal-backdrop' role='presentation' onClick={requestClose}>
			<section ref={dialogRef} className='modal-panel operation-modal-panel' role='dialog' tabIndex={-1} aria-busy={closeDisabled || undefined} aria-modal='true' aria-labelledby={titleId} aria-describedby={descriptionId} onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id={titleId}>{title}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={commonCopy.close} title={commonCopy.close} disabled={closeDisabled} onClick={requestClose}>
						×
					</button>
				</div>
				{description === undefined ? undefined : (
					<p id={descriptionId} className='detail'>
						{description}
					</p>
				)}
				<TransactionObjectContext items={context} />
				{!wasOpenRef.current || modalTransaction === undefined || activeTransactionOperationKey === undefined || activeTransactionOperationKey === transactionOperationKeyAtOpenRef.current ? undefined : <TransactionPresentationNotice className='operation-modal-transaction-notice' transaction={modalTransaction} />}
				<div className='operation-modal-body'>{children}</div>
			</section>
		</div>
	)
}
