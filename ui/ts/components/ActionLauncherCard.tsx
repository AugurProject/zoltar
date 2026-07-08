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

export function ActionLauncherCard({ action, children, pending = false, pendingLabel = 'Opening...', tone = 'secondary' }: ActionLauncherCardProps) {
	if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked') return undefined
	return (
		<section className={`action-launcher-card ${action.readiness}`} data-action-safety-id={action.safetyId}>
			<div className='action-launcher-card-copy'>
				<h4>{action.title}</h4>
				<p className='detail'>{action.description}</p>
				{children}
			</div>
			<div className='action-launcher-card-actions'>
				<ActionLauncherButton safetyId={action.safetyId} idleLabel={action.actionLabel} pendingLabel={pendingLabel} onClick={() => action.onAction?.()} pending={pending} tone={tone} availability={{ disabled: action.onAction === undefined, reason: action.blocker }} showDisabledReason />
			</div>
		</section>
	)
}
