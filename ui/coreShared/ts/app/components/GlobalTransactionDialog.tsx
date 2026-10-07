import { useEffect, useId, useRef, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import * as transactionCopy from '../../copy/transaction.js'
import { TransactionPresentationNotice } from '../../components/TransactionPresentationNotice.js'
import { WarningSurface } from '../../components/WarningSurface.js'
import type { GlobalTransactionPresentation } from '../../types/components.js'
import { dismissGlobalTransaction, isGlobalTransactionDismissed } from '../../transactions/globalTransactionDismissal.js'
import { transactionStepOutcome, transactionSteps } from '../../transactions/transactionSteps.js'
import { formatUniverseIdHex } from '../../lib/universeLabels.js'

type GlobalTransactionDialogProps = {
	activeUniverseId?: bigint | undefined
	routeKey?: string
	transaction: GlobalTransactionPresentation | undefined
}

export function GlobalTransactionDialog({ activeUniverseId, routeKey, transaction }: GlobalTransactionDialogProps) {
	const dialogRef = useRef<HTMLElement | null>(null)
	// Where keyboard focus came from before it entered the panel, so dismissing from the keyboard does not drop it to the page.
	const returnFocusRef = useRef<HTMLElement | null>(null)
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
	const compact = current?.tone === 'success' || current?.tone === 'pending' || current?.tone === 'error' || current?.tone === 'awaiting-wallet'
	// The wallet prompt is shown too, so the user reads that the wallet waits for them; the browser simulation needs no confirmation and stays quiet.
	const visible = current !== undefined && current.showStatusDialog !== false && current !== dismissedRequest && current.tone !== 'preparing' && (!reviewing || outcomePresentation !== undefined || terminal) && !isGlobalTransactionDismissed(current) && !hiddenAfterOutcome
	const dismiss = () => {
		const focusInside = dialogRef.current?.contains(document.activeElement) === true
		if (current?.hash === undefined && (current?.dismissKey ?? current?.operationKey)?.startsWith('transaction-request-')) setDismissedRequest(current)
		else dismissGlobalTransaction(current)
		if (!focusInside) return
		const returnFocus = returnFocusRef.current?.isConnected === true ? returnFocusRef.current : document.getElementById('app-content')
		returnFocus?.focus()
	}
	useEffect(() => {
		if (!visible || typeof requestAnimationFrame !== 'function') return
		// The measured height is reserved below the page content and as scroll padding, so the page can scroll every control above the panel.
		const reserveSpace = () => {
			const panel = dialogRef.current?.getBoundingClientRect()
			if (panel === undefined || panel.height === 0) return undefined
			document.documentElement.style.setProperty('--transaction-status-inset', `${window.innerHeight - panel.top}px`)
			return panel
		}
		// Only the action the user just used is brought above the panel, and only if the panel covers it; the page never jumps to unrelated buttons.
		const revealFocusedAction = () => {
			const panel = reserveSpace()
			if (panel === undefined) return
			const actions = document.querySelector<HTMLElement>('.operation-modal-panel .transaction-step-actions')
			if (actions !== null) {
				actions.scrollIntoView({ block: 'end' })
				return
			}
			const focused = document.activeElement
			if (!(focused instanceof HTMLElement) || !focused.matches('.tx-action-button, .existing-pool-action')) return
			const rect = focused.getBoundingClientRect()
			if (rect.bottom > panel.top && rect.top < panel.bottom) focused.scrollIntoView({ block: 'nearest' })
		}
		const frame = requestAnimationFrame(revealFocusedAction)
		const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reserveSpace)
		if (dialogRef.current !== null) observer?.observe(dialogRef.current)
		window.addEventListener('resize', reserveSpace)
		return () => {
			cancelAnimationFrame(frame)
			observer?.disconnect()
			window.removeEventListener('resize', reserveSpace)
			document.documentElement.style.removeProperty('--transaction-status-inset')
		}
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
			{/* A non-modal status region: the notice inside is its single live region, and Escape dismisses it while focus is inside. */}
			<section
				ref={dialogRef}
				className={`modal-panel global-transaction-dialog${compact ? ' global-transaction-dialog-compact' : ''}${current.tone === 'success' ? ' global-transaction-dialog-success' : ''}${current.tone === 'error' ? ' global-transaction-dialog-error' : ''}`}
				aria-labelledby={titleId}
				onFocusIn={event => {
					if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) returnFocusRef.current = event.relatedTarget
				}}
				onKeyDown={event => {
					if (event.key !== 'Escape') return
					// An open dialog keeps Escape for itself; the status panel only takes it when no dialog is open.
					if (document.querySelector('.modal-backdrop:not(.global-transaction-dialog-nonblocking)') !== null) return
					event.stopPropagation()
					dismiss()
				}}
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
