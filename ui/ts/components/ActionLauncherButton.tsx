import type { ComponentChildren } from 'preact'
import { LoadingText } from './LoadingText.js'
import type { ActionAvailability } from '../types/components.js'

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
	const isDisabled = disabled || pending || availability?.disabled === true
	const disabledReason = isDisabled ? availability?.reason : undefined
	return (
		<div className={`tx-action ${className}`.trim()}>
			<button aria-describedby={describedBy} className={`tx-action-button ${tone}`} type={type} onClick={onClick} disabled={isDisabled} title={disabledReason}>
				{pending ? <LoadingText>{pendingLabel}</LoadingText> : idleLabel}
			</button>
			{(() => {
				if (showDisabledReason && disabledReason === undefined) return undefined
				if (showDisabledReason && isDisabled) return <p className='detail disabled-reason'>{disabledReason}</p>

				return undefined
			})()}
		</div>
	)
}
