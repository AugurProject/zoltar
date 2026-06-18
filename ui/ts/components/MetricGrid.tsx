import { DataGrid } from './DataGrid.js'
import type { MetricGridProps } from '../types/components.js'

const metricGridVariantClassNames = {
	context: 'selected-pool-context-grid',
	default: 'workflow-metric-grid',
	question: 'question-summary-grid',
	summary: 'overview-summary-grid',
	vault: 'workflow-vault-grid',
} as const

export function MetricGrid({ children, className = '', columns = 'auto', dense = false, variant = 'default' }: MetricGridProps) {
	const classes = [metricGridVariantClassNames[variant], className].filter(Boolean).join(' ')

	return (
		<DataGrid className={classes} columns={columns} dense={dense}>
			{children}
		</DataGrid>
	)
}
