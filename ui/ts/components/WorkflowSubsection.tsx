import type { ComponentChildren } from 'preact'

type WorkflowSubsectionProps = {
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	title?: ComponentChildren
}

export function WorkflowSubsection({ badge, children, className = '', title }: WorkflowSubsectionProps) {
	return (
		<div className={`entity-card-subsection ${className}`.trim()}>
			{title === undefined && badge === undefined ? undefined : (
				<div className='entity-card-subsection-header'>
					{title === undefined ? <span /> : <h4>{title}</h4>}
					{badge}
				</div>
			)}
			{children}
		</div>
	)
}
