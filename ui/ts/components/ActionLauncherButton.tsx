import type { ComponentChildren } from 'preact'
import { LoadingAwareText, LoadingText } from './LoadingText.js'
import type { ActionAvailability } from '../types/components.js'
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { useId } from 'preact/hooks'

type ActionLauncherButtonProps = {
	availability?: ActionAvailability
	className?: string
	describedBy?: string
	disabled?: boolean
	idleLabel: ComponentChildren
	onClick: () => void
	pending?: boolean
	pendingLabel: ComponentChildren
	showDisabledReason?: boolean
	tone?: 'primary' | 'secondary'
	type?: 'button' | 'submit'
}

export function ActionLauncherButton({ availability, className = '', describedBy, disabled = false, idleLabel, onClick, pending = false, pendingLabel, showDisabledReason = false, tone = 'primary', type = 'button' }: ActionLauncherButtonProps) {
	const disabledReasonId = useId()
	const globalTransaction = useGlobalTransactionPresentation()
	const isDisabled = disabled || pending || availability?.disabled === true
	const disabledReason = isDisabled ? availability?.reason : undefined
	const rendersDisabledReason = showDisabledReason && disabledReason !== undefined
	const descriptionIds = [describedBy, rendersDisabledReason ? disabledReasonId : undefined].filter(value => value !== undefined).join(' ') || undefined
	return (
		<div className={`tx-action ${className}`.trim()}>
			<button aria-describedby={descriptionIds} className={`tx-action-button ${tone}`} type={type} onClick={onClick} disabled={isDisabled} title={disabledReason}>
				{pending ? <LoadingText announce={!isPendingGlobalTransactionPresentation(globalTransaction)}>{pendingLabel}</LoadingText> : idleLabel}
			</button>
			{(() => {
				if (showDisabledReason && disabledReason === undefined) return undefined
				if (showDisabledReason && isDisabled)
					return (
						<p className='detail disabled-reason' id={disabledReasonId}>
							<LoadingAwareText>{disabledReason}</LoadingAwareText>
						</p>
					)

				return undefined
			})()}
		</div>
	)
}
