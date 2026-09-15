import type { ComponentChildren } from 'preact'

type EmptyStateProps = {
	actions?: ComponentChildren
	className?: string
	detail?: ComponentChildren
	live?: boolean
	title: ComponentChildren
}

export function EmptyState({ actions, className = '', detail, live = false, title }: EmptyStateProps) {
	return (
		<div className={`empty-state ${className}`.trim()} role={live ? 'status' : undefined}>
			<p className='empty-state-title'>{title}</p>
			{detail === undefined ? undefined : <p className='empty-state-detail'>{detail}</p>}
			{actions === undefined ? undefined : <div className='empty-state-actions'>{actions}</div>}
		</div>
	)
}
