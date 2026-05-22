import type { ComponentChildren } from 'preact'
import { TransactionActionButton } from './TransactionActionButton.js'
import type { ReadinessAction } from '../types/components.js'

type ActionLauncherCardProps = {
	action: ReadinessAction
	children?: ComponentChildren
	emphasizeReadiness?: boolean
	pending?: boolean
	pendingLabel?: string
	tone?: 'primary' | 'secondary'
}

export function ActionLauncherCard({ action, children, emphasizeReadiness = true, pending = false, pendingLabel = 'Opening...', tone = 'secondary' }: ActionLauncherCardProps) {
	return (
		<section className={`action-launcher-card ${emphasizeReadiness ? action.readiness : 'default'}`}>
			<div className='action-launcher-card-copy'>
				<h4>{action.title}</h4>
				<p className='detail'>{action.description}</p>
				{children}
			</div>
			<div className='action-launcher-card-actions'>
				<TransactionActionButton idleLabel={action.actionLabel} pendingLabel={pendingLabel} onClick={() => action.onAction?.()} pending={pending} tone={tone} availability={{ disabled: action.onAction === undefined || action.blocker !== undefined, reason: action.blocker }} />
			</div>
		</section>
	)
}
