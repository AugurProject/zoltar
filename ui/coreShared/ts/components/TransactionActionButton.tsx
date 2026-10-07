import { createContext } from 'preact'
import { useContext, useId, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { InlineHint } from './InlineHint.js'
import type { TransactionActionButtonProps } from '../types/components.js'
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { transactionScopesOverlap, unscopedTransaction, type TransactionScope } from '../transactions/transactionScope.js'
import * as transactionCopy from '../copy/transaction.js'
import * as transactionStepsCopy from '../copy/transactionSteps.js'
import { useWalletActionFix } from './WalletActionFix.js'

const TransactionActionGroupContext = createContext<{ noticeId: string; hasNotice: boolean } | undefined>(undefined)

/** Keeps the initiating form's controls in place and disabled while its transaction steps run. */
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

export function TransactionActionButtonLockProvider({ children, lock }: { children: ComponentChildren; lock: TransactionActionLock }) {
	return <TransactionActionButtonLockContext.Provider value={lock}>{children}</TransactionActionButtonLockContext.Provider>
}

export function TransactionActionGroup({ children, id, loading = false, message }: { children: ComponentChildren; id?: string | undefined; loading?: boolean; message: string | undefined }) {
	const generatedId = useId()
	const noticeId = id ?? generatedId
	const reviewActive = useContext(TransactionReviewActiveContext)
	const notice = reviewActive ? transactionStepsCopy.useTransactionButtons : message
	return (
		<TransactionActionGroupContext.Provider value={{ noticeId, hasNotice: notice !== undefined }}>
			<fieldset className='tx-action-group' disabled={reviewActive}>
				<div className='tx-action-feedback' aria-live='polite' aria-atomic='true'>
					{notice === undefined ? undefined : <InlineHint id={noticeId} loading={loading} message={notice} />}
				</div>
				<div className='actions'>{children}</div>
			</fieldset>
		</TransactionActionGroupContext.Provider>
	)
}

export function TransactionActionButton({
	actionButtonRef: sharedActionButtonRef,
	ariaLabel,
	availability,
	className = '',
	disabled = false,
	disabledReasonElementId,
	idleLabel,
	inlineHint,
	onClick,
	pending = false,
	pendingLabel,
	scope,
	showDisabledReason = true,
	tone = 'primary',
	type = 'button',
}: TransactionActionButtonProps) {
	const group = useContext(TransactionActionGroupContext)
	const reviewActive = useContext(TransactionReviewActiveContext)
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
	const isDisabled = reviewActive || disabled || pending || availability?.disabled === true || blockedByPendingRequest
	let disabledReason = isDisabled ? availability?.reason : undefined
	// A transaction still waiting for its receipt (possibly restored after a reload) locks this object; say so instead of
	// resting disabled without a reason. An open review or wallet prompt is transient and already in front of the user.
	if (disabledReason === undefined && blockedByPendingRequest && !lock.promptOpen) disabledReason = transactionCopy.waitingForPendingTransaction
	if (reviewActive) disabledReason = transactionStepsCopy.useTransactionButtons
	// Native disabling moves keyboard focus to the page, so a button that holds focus (such as the one whose transaction is
	// now pending) stays focusable and is only marked aria-disabled; the click guard below still blocks it.
	const [holdsFocus, setHoldsFocus] = useState(false)
	const focusableWhileDisabled = isDisabled && (pending || holdsFocus)
	const ownActionButtonRef = useRef<HTMLButtonElement>(null)
	const actionButtonRef = sharedActionButtonRef ?? ownActionButtonRef
	// A disconnected wallet or wrong network offers its connect or switch fix where the reason would be. Wallet blockers only exist on disabled availability, so they never coincide with a scoped transaction lock.
	const renderWalletFix = useWalletActionFix({ actionButtonRef, actionDisabled: isDisabled, availability })
	const walletFixId = renderWalletFix !== undefined && (group !== undefined || showDisabledReason) ? disabledReasonId : undefined
	const walletFix = walletFixId === undefined ? undefined : renderWalletFix?.(walletFixId)
	const shouldShowDisabledReason = showDisabledReason && isDisabled && disabledReason !== undefined
	const resolvedInlineHint = shouldShowDisabledReason ? disabledReason : inlineHint
	const externalReasonId = isDisabled ? disabledReasonElementId : undefined
	const describedBy = (() => {
		if (group !== undefined) return [group.hasNotice ? group.noticeId : undefined, walletFixId].filter(id => id !== undefined).join(' ') || undefined
		const ids = [externalReasonId, resolvedInlineHint === undefined && walletFixId === undefined ? undefined : disabledReasonId].filter(id => id !== undefined)
		return ids.length === 0 ? undefined : ids.join(' ')
	})()
	const handleClick = (event: MouseEvent) => {
		if (isDisabled) {
			// An aria-disabled submit button must not submit its form either.
			event.preventDefault()
			return
		}
		onClick()
	}
	return (
		<div className={`tx-action ${className}`.trim()}>
			<div className='tx-action-row'>
				<button
					ref={actionButtonRef}
					aria-label={ariaLabel}
					aria-busy={showPending}
					aria-disabled={focusableWhileDisabled ? 'true' : undefined}
					className={`tx-action-button ${tone}`}
					type={type}
					onClick={handleClick}
					onFocus={() => setHoldsFocus(true)}
					onBlur={() => setHoldsFocus(false)}
					disabled={isDisabled && !focusableWhileDisabled}
					aria-describedby={describedBy}
				>
					<span className='tx-action-button-labels'>
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof idleLabel === 'string' ? idleLabel : undefined} />
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof pendingLabel === 'string' ? pendingLabel : undefined} />
						<span>{showPending ? <LoadingText announce={!isPendingGlobalTransactionPresentation(globalTransaction)}>{pendingLabel}</LoadingText> : idleLabel}</span>
					</span>
				</button>
			</div>
			{group === undefined && (showDisabledReason || resolvedInlineHint !== undefined) ? (
				<div className='tx-action-feedback'>{walletFix ?? (resolvedInlineHint === undefined ? undefined : <InlineHint id={disabledReasonId} loading={shouldShowDisabledReason && availability?.loading === true} message={resolvedInlineHint} />)}</div>
			) : undefined}
			{group !== undefined && walletFix !== undefined ? <div className='tx-action-feedback'>{walletFix}</div> : undefined}
		</div>
	)
}
