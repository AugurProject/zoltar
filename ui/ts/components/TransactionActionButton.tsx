import { useId } from 'preact/hooks'
import { LoadingText } from './LoadingText.js'
import type { TransactionActionButtonProps } from '../types/components.js'
export function TransactionActionButton({ availability, className = '', disabled = false, idleLabel, onClick, pending = false, pendingLabel, safetyId, showDisabledReason = true, tone = 'primary', type = 'button' }: TransactionActionButtonProps) {
	const disabledReasonId = useId()
	const isDisabled = disabled || pending || availability?.disabled === true
	const disabledReason = isDisabled ? availability?.reason : undefined
	const shouldShowDisabledReason = showDisabledReason && isDisabled && disabledReason !== undefined
	return (
		<div className={`tx-action ${className}`.trim()}>
			<button className={`tx-action-button ${tone}`} data-action-safety-id={safetyId} type={type} onClick={onClick} disabled={isDisabled} title={disabledReason} aria-describedby={shouldShowDisabledReason ? disabledReasonId : undefined}>
				{pending ? <LoadingText>{pendingLabel}</LoadingText> : idleLabel}
			</button>
			{shouldShowDisabledReason ? (
				<p id={disabledReasonId} className='detail disabled-reason'>
					{disabledReason}
				</p>
			) : undefined}
		</div>
	)
}
