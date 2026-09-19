/** DOM helpers shared by the dashboard panels; none of them read module state. */

export function element(id: string): HTMLElement
export function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T
export function element(id: string, constructor: { new (): HTMLElement } = HTMLElement) {
	const found = document.getElementById(id)
	if (!(found instanceof constructor)) throw new Error(`Missing dashboard element: ${id}`)
	return found
}

export function setText(id: string, value: string) {
	const target = element(id)
	if (target.textContent !== value) target.textContent = value
}

export function shorten(value: string, leading = 8, trailing = 6) {
	return value.length <= leading + trailing + 1 ? value : `${value.slice(0, leading)}…${value.slice(-trailing)}`
}

export function row(cells: readonly (HTMLElement | string)[], labels?: readonly string[]) {
	const tableRow = document.createElement('tr')
	for (const [index, value] of cells.entries()) {
		const cell = document.createElement('td')
		const label = labels?.[index]
		if (label !== undefined) cell.dataset['label'] = label
		if (typeof value === 'string') cell.textContent = value
		else cell.append(value)
		tableRow.append(cell)
	}
	return tableRow
}

export function headingRow(labels: readonly string[]) {
	const tableRow = document.createElement('tr')
	for (const label of labels) {
		const cell = document.createElement('th')
		cell.scope = 'col'
		cell.textContent = label
		tableRow.append(cell)
	}
	return tableRow
}

export function explorerLink(explorerUrl: string, value: string, kind: 'address' | 'tx', focusKey: string) {
	const anchor = document.createElement('a')
	anchor.href = `${explorerUrl}/${kind}/${value}`
	anchor.dataset['focusKey'] = focusKey
	anchor.target = '_blank'
	anchor.rel = 'noreferrer'
	anchor.textContent = shorten(value)
	anchor.title = value
	return anchor
}

export function decisionBadge(decision: string) {
	const badge = document.createElement('span')
	badge.className = 'decision'
	badge.dataset['decision'] = decision
	badge.textContent = decision.replaceAll('-', ' ')
	return badge
}
