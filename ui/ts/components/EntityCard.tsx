import type { ComponentChildren } from 'preact'

type EntityCardProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	surface?: 'card' | 'flat'
	title: ComponentChildren
	variant?: 'compact' | 'record'
}

export function EntityCard({ actions, badge, children, className = '', surface = 'card', title, variant = 'record' }: EntityCardProps) {
	return (
		<article className={`entity-card record-card ${variant === 'compact' ? 'compact' : ''} ${surface === 'flat' ? 'flat' : ''} ${className}`.trim()}>
			<div className='entity-card-header'>
				<div className='entity-card-copy'>
					<h3>{title}</h3>
				</div>
				{badge === undefined ? undefined : <div className='entity-card-badge'>{badge}</div>}
			</div>
			<div className='entity-card-body'>{children}</div>
			{actions === undefined ? undefined : <div className='entity-card-actions'>{actions}</div>}
		</article>
	)
}
