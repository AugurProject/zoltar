export interface DataColumn<T> {
	readonly label: string
	readonly value: (row: T) => string
	readonly sort?: string
	readonly href?: (row: T) => string
}

const csvCell = (value: string): string => {
	const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value
	return `"${safe.replaceAll('"', '""')}"`
}

export const renderDataTable = <T>(container: HTMLElement, options: { readonly caption: string; readonly captionVisuallyHidden?: boolean; readonly rows: readonly T[]; readonly columns: readonly DataColumn<T>[]; readonly currentSort?: string; readonly onSort?: (sort: string) => void }): void => {
	const wrapper = document.createElement('div')
	wrapper.className = 'data-table-shell'
	const toolbar = document.createElement('div')
	toolbar.className = 'data-table-toolbar'
	const exportButton = document.createElement('button')
	exportButton.className = 'secondary compact'
	exportButton.type = 'button'
	exportButton.textContent = 'Export loaded rows CSV'
	exportButton.disabled = options.rows.length === 0
	exportButton.addEventListener('click', () => {
		const csv = [options.columns.map(column => csvCell(column.label)).join(','), ...options.rows.map(row => options.columns.map(column => csvCell(column.value(row))).join(','))].join('\r\n')
		const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
		const anchor = document.createElement('a')
		anchor.href = url
		anchor.download = `${options.caption.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
		anchor.click()
		window.setTimeout(() => URL.revokeObjectURL(url), 0)
	})
	toolbar.append(exportButton)
	const table = document.createElement('table')
	table.className = 'data-table'
	const caption = document.createElement('caption')
	caption.textContent = options.caption
	if (options.captionVisuallyHidden) caption.className = 'sr-only'
	table.append(caption)
	const thead = document.createElement('thead')
	const header = document.createElement('tr')
	for (const column of options.columns) {
		const cell = document.createElement('th')
		cell.scope = 'col'
		if (column.sort !== undefined && options.onSort !== undefined) {
			const button = document.createElement('button')
			button.type = 'button'
			button.textContent = `${column.label}${options.currentSort === column.sort ? ' ↓' : ''}`
			button.addEventListener('click', () => options.onSort?.(column.sort ?? ''))
			cell.setAttribute('aria-sort', options.currentSort === column.sort ? 'descending' : 'none')
			cell.append(button)
		} else cell.textContent = column.label
		header.append(cell)
	}
	thead.append(header)
	const tbody = document.createElement('tbody')
	for (const row of options.rows) {
		const tr = document.createElement('tr')
		for (const column of options.columns) {
			const cell = document.createElement('td')
			const value = column.value(row)
			if (column.href !== undefined) {
				const anchor = document.createElement('a')
				anchor.href = column.href(row)
				anchor.textContent = value
				cell.append(anchor)
			} else cell.textContent = value
			tr.append(cell)
		}
		tbody.append(tr)
	}
	table.append(thead, tbody)
	wrapper.append(toolbar, table)
	container.replaceChildren(wrapper)
}
