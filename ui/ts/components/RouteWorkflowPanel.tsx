import type { RouteWorkflowPanelProps } from '../types/components.js'

export function RouteWorkflowPanel({ children, className = '', description, showHeader = true, title }: RouteWorkflowPanelProps) {
	return (
		<section className={['panel', 'market-panel', className].filter(Boolean).join(' ')}>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>{title}</h2>
						{description === undefined ? undefined : <p className='detail'>{description}</p>}
					</div>
				</div>
			) : undefined}
			<div className='workflow-stack route-workflow-stack'>{children}</div>
		</section>
	)
}
