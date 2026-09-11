import { toChildArray, type ComponentChildren } from 'preact'

type HeaderMetricStripProps = {
	children: ComponentChildren
	expanded?: boolean
}

/** Strips with more metric columns than this cannot share one legible row with the address, so they wrap into rows instead. */
const SINGLE_ROW_METRIC_COLUMN_LIMIT = 4

/**
 * Header metric grid with a fixed slot per metric. The first child is the address cell and every
 * following child is one metric cell; the stylesheet builds explicit tracks from the metric count so
 * each cell keeps its place while values load, fail, or stay disconnected.
 */
export function HeaderMetricStrip({ children, expanded = false }: HeaderMetricStripProps) {
	const metricColumns = toChildArray(children).length - 1
	if (metricColumns < 1) throw new Error('Header metric strip needs the address cell followed by at least one metric cell')
	const classes = ['data-grid', 'overview-inline-metrics', metricColumns > SINGLE_ROW_METRIC_COLUMN_LIMIT ? 'is-dense' : '', expanded ? 'mobile-expanded' : ''].filter(Boolean).join(' ')
	return (
		<div className={classes} style={{ '--overview-metric-columns': metricColumns.toString() }}>
			{children}
		</div>
	)
}
