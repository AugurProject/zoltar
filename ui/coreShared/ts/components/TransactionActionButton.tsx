import * as commonCopy from '../copy/common.js'
import { createContext } from 'preact'
import { useContext, useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import { InlineHint } from './InlineHint.js'
import type { TransactionActionButtonProps } from '../types/components.js'
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'

const TransactionActionButtonLockContext = createContext<string | undefined>(undefined)

function getInlineHintAriaLabel(ariaLabel: string | undefined, inlineHintAriaLabel: string | undefined, idleLabel: ComponentChildren) {
	if (inlineHintAriaLabel !== undefined) return inlineHintAriaLabel
	if (ariaLabel !== undefined) return commonCopy.formatActionDetailLabel(ariaLabel)
	if (typeof idleLabel === 'string' || typeof idleLabel === 'number') return commonCopy.formatActionDetailLabel(String(idleLabel))
	return undefined
}

export function TransactionActionButtonLockProvider({ children, disabledReason }: { children: ComponentChildren; disabledReason: string | undefined }) {
	return <TransactionActionButtonLockContext.Provider value={disabledReason}>{children}</TransactionActionButtonLockContext.Provider>
}

export function TransactionActionButton({ ariaLabel, availability, className = '', disabled = false, disabledReasonElementId, idleLabel, inlineHint, inlineHintAriaLabel, onClick, pending = false, pendingLabel, showDisabledReason = true, tone = 'primary', type = 'button' }: TransactionActionButtonProps) {
	const disabledReasonId = useId()
	const globalTransaction = useGlobalTransactionPresentation()
	const globalDisabledReason = useContext(TransactionActionButtonLockContext)
	const blockedByPendingRequest = globalDisabledReason !== undefined && !pending
	const isDisabled = disabled || pending || availability?.disabled === true || blockedByPendingRequest
	const disabledReason = isDisabled ? (availability?.reason ?? (blockedByPendingRequest ? globalDisabledReason : undefined)) : undefined
	const shouldShowDisabledReason = showDisabledReason && isDisabled && disabledReason !== undefined
	const resolvedInlineHint = shouldShowDisabledReason ? disabledReason : inlineHint
	const resolvedInlineHintAriaLabel = getInlineHintAriaLabel(ariaLabel, inlineHintAriaLabel, idleLabel)
	let describedBy: string | undefined
	if (resolvedInlineHint !== undefined) describedBy = disabledReasonId
	else if (isDisabled && disabledReason !== undefined) describedBy = disabledReasonElementId
	const handleClick = () => {
		if (isDisabled) return
		onClick()
	}
	return (
		<div className={`tx-action ${className}`.trim()}>
			<div className='tx-action-row'>
				<button aria-label={ariaLabel} aria-busy={pending} className={`tx-action-button ${tone}`} type={type} onClick={handleClick} disabled={isDisabled} title={disabledReason} aria-describedby={describedBy}>
					<span className='tx-action-button-labels'>
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof idleLabel === 'string' ? idleLabel : undefined} />
						<span aria-hidden='true' className='tx-action-label-placeholder' data-label={typeof pendingLabel === 'string' ? pendingLabel : undefined} />
						<span>{pending ? <LoadingText announce={!isPendingGlobalTransactionPresentation(globalTransaction)}>{pendingLabel}</LoadingText> : idleLabel}</span>
					</span>
				</button>
			</div>
			{showDisabledReason || resolvedInlineHint !== undefined ? (
				<div className='tx-action-feedback'>{resolvedInlineHint === undefined ? undefined : <InlineHint {...(resolvedInlineHintAriaLabel === undefined ? {} : { ariaLabel: resolvedInlineHintAriaLabel })} id={disabledReasonId} message={resolvedInlineHint} />}</div>
			) : undefined}
		</div>
	)
}
