import type { ComponentChildren } from 'preact'
import { ActionLauncherButton } from './ActionLauncherButton.js'
import type { ReadinessAction } from '../types/components.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

type ActionLauncherCardProps = {
	action: ReadinessAction
	children?: ComponentChildren
	pending?: boolean
	pendingLabel?: string
	tone?: 'primary' | 'secondary'
}

export function ActionLauncherCard({ action, children, pending = false, pendingLabel = TSX_STRINGS.componentsActionLauncherCard.copy001, tone = 'secondary' }: ActionLauncherCardProps) {
	if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked') return undefined
	const disabled = action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined
	return (
		<section className={`action-launcher-card ${action.readiness}`} data-action-safety-id={action.safetyId}>
			<div className='action-launcher-card-copy'>
				<h4>{action.title}</h4>
				<p className='detail'>{action.description}</p>
				{children}
			</div>
			<div className='action-launcher-card-actions'>
				<ActionLauncherButton safetyId={action.safetyId} idleLabel={action.actionLabel} pendingLabel={pendingLabel} onClick={() => action.onAction?.()} pending={pending} tone={tone} availability={{ disabled, reason: action.blocker }} showDisabledReason />
			</div>
		</section>
	)
}
