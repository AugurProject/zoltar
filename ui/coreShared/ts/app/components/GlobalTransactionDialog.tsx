import { useId, useRef, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import * as transactionCopy from '../../copy/transaction.js'
import { TransactionPresentationNotice } from '../../components/TransactionPresentationNotice.js'
import { WarningSurface } from '../../components/WarningSurface.js'
import { useModalFocusIsolation } from '../../hooks/useModalFocusIsolation.js'
import type { GlobalTransactionPresentation } from '../../types/components.js'
import { dismissGlobalTransaction, inlineTransactionStatusHash, isGlobalTransactionDismissed } from '../../transactions/globalTransactionDismissal.js'
import { transactionStepOutcome, transactionSteps } from '../../transactions/transactionSteps.js'

function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

type GlobalTransactionDialogProps = {
	activeUniverseId?: bigint | undefined
	routeKey?: string
	transaction: GlobalTransactionPresentation | undefined
}

export function GlobalTransactionDialog({ activeUniverseId, routeKey, transaction }: GlobalTransactionDialogProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	const dismissRef = useRef<HTMLButtonElement | null>(null)
	const [dismissedRequest, setDismissedRequest] = useState<GlobalTransactionPresentation>()
	const lastSubmittedRef = useRef<GlobalTransactionPresentation>()
	const lastIntermediateHashRef = useRef<string>()
	const originRef = useRef({ hash: window.location.hash, routeKey, key: transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash })
	const titleId = useId()
	const outcome = transactionStepOutcome.value
	const transactionKey = transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash
	if (originRef.current.key !== transactionKey) originRef.current = { hash: window.location.hash, routeKey, key: transactionKey }
	if (transaction?.hash !== undefined) lastSubmittedRef.current = transaction
	const submitted = lastSubmittedRef.current
	const workflow = transactionSteps.value
	const activeStep = workflow?.steps.find(step => step.hash !== undefined && step.hash === transaction?.hash)
	const intermediateStep = activeStep !== undefined && activeStep !== workflow?.steps.at(-1)
	if (intermediateStep && transaction?.hash !== undefined) lastIntermediateHashRef.current = transaction.hash
	const intermediateTransaction = intermediateStep || (transaction?.hash !== undefined && lastIntermediateHashRef.current === transaction.hash)
	const outcomePresentation: GlobalTransactionPresentation | undefined =
		outcome === undefined || transaction === undefined || submitted?.hash !== outcome.hash || (transaction.hash !== undefined && transaction.hash !== outcome.hash) || transaction.tone === 'success' || transaction.tone === 'error' || transaction.tone === 'warning' || outcome.tone === 'success'
			? undefined
			: {
					...(submitted?.hash === outcome.hash ? submitted : transaction),
					detail: outcome.detail,
					dismissKey: `receipt-diagnostic:${outcome.hash}`,
					hash: outcome.hash,
					title: outcome.title,
					tone: outcome.tone,
				}
	const current = outcomePresentation ?? (transaction?.tone === 'pending' && activeStep !== undefined ? { ...transaction, title: activeStep.title } : transaction)
	const hiddenAfterOutcome = outcome !== undefined && transaction?.tone === 'pending' && transaction.hash === outcome.hash && isGlobalTransactionDismissed({ dismissKey: `receipt-diagnostic:${outcome.hash}`, hash: outcome.hash, title: outcome.title, tone: outcome.tone })
	const reviewing = transactionSteps.value?.steps.some(step => step.phase === 'review') ?? false
	const terminal = current?.tone === 'success' || current?.tone === 'error' || current?.tone === 'warning'
	const visible =
		current !== undefined &&
		current !== dismissedRequest &&
		current.tone !== 'awaiting-wallet' &&
		current.tone !== 'preparing' &&
		(!intermediateTransaction || current.tone === 'error' || current.tone === 'warning') &&
		(!reviewing || outcomePresentation !== undefined || terminal) &&
		(current.hash === undefined || current.hash !== inlineTransactionStatusHash.value || current.tone === 'error') &&
		!isGlobalTransactionDismissed(current) &&
		!hiddenAfterOutcome
	const dismiss = () => {
		if (current?.hash === undefined && (current?.dismissKey ?? current?.operationKey)?.startsWith('transaction-request-')) setDismissedRequest(current)
		else dismissGlobalTransaction(current)
	}
	const blocking = visible && current?.tone !== 'pending'
	useModalFocusIsolation({ dialogRef, initialFocusRef: dismissRef, isOpen: blocking, onClose: dismiss })
	if (!visible || current === undefined) return undefined

	const transactionUniverseId = current.universeId
	const returnHref = current.tone === 'error' && originRef.current.hash !== '' && window.location.hash !== originRef.current.hash ? originRef.current.hash : undefined
	const universeWarning =
		transactionUniverseId === undefined || activeUniverseId === undefined || transactionUniverseId === activeUniverseId ? undefined : (
			<WarningSurface className='global-transaction-universe-warning' surface='flat' variant='compact'>
				<strong>{appCopy.transactionUniverseMismatch}</strong>
				<p>{appCopy.formatTransactionUniverseMismatch(formatUniverseIdHex(transactionUniverseId), formatUniverseIdHex(activeUniverseId))}</p>
			</WarningSurface>
		)

	return (
		<div className={`modal-backdrop global-transaction-dialog-backdrop${blocking ? '' : ' global-transaction-dialog-nonblocking'}`} role='presentation'>
			<section ref={dialogRef} className='modal-panel global-transaction-dialog' role={blocking ? 'dialog' : 'status'} tabIndex={-1} aria-modal={blocking ? 'true' : undefined} aria-labelledby={titleId}>
				<h3 id={titleId} className='visually-hidden'>
					{transactionCopy.transactionStatus}
				</h3>
				<TransactionPresentationNotice className='global-transaction-dialog-notice' collapseDetails contextWarning={universeWarning} transaction={current} />
				<div className='global-transaction-actions'>
					{returnHref === undefined ? undefined : <a href={returnHref}>{transactionCopy.backToForm}</a>}
					<button ref={dismissRef} className={`${blocking ? 'primary' : 'secondary'} global-transaction-dismiss`} type='button' onClick={dismiss}>
						{blocking ? transactionCopy.dismiss : 'Hide'}
					</button>
				</div>
			</section>
		</div>
	)
}
