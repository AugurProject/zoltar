import { toChildArray, type ComponentChildren } from 'preact'

type HeaderMetricStripProps = {
	children: ComponentChildren
	expanded?: boolean
}

/**
 * Toolbar stat strip with one fixed track per metric chip, so every chip keeps its place while
 * values load, fail, or stay disconnected. Each child is one metric cell.
 */
export function HeaderMetricStrip({ children, expanded = false }: HeaderMetricStripProps) {
	const metricColumns = toChildArray(children).length
	if (metricColumns < 1) throw new Error('Header metric strip needs at least one metric cell')
	return (
		<div className={`overview-inline-metrics${expanded ? ' mobile-expanded' : ''}`} style={{ '--overview-metric-columns': metricColumns.toString() }}>
			{children}
		</div>
	)
}
