import * as commonCopy from '../copy/common.js'
import type { ComponentChildren } from 'preact'
import { ActionLauncherButton } from './ActionLauncherButton.js'
import type { ReadinessAction } from '../types/components.js'

type ActionLauncherCardProps = {
	action: ReadinessAction
	children?: ComponentChildren
	pending?: boolean
	pendingLabel?: string
	tone?: 'primary' | 'secondary'
}

export function ActionLauncherCard({ action, children, pending = false, pendingLabel = commonCopy.opening, tone = 'secondary' }: ActionLauncherCardProps) {
	if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked') return undefined
	const disabled = action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined
	return (
		<section className={`action-launcher-card ${action.readiness}`}>
			<div className='action-launcher-card-copy'>
				<h4>{action.title}</h4>
				{action.description === undefined ? undefined : <p className='detail'>{action.description}</p>}
				{children}
			</div>
			<div className='action-launcher-card-actions'>
				<ActionLauncherButton
					{...(action.disabledReasonId === undefined ? {} : { describedBy: action.disabledReasonId })}
					idleLabel={action.actionLabel}
					pendingLabel={pendingLabel}
					onClick={() => action.onAction?.()}
					pending={pending}
					tone={tone}
					availability={{ disabled, reason: action.blocker }}
					showDisabledReason
				/>
			</div>
		</section>
	)
}
