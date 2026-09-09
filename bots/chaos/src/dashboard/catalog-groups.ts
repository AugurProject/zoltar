export function createCatalogGroups(container: HTMLElement, ecosystems: readonly string[], label: (value: string) => string) {
	const cached = new Map<string, HTMLDetailsElement>()
	return (rows: HTMLTableRowElement[]) => {
		const focused = document.activeElement
		const focusedOperation = focused instanceof HTMLButtonElement && focused.classList.contains('operation-open') ? focused.closest('tr')?.dataset['operationId'] : undefined
		const groups = ecosystems.flatMap(ecosystem => {
			const members = rows.filter(row => row.dataset['ecosystem'] === ecosystem)
			if (members.length === 0) return []
			const group = cached.get(ecosystem) ?? document.createElement('details')
			group.className = 'catalog-group'
			group.dataset['ecosystem'] = ecosystem
			cached.set(ecosystem, group)
			const summary = group.querySelector('summary') ?? document.createElement('summary')
			const name = document.createElement('strong')
			name.textContent = label(ecosystem)
			const count = document.createElement('span')
			count.className = 'muted'
			count.textContent = `${members.length.toString()} operations`
			summary.replaceChildren(name, count)
			if (!summary.isConnected) group.append(summary)
			const shell = document.createElement('div')
			shell.className = 'table-shell'
			const table = document.createElement('table')
			table.setAttribute('aria-label', `${label(ecosystem)} operations`)
			const headingRow = table.createTHead().insertRow()
			for (const title of ['Operation', 'Classification', 'Risk', 'Candidates', 'Eligibility']) {
				const heading = document.createElement('th')
				heading.scope = 'col'
				heading.textContent = title
				headingRow.append(heading)
			}
			const body = table.createTBody()
			body.className = 'catalog-operation-rows'
			body.append(...members)
			shell.append(table)
			group.querySelector('.table-shell')?.remove()
			group.append(shell)
			return [group]
		})
		container.replaceChildren(...groups)
		if (focusedOperation !== undefined)
			rows
				.find(row => row.dataset['operationId'] === focusedOperation)
				?.querySelector('button')
				?.focus({ preventScroll: true })
		if (focused instanceof HTMLElement && focused.tagName === 'SUMMARY' && container.contains(focused)) focused.focus({ preventScroll: true })
	}
}
