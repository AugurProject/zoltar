import { createContext } from 'preact'
import { useContext, useId } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { LoadingAwareText, LoadingText } from './LoadingText.js'
import type { TransactionActionButtonProps } from '../types/components.js'

const TransactionActionButtonLockContext = createContext<string | undefined>(undefined)

export function TransactionActionButtonLockProvider({ children, disabledReason }: { children: ComponentChildren; disabledReason: string | undefined }) {
	return <TransactionActionButtonLockContext.Provider value={disabledReason}>{children}</TransactionActionButtonLockContext.Provider>
}

export function TransactionActionButton({ availability, className = '', disabled = false, idleLabel, onClick, pending = false, pendingLabel, showDisabledReason = true, tone = 'primary', type = 'button' }: TransactionActionButtonProps) {
	const disabledReasonId = useId()
	const globalDisabledReason = useContext(TransactionActionButtonLockContext)
	const blockedByPendingRequest = globalDisabledReason !== undefined && !pending
	const isDisabled = disabled || pending || availability?.disabled === true || blockedByPendingRequest
	const disabledReason = isDisabled ? (availability?.reason ?? (blockedByPendingRequest ? globalDisabledReason : undefined)) : undefined
	const shouldShowDisabledReason = showDisabledReason && isDisabled && disabledReason !== undefined
	const handleClick = () => {
		if (isDisabled) return
		onClick()
	}
	return (
		<div className={`tx-action ${className}`.trim()}>
			<button className={`tx-action-button ${tone}`} type={type} onClick={handleClick} disabled={isDisabled} title={disabledReason} aria-describedby={shouldShowDisabledReason ? disabledReasonId : undefined}>
				{pending ? <LoadingText>{pendingLabel}</LoadingText> : idleLabel}
			</button>
			{shouldShowDisabledReason ? (
				<p id={disabledReasonId} className='detail disabled-reason'>
					<LoadingAwareText>{disabledReason}</LoadingAwareText>
				</p>
			) : undefined}
		</div>
	)
}
