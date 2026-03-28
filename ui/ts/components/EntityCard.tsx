import type { ComponentChildren } from 'preact'

type EntityCardProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	title: ComponentChildren
}

export function EntityCard({ actions, badge, children, className = '', title }: EntityCardProps) {
	return (
		<article className={`entity-card ${ className }`}>
			<div className="entity-card-header">
				<div className="entity-card-copy">
					<h3>{title}</h3>
				</div>
				{badge === undefined ? undefined : <div className="entity-card-badge">{badge}</div>}
			</div>
			<div className="entity-card-body">{children}</div>
			{actions === undefined ? undefined : <div className="entity-card-actions">{actions}</div>}
		</article>
	)
}
