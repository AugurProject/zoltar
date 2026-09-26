import { useEffect, useId, useRef, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import * as transactionCopy from '../../copy/transaction.js'
import { TransactionPresentationNotice } from '../../components/TransactionPresentationNotice.js'
import { WarningSurface } from '../../components/WarningSurface.js'
import type { GlobalTransactionPresentation } from '../../types/components.js'
import { dismissGlobalTransaction, isGlobalTransactionDismissed } from '../../transactions/globalTransactionDismissal.js'
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
	const [dismissedRequest, setDismissedRequest] = useState<GlobalTransactionPresentation>()
	const lastSubmittedRef = useRef<GlobalTransactionPresentation>()
	const originRef = useRef({ hash: window.location.hash, routeKey, key: transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash })
	const titleId = useId()
	const outcome = transactionStepOutcome.value
	const transactionKey = transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash
	if (originRef.current.key !== transactionKey) originRef.current = { hash: window.location.hash, routeKey, key: transactionKey }
	if (transaction?.hash !== undefined) lastSubmittedRef.current = transaction
	const submitted = lastSubmittedRef.current
	const workflow = transactionSteps.value
	const activeStep = workflow?.steps.find(step => step.hash !== undefined && step.hash === transaction?.hash)
	const outcomePresentation: GlobalTransactionPresentation | undefined =
		outcome === undefined || transaction === undefined || submitted?.hash !== outcome.hash || (transaction.hash !== undefined && transaction.hash !== outcome.hash) || transaction.tone === 'success' || transaction.tone === 'error' || transaction.tone === 'warning'
			? undefined
			: {
					...(submitted?.hash === outcome.hash ? submitted : transaction),
					detail: outcome.detail,
					dismissKey: outcome.tone === 'error' ? `receipt-diagnostic:${outcome.hash}` : outcome.hash,
					hash: outcome.hash,
					title: outcome.title,
					tone: outcome.tone,
				}
	const current = outcomePresentation ?? (transaction?.tone === 'pending' && activeStep !== undefined ? { ...transaction, title: activeStep.title } : transaction)
	const hiddenAfterOutcome = outcome !== undefined && transaction?.tone === 'pending' && transaction.hash === outcome.hash && isGlobalTransactionDismissed({ dismissKey: outcome.tone === 'error' ? `receipt-diagnostic:${outcome.hash}` : outcome.hash, hash: outcome.hash, title: outcome.title, tone: outcome.tone })
	const reviewing = transactionSteps.value?.steps.some(step => step.phase === 'review') ?? false
	const terminal = current?.tone === 'success' || current?.tone === 'error' || current?.tone === 'warning'
	const compact = current?.tone === 'success' || current?.tone === 'pending' || current?.tone === 'error'
	const visible = current !== undefined && current !== dismissedRequest && current.tone !== 'awaiting-wallet' && current.tone !== 'preparing' && (!reviewing || outcomePresentation !== undefined || terminal) && !isGlobalTransactionDismissed(current) && !hiddenAfterOutcome
	const dismiss = () => {
		if (current?.hash === undefined && (current?.dismissKey ?? current?.operationKey)?.startsWith('transaction-request-')) setDismissedRequest(current)
		else dismissGlobalTransaction(current)
	}
	useEffect(() => {
		if (!visible || current?.tone !== 'error' || typeof requestAnimationFrame !== 'function') return
		const frame = requestAnimationFrame(() => {
			const panel = dialogRef.current?.getBoundingClientRect()
			if (panel === undefined) return
			const obstructed = Array.from(document.querySelectorAll<HTMLElement>('.tx-action-button, .existing-pool-action')).find(action => {
				const rect = action.getBoundingClientRect()
				return rect.width > 0 && rect.height > 0 && rect.bottom > panel.top && rect.top < panel.bottom && rect.right > panel.left && rect.left < panel.right
			})
			obstructed?.scrollIntoView({ block: 'center' })
		})
		return () => cancelAnimationFrame(frame)
	}, [current?.hash, current?.tone, visible])
	if (!visible || current === undefined) return undefined

	const transactionUniverseId = current.universeId
	let dismissLabel = transactionCopy.hide
	if (current.tone === 'success') dismissLabel = transactionCopy.closeSymbol
	else if (terminal) dismissLabel = transactionCopy.dismiss
	const returnHref = current.tone === 'error' && originRef.current.hash !== '' && window.location.hash !== originRef.current.hash ? originRef.current.hash : undefined
	const universeWarning =
		transactionUniverseId === undefined || activeUniverseId === undefined || transactionUniverseId === activeUniverseId ? undefined : (
			<WarningSurface className='global-transaction-universe-warning' surface='flat' variant='compact'>
				<strong>{appCopy.transactionUniverseMismatch}</strong>
				<p>{appCopy.formatTransactionUniverseMismatch(formatUniverseIdHex(transactionUniverseId), formatUniverseIdHex(activeUniverseId))}</p>
			</WarningSurface>
		)

	return (
		<div className='modal-backdrop global-transaction-dialog-backdrop global-transaction-dialog-nonblocking' role='presentation'>
			<section
				ref={dialogRef}
				className={`modal-panel global-transaction-dialog${compact ? ' global-transaction-dialog-compact' : ''}${current.tone === 'success' ? ' global-transaction-dialog-success' : ''}${current.tone === 'error' ? ' global-transaction-dialog-error' : ''}`}
				role={terminal ? 'dialog' : 'status'}
				tabIndex={-1}
				aria-labelledby={titleId}
			>
				<h3 id={titleId} className='visually-hidden'>
					{transactionCopy.transactionStatus}
				</h3>
				<TransactionPresentationNotice className='global-transaction-dialog-notice' collapseDetails compact={compact} contextWarning={universeWarning} transaction={current} />
				<div className='global-transaction-actions'>
					{returnHref === undefined ? undefined : <a href={returnHref}>{transactionCopy.backToForm}</a>}
					<button className={`${terminal && current.tone !== 'success' ? 'primary' : 'secondary'} global-transaction-dismiss`} type='button' onClick={dismiss} aria-label={current.tone === 'success' ? transactionCopy.dismiss : undefined}>
						{dismissLabel}
					</button>
				</div>
			</section>
		</div>
	)
}
