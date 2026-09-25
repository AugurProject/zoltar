import * as commonCopy from '../copy/common.js'
import { createContext } from 'preact'
import { useContext, useId, useLayoutEffect, useRef } from 'preact/hooks'
import { ReviewActionsSlotContext } from './reviewActionsSlot.js'
import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { InlineHint } from './InlineHint.js'
import type { TransactionActionButtonProps } from '../types/components.js'
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { useWalletActionFix } from './WalletActionFix.js'

const TransactionActionGroupContext = createContext<{ noticeId: string; hasNotice: boolean } | undefined>(undefined)

const TransactionActionButtonLockContext = createContext(false)

function getInlineHintAriaLabel(ariaLabel: string | undefined, inlineHintAriaLabel: string | undefined, idleLabel: ComponentChildren) {
	if (inlineHintAriaLabel !== undefined) return inlineHintAriaLabel
	if (ariaLabel !== undefined) return commonCopy.formatActionDetailLabel(ariaLabel)
	if (typeof idleLabel === 'string' || typeof idleLabel === 'number') return commonCopy.formatActionDetailLabel(String(idleLabel))
	return undefined
}

export function TransactionActionButtonLockProvider({ children, locked }: { children: ComponentChildren; locked: boolean }) {
	return <TransactionActionButtonLockContext.Provider value={locked}>{children}</TransactionActionButtonLockContext.Provider>
}

export function TransactionActionGroup({ children, id, loading = false, message }: { children: ComponentChildren; id?: string | undefined; loading?: boolean; message: string | undefined }) {
	const generatedId = useId()
	const noticeId = id ?? generatedId
	const notice = message
	const reviewSlot = useContext(ReviewActionsSlotContext)
	const slotRef = useRef<HTMLDivElement>(null)
	const claimSlot = reviewSlot?.claim
	const releaseSlot = reviewSlot?.release
	useLayoutEffect(() => {
		if (claimSlot === undefined || releaseSlot === undefined || slotRef.current === null) return
		claimSlot(slotRef.current)
		return releaseSlot
	}, [claimSlot, releaseSlot])
	// While the dialog's transaction review is active it renders its own actions in this row instead of the form's.
	if (reviewSlot !== undefined)
		return (
			<div className='tx-action-group' data-review-actions-slot ref={slotRef}>
				{reviewSlot.actions}
			</div>
		)
	return (
		<TransactionActionGroupContext.Provider value={{ noticeId, hasNotice: notice !== undefined }}>
			<div className='tx-action-group'>
				<div className='tx-action-feedback' aria-live='polite' aria-atomic='true'>
					{notice === undefined ? undefined : <InlineHint id={noticeId} loading={loading} message={notice} />}
				</div>
				<div className='actions'>{children}</div>
			</div>
		</TransactionActionGroupContext.Provider>
	)
}

export function TransactionActionButton({ ariaLabel, availability, className = '', disabled = false, disabledReasonElementId, idleLabel, inlineHint, inlineHintAriaLabel, onClick, pending = false, pendingLabel, showDisabledReason = true, tone = 'primary', type = 'button' }: TransactionActionButtonProps) {
	const group = useContext(TransactionActionGroupContext)
	const disabledReasonId = useId()
	const globalTransaction = useGlobalTransactionPresentation()
	const globallyLocked = useContext(TransactionActionButtonLockContext)
	// While the transaction review waits for the user's confirmation nothing is in flight yet, so the button rests disabled instead of spinning.
	const awaitingReview = transactionSteps.value?.steps[transactionSteps.value.activeIndex]?.phase === 'review'
	const showPending = pending && !awaitingReview
	const blockedByPendingRequest = globallyLocked && !pending
	const isDisabled = disabled || pending || availability?.disabled === true || blockedByPendingRequest
	const disabledReason = isDisabled ? availability?.reason : undefined
	const actionButtonRef = useRef<HTMLButtonElement>(null)
	// A disconnected wallet or wrong network offers its connect or switch fix where the reason would be.
	const renderWalletFix = useWalletActionFix({ actionButtonRef, actionDisabled: isDisabled, availability })
	const walletFixId = renderWalletFix !== undefined && (group !== undefined || showDisabledReason) ? disabledReasonId : undefined
	const walletFix = walletFixId === undefined ? undefined : renderWalletFix?.(walletFixId)
	const shouldShowDisabledReason = showDisabledReason && isDisabled && disabledReason !== undefined
	const resolvedInlineHint = shouldShowDisabledReason ? disabledReason : inlineHint
	const resolvedInlineHintAriaLabel = getInlineHintAriaLabel(ariaLabel, inlineHintAriaLabel, idleLabel)
	const externalReasonId = isDisabled ? disabledReasonElementId : undefined
	const describedBy = (() => {
		if (group !== undefined) return [group.hasNotice ? group.noticeId : undefined, walletFixId].filter(id => id !== undefined).join(' ') || undefined
		const ids = [externalReasonId, resolvedInlineHint === undefined && walletFixId === undefined ? undefined : disabledReasonId].filter(id => id !== undefined)
		return ids.length === 0 ? undefined : ids.join(' ')
	})()
	const handleClick = () => {
		if (isDisabled) return
		onClick()
	}
	return (
		<div className={`tx-action ${className}`.trim()}>
			<div className='tx-action-row'>
				<button ref={actionButtonRef} aria-label={ariaLabel} aria-busy={showPending} className={`tx-action-button ${tone}`} type={type} onClick={handleClick} disabled={isDisabled} aria-describedby={describedBy}>
					<span className='tx-action-button-labels'>
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof idleLabel === 'string' ? idleLabel : undefined} />
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof pendingLabel === 'string' ? pendingLabel : undefined} />
						<span>{showPending ? <LoadingText announce={!isPendingGlobalTransactionPresentation(globalTransaction)}>{pendingLabel}</LoadingText> : idleLabel}</span>
					</span>
				</button>
			</div>
			{group === undefined && (showDisabledReason || resolvedInlineHint !== undefined) ? (
				<div className='tx-action-feedback'>
					{walletFix ?? (resolvedInlineHint === undefined ? undefined : <InlineHint {...(resolvedInlineHintAriaLabel === undefined ? {} : { ariaLabel: resolvedInlineHintAriaLabel })} id={disabledReasonId} loading={shouldShowDisabledReason && availability?.loading === true} message={resolvedInlineHint} />)}
				</div>
			) : undefined}
			{group !== undefined && walletFix !== undefined ? <div className='tx-action-feedback'>{walletFix}</div> : undefined}
		</div>
	)
}
