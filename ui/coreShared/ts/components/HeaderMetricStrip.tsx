import { toChildArray, type ComponentChildren } from 'preact'

type HeaderMetricStripProps = {
	children: ComponentChildren
	expanded?: boolean
}

type HeaderMetricGroupProps = {
	/** Optional control that acts on the whole group, such as a refresh button. */
	action?: ComponentChildren
	children: ComponentChildren
	label: string
	/** Secondary groups collapse behind the details toggle on narrow screens. */
	secondary?: boolean
}

/** Toolbar stat strip: labelled groups of inline metrics that share one row on wide screens. */
export function HeaderMetricStrip({ children, expanded = false }: HeaderMetricStripProps) {
	return <div className={`overview-inline-metrics${expanded ? ' mobile-expanded' : ''}`}>{children}</div>
}

/**
 * One captioned group of metrics on fixed equal tracks, so every metric keeps its place while
 * values load, fail, or stay disconnected. The track count is derived from the metric cells.
 */
export function HeaderMetricGroup({ action, children, label, secondary = false }: HeaderMetricGroupProps) {
	const metricColumns = toChildArray(children).length
	if (metricColumns < 1) throw new Error(`Header metric group ${label} needs at least one metric cell`)
	return (
		<div role='group' className={`overview-metric-group${secondary ? ' is-secondary' : ''}`} aria-label={label} style={{ '--overview-metric-columns': metricColumns.toString() }}>
			<span className='overview-metric-group-caption'>
				<span className='overview-metric-group-label' aria-hidden='true'>
					{label}
				</span>
				{action}
			</span>
			<div className='overview-metric-group-items'>{children}</div>
		</div>
	)
}
