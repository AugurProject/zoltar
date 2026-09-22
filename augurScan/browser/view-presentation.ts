import { shortIdentifier } from './identifier-format.ts'
import { requiredElementRole } from './dom-elements.ts'
import { type QuestionRecord } from './browser-types.ts'

export function $(selector: '#detail-dialog'): HTMLDialogElement

export function $(selector: '#event-filter' | '#address-filter' | '#entity-search'): HTMLInputElement

export function $(selector: '#global-network-filter' | '#operations-route-select' | '#rich-sort'): HTMLSelectElement

export function $(selector: '#filters'): HTMLFormElement

export function $(selector: '#address-back' | '.skip-link'): HTMLAnchorElement

export function $(selector: '#more' | '#clear-filters' | '#close-detail' | '#richlist-more' | '#filters button[type="submit"]'): HTMLButtonElement

export function $(selector: string): HTMLElement

export function $(selector: string): HTMLElement {
	const found = document.querySelector<HTMLElement>(selector)
	if (!(found instanceof HTMLElement)) throw new Error(`Required AugurScan element ${selector} is missing or has the wrong type`)
	const expected = {
		anchor: HTMLAnchorElement,
		button: HTMLButtonElement,
		dialog: HTMLDialogElement,
		element: HTMLElement,
		form: HTMLFormElement,
		input: HTMLInputElement,
		select: HTMLSelectElement,
	}[requiredElementRole(selector)]
	if (expected !== undefined && !(found instanceof expected)) throw new Error(`Required AugurScan element ${selector} has the wrong type`)
	return found
}

export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

export const number = (value: string | number | bigint | null | undefined): string => (value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(Number(value)))

export const counted = (value: string | number | bigint | null | undefined, singular: string, plural = `${singular}s`): string => `${number(value)} ${Number(value) === 1 ? singular : plural}`

export const time = (value: string | number | Date | null | undefined) => (value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(value)) : '—')

export const exactTimestamp = (value: string | number | Date | null | undefined) => (value ? new Date(value).toISOString() : 'No timestamp')

export const operationNumber = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? number(value) : number(undefined))

export const operationCounted = (value: unknown, singular: string, plural?: string): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? counted(value, singular, plural) : counted(undefined, singular, plural))

export const operationCard = (label: string, value: string, detail?: string) => {
	const card = element('div', 'operations-card')
	card.append(element('span', '', label), element('strong', '', value))
	if (detail !== undefined) card.append(element('small', '', detail))
	return card
}

export const operationRow = (title: string, status: string, identity: string | undefined, block: unknown, href?: string) => {
	const row = href === undefined ? element('div', 'operations-row') : document.createElement('a')
	row.className = 'operations-row'
	if (row instanceof HTMLAnchorElement && href !== undefined) row.href = href
	const copy = element('div')
	copy.append(element('strong', '', title), element('span', '', status))
	if (identity !== undefined && identity !== '') copy.append(element('code', '', shortIdentifier(identity, 12, 8)))
	row.append(copy)
	if (typeof block === 'string' || typeof block === 'number') {
		const evidence = element('div', 'operations-evidence')
		evidence.append(element('small', '', `Block #${number(block)}`))
		row.append(evidence)
	}
	return row
}

export const exactEvidenceRow = (title: string, status: string, fields: ReadonlyArray<readonly [label: string, value: unknown]>, block?: unknown): HTMLElement => {
	const row = operationRow(title, status, undefined, block)
	const evidence = element('dl', 'operations-exact-evidence')
	for (const [label, value] of fields) {
		const field = element('div')
		const rendered = value === undefined || value === null || value === '' ? 'Not recorded' : String(value)
		field.append(element('dt', '', label), element('dd', '', rendered))
		evidence.append(field)
	}
	row.append(evidence)
	return row
}

export const operationsPanel = (title: string, rows: HTMLElement[], empty: string, scope?: { readonly label: string; readonly scannerWide?: boolean }) => {
	const panel = element('section', 'operations-panel')
	if (scope?.scannerWide === true) panel.classList.add('operations-panel-scanner-wide')
	panel.append(element('h3', '', title))
	if (scope !== undefined) panel.append(element('p', 'operations-panel-scope', scope.label))
	const list = element('div', 'operations-list')
	list.append(...(rows.length === 0 ? [element('div', 'state-placeholder', empty)] : rows))
	panel.append(list)
	return panel
}

export const historyBlockRangeLabel = (oldestBlock: bigint | undefined, newestBlock: bigint | undefined, emptyLabel = 'No block-numbered evidence is loaded') => {
	if (oldestBlock === undefined || newestBlock === undefined) return emptyLabel
	if (oldestBlock === newestBlock) return `Loaded block #${oldestBlock.toLocaleString('en-US')}`
	return `Loaded blocks #${oldestBlock.toLocaleString('en-US')}–#${newestBlock.toLocaleString('en-US')}`
}

export const stateHeader = (eyebrow: string, title: string, subtitle: string, kind: string) => {
	const header = element('header', 'state-detail-header')
	const copy = element('div')
	copy.append(element('p', 'eyebrow', eyebrow), element('h3', 'state-detail-title', title), element('p', 'state-detail-subtitle', subtitle))
	header.append(copy, element('span', 'state-kind', kind))
	return header
}

export const yesNoCheckpoint = (value: unknown) => {
	if (value === undefined) return 'No checkpoint'
	return value ? 'Yes' : 'No'
}

export const questionStatus = (question: QuestionRecord): string => {
	const now = Date.now()
	if (now < new Date(question.start_time).getTime()) return 'Scheduled'
	if (now < new Date(question.end_time).getTime()) return 'Open'
	return 'Ended'
}
