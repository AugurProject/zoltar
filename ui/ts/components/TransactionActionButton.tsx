import { LoadingText } from './LoadingText.js'
import { TransactionActionStatus } from './TransactionActionStatus.js'
import type { TransactionActionButtonProps } from '../types/components.js'
export function TransactionActionButton({ availability, className = '', disabled = false, idleLabel, onClick, pending = false, pendingLabel, showDisabledReason = false, status, tone = 'primary', type = 'button' }: TransactionActionButtonProps) {
	const isDisabled = disabled || pending || availability?.disabled === true
	const disabledReason = isDisabled ? availability?.reason : undefined
	return (
		<div className={`tx-action ${className}`.trim()}>
			<button className={`tx-action-button ${tone}`} type={type} onClick={onClick} disabled={isDisabled} title={disabledReason}>
				{pending ? <LoadingText>{pendingLabel}</LoadingText> : idleLabel}
			</button>
			{(() => {
				if (showDisabledReason && disabledReason === undefined) return undefined
				if (showDisabledReason && isDisabled) {
					return <p className='detail disabled-reason'>{disabledReason}</p>
				}

				return undefined
			})()}
			{status === undefined ? undefined : <TransactionActionStatus status={status} />}
		</div>
	)
}
