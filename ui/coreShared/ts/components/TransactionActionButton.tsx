import * as commonCopy from '../copy/common.js'
import { createContext } from 'preact'
import { useContext, useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { InlineHint } from './InlineHint.js'
import type { TransactionActionButtonProps } from '../types/components.js'
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { transactionScopesOverlap, unscopedTransaction, type TransactionScope } from '../transactions/transactionScope.js'
import * as transactionStepsCopy from '../copy/transactionSteps.js'

const TransactionActionGroupContext = createContext<{ noticeId: string; hasNotice: boolean } | undefined>(undefined)

/** True inside a dialog form while its transaction review runs; the review then owns the only action row. */
export const TransactionReviewActiveContext = createContext(false)

/**
 * What running transactions lock: every action while a review or wallet prompt is open, otherwise only actions
 * whose scope overlaps a transaction that is still waiting for its receipt.
 */
export type TransactionActionLock = Readonly<{
	lockedScopes: readonly TransactionScope[]
	promptOpen: boolean
}>

export const unlockedTransactionActions: TransactionActionLock = { lockedScopes: [], promptOpen: false }

const TransactionActionButtonLockContext = createContext<TransactionActionLock>(unlockedTransactionActions)

const TransactionScopeContext = createContext<TransactionScope>(unscopedTransaction)

/** Names the object the enclosed transaction actions touch, so a pending transaction on it locks them. */
export function TransactionScopeProvider({ children, scope }: { children: ComponentChildren; scope: TransactionScope }) {
	return <TransactionScopeContext.Provider value={scope}>{children}</TransactionScopeContext.Provider>
}

function isTransactionActionLockedBy(lock: TransactionActionLock, scope: TransactionScope) {
	return lock.promptOpen || lock.lockedScopes.some(locked => transactionScopesOverlap(locked, scope))
}

function getInlineHintAriaLabel(ariaLabel: string | undefined, inlineHintAriaLabel: string | undefined, idleLabel: ComponentChildren) {
	if (inlineHintAriaLabel !== undefined) return inlineHintAriaLabel
	if (ariaLabel !== undefined) return commonCopy.formatActionDetailLabel(ariaLabel)
	if (typeof idleLabel === 'string' || typeof idleLabel === 'number') return commonCopy.formatActionDetailLabel(String(idleLabel))
	return undefined
}

export function TransactionActionButtonLockProvider({ children, lock }: { children: ComponentChildren; lock: TransactionActionLock }) {
	return <TransactionActionButtonLockContext.Provider value={lock}>{children}</TransactionActionButtonLockContext.Provider>
}

export function TransactionActionGroup({ children, id, loading = false, message }: { children: ComponentChildren; id?: string | undefined; loading?: boolean; message: string | undefined }) {
	const generatedId = useId()
	const noticeId = id ?? generatedId
	const notice = message
	const reviewActive = useContext(TransactionReviewActiveContext)
	return (
		<TransactionActionGroupContext.Provider value={{ noticeId, hasNotice: notice !== undefined }}>
			<div className='tx-action-group' hidden={reviewActive || undefined}>
				<div className='tx-action-feedback' aria-live='polite' aria-atomic='true'>
					{notice === undefined ? undefined : <InlineHint id={noticeId} loading={loading} message={notice} />}
				</div>
				<div className='actions'>{children}</div>
			</div>
		</TransactionActionGroupContext.Provider>
	)
}

export function TransactionActionButton({ ariaLabel, availability, className = '', disabled = false, disabledReasonElementId, idleLabel, inlineHint, inlineHintAriaLabel, onClick, pending = false, pendingLabel, scope, showDisabledReason = true, tone = 'primary', type = 'button' }: TransactionActionButtonProps) {
	const group = useContext(TransactionActionGroupContext)
	const disabledReasonId = useId()
	const globalTransaction = useGlobalTransactionPresentation()
	const lock = useContext(TransactionActionButtonLockContext)
	const inheritedScope = useContext(TransactionScopeContext)
	const actionScope = scope ?? inheritedScope
	// While the transaction review waits for the user's confirmation nothing is in flight yet, so the button rests disabled instead of spinning.
	const awaitingReview = transactionSteps.value?.steps[transactionSteps.value.activeIndex]?.phase === 'review'
	const showPending = pending && !awaitingReview
	// The initiating button keeps its own pending state; other actions on the same object wait for the transaction.
	const blockedByPendingRequest = !pending && isTransactionActionLockedBy(lock, actionScope)
	const blockedByScopedTransaction = blockedByPendingRequest && !lock.promptOpen && availability?.disabled !== true && !disabled
	const isDisabled = disabled || pending || availability?.disabled === true || blockedByPendingRequest
	let disabledReason = isDisabled ? availability?.reason : undefined
	if (blockedByScopedTransaction) disabledReason = transactionStepsCopy.transactionPending
	// A lock from another transaction always explains itself, even on launchers that otherwise hide empty reason slots.
	const shouldShowDisabledReason = (showDisabledReason || blockedByScopedTransaction) && isDisabled && disabledReason !== undefined
	const resolvedInlineHint = shouldShowDisabledReason ? disabledReason : inlineHint
	const resolvedInlineHintAriaLabel = getInlineHintAriaLabel(ariaLabel, inlineHintAriaLabel, idleLabel)
	const externalReasonId = isDisabled ? disabledReasonElementId : undefined
	const describedBy = (() => {
		if (group !== undefined) return group.hasNotice ? group.noticeId : undefined
		const ids = [externalReasonId, resolvedInlineHint === undefined ? undefined : disabledReasonId].filter(id => id !== undefined)
		return ids.length === 0 ? undefined : ids.join(' ')
	})()
	const handleClick = () => {
		if (isDisabled) return
		onClick()
	}
	return (
		<div className={`tx-action ${className}`.trim()}>
			<div className='tx-action-row'>
				<button aria-label={ariaLabel} aria-busy={showPending} className={`tx-action-button ${tone}`} type={type} onClick={handleClick} disabled={isDisabled} aria-describedby={describedBy}>
					<span className='tx-action-button-labels'>
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof idleLabel === 'string' ? idleLabel : undefined} />
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof pendingLabel === 'string' ? pendingLabel : undefined} />
						<span>{showPending ? <LoadingText announce={!isPendingGlobalTransactionPresentation(globalTransaction)}>{pendingLabel}</LoadingText> : idleLabel}</span>
					</span>
				</button>
			</div>
			{group === undefined && (showDisabledReason || resolvedInlineHint !== undefined) ? (
				<div className='tx-action-feedback'>
					{resolvedInlineHint === undefined ? undefined : <InlineHint {...(resolvedInlineHintAriaLabel === undefined ? {} : { ariaLabel: resolvedInlineHintAriaLabel })} id={disabledReasonId} loading={shouldShowDisabledReason && availability?.loading === true} message={resolvedInlineHint} />}
				</div>
			) : undefined}
		</div>
	)
}
