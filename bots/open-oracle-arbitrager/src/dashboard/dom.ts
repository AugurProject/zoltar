/** DOM helpers shared by the dashboard panels; none of them read module state. */
import { shorten } from '@zoltar/bot-shared/dashboard/dom'

export { element, setText, shorten } from '@zoltar/bot-shared/dashboard/dom'

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
