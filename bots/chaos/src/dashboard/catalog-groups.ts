import { replaceWhenChanged } from './dom.js'

const headings = ['Operation', 'Classification', 'Risk', 'Candidates', 'Eligibility']

type Group = {
	element: HTMLDetailsElement
	count: HTMLSpanElement
	body: HTMLTableSectionElement
}

function createGroup(ecosystem: string, name: string): Group {
	const element = document.createElement('details')
	element.className = 'catalog-group'
	element.dataset['ecosystem'] = ecosystem
	const summary = document.createElement('summary')
	const title = document.createElement('strong')
	title.textContent = name
	const count = document.createElement('span')
	count.className = 'muted'
	summary.append(title, count)
	const shell = document.createElement('div')
	shell.className = 'table-shell'
	const table = document.createElement('table')
	table.setAttribute('aria-label', `${name} operations`)
	const headingRow = table.createTHead().insertRow()
	for (const heading of headings) {
		const cell = document.createElement('th')
		cell.scope = 'col'
		cell.textContent = heading
		headingRow.append(cell)
	}
	const body = table.createTBody()
	body.className = 'catalog-operation-rows'
	shell.append(table)
	element.append(summary, shell)
	return { element, count, body }
}

/**
 * Renders the catalog by mutating cached group, table, and row nodes in place. Rebuilding the
 * subtree on every poll destroyed and recreated identical nodes, which made the catalog flicker
 * and shift the scroll position on each refresh.
 */
export function createCatalogGroups(container: HTMLElement, ecosystems: readonly string[], label: (value: string) => string) {
	const cached = new Map<string, Group>()
	return (rows: HTMLTableRowElement[]) => {
		const focused = document.activeElement
		const focusedOperation = focused instanceof HTMLButtonElement && focused.classList.contains('operation-open') ? focused.closest('tr')?.dataset['operationId'] : undefined
		const groups = ecosystems.flatMap(ecosystem => {
			const members = rows.filter(row => row.dataset['ecosystem'] === ecosystem)
			if (members.length === 0) return []
			const group = cached.get(ecosystem) ?? createGroup(ecosystem, label(ecosystem))
			cached.set(ecosystem, group)
			group.count.textContent = `${members.length.toString()} operations`
			replaceWhenChanged(group.body, members)
			return [group.element]
		})
		replaceWhenChanged(container, groups)
		if (focusedOperation !== undefined)
			rows
				.find(row => row.dataset['operationId'] === focusedOperation)
				?.querySelector('button')
				?.focus({ preventScroll: true })
		if (focused instanceof HTMLElement && focused.tagName === 'SUMMARY' && container.contains(focused)) focused.focus({ preventScroll: true })
	}
}
