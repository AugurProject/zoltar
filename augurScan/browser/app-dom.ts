import { requiredElementRole } from './dom-elements.ts'

export function lookup(selector: '#detail-dialog'): HTMLDialogElement
export function lookup(selector: '#event-filter' | '#address-filter' | '#entity-search'): HTMLInputElement
export function lookup(selector: '#global-network-filter' | '#operations-route-select' | '#rich-sort'): HTMLSelectElement
export function lookup(selector: '#filters'): HTMLFormElement
export function lookup(selector: '#address-back' | '.skip-link'): HTMLAnchorElement
export function lookup(selector: '#more' | '#clear-filters' | '#close-detail' | '#richlist-more' | '#filters button[type="submit"]'): HTMLButtonElement
export function lookup(selector: string): HTMLElement
export function lookup(selector: string): HTMLElement {
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

export interface ScannerElements {
	readonly feed: HTMLElement
	readonly feedState: HTMLElement
	readonly networkCards: HTMLElement
	readonly globalNetworkFilter: HTMLSelectElement
	readonly operationsRouteSelect: HTMLSelectElement
	readonly dialog: HTMLDialogElement
	readonly detailContent: HTMLElement
	readonly connection: HTMLElement
}

export const scannerElements = (): ScannerElements => ({
	feed: lookup('#feed'),
	feedState: lookup('#feed-state'),
	networkCards: lookup('#network-cards'),
	globalNetworkFilter: lookup('#global-network-filter'),
	operationsRouteSelect: lookup('#operations-route-select'),
	dialog: lookup('#detail-dialog'),
	detailContent: lookup('#detail-content'),
	connection: lookup('.connection'),
})

export interface HistoryRangeElements {
	readonly form: HTMLFormElement
	readonly fromBlock: HTMLInputElement
	readonly toBlock: HTMLInputElement
	readonly clear: HTMLButtonElement
}

export const historyRangeElements = (): HistoryRangeElements => {
	const form = document.querySelector<HTMLFormElement>('#history-range')
	const fromBlock = document.querySelector<HTMLInputElement>('#history-from-block')
	const toBlock = document.querySelector<HTMLInputElement>('#history-to-block')
	const clear = document.querySelector<HTMLButtonElement>('#history-range-clear')
	if (form === null || fromBlock === null || toBlock === null || clear === null) throw new Error('History range controls are missing')
	return { form, fromBlock, toBlock, clear }
}
