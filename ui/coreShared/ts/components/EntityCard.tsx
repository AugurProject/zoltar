import type { ComponentChildren } from 'preact'

type EntityCardProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	/** `data-*` attributes rendered on the card root, for callers that key records by an identity such as a pool address. */
	dataAttributes?: Record<`data-${string}`, string>
	surface?: 'card' | 'flat'
	title: ComponentChildren
	variant?: 'compact' | 'record'
}

export function EntityCard({ actions, badge, children, className = '', dataAttributes, surface = 'card', title, variant = 'record' }: EntityCardProps) {
	return (
		<article {...dataAttributes} className={`entity-card record-card ${variant === 'compact' ? 'compact' : ''} ${surface === 'flat' ? 'flat' : ''} ${className}`.trim()}>
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
