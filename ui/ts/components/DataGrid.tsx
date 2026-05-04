import type { DataGridProps } from '../types/components.js'

export function DataGrid({ children, className = '', columns = 'auto', dense = false }: DataGridProps) {
	const classes = ['data-grid', dense ? 'is-dense' : '', className].filter(Boolean).join(' ')
	return (
		<div className={classes} data-columns={columns}>
			{children}
		</div>
	)
}
