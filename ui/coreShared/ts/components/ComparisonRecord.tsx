import type { ComponentChildren } from 'preact'

type ComparisonRecordMetric = {
	label: ComponentChildren
	value: ComponentChildren
}

type ComparisonRecordProps = {
	action?: ComponentChildren
	badge?: ComponentChildren
	children?: ComponentChildren
	metrics: ComparisonRecordMetric[]
	title: ComponentChildren
}

export function ComparisonRecord({ action, badge, children, metrics, title }: ComparisonRecordProps) {
	return (
		<article className='comparison-record record-card'>
			<header className='comparison-record-header'>
				<div className='comparison-record-identity'>
					<h3>{title}</h3>
					{badge === undefined ? undefined : <div className='comparison-record-badge'>{badge}</div>}
				</div>
				{action === undefined ? undefined : <div className='comparison-record-action'>{action}</div>}
			</header>
			<dl className='comparison-record-metrics'>
				{metrics.map((metric, index) => (
					<div key={`${index}`}>
						<dt>{metric.label}</dt>
						<dd>{metric.value}</dd>
					</div>
				))}
			</dl>
			{children === undefined ? undefined : <div className='comparison-record-details'>{children}</div>}
		</article>
	)
}
