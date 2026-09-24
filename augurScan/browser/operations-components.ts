import * as Plot from '@observablehq/plot'
import type { JsonRecord } from './api-validation.ts'
import { exactNumber } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'
import { sparklineBuckets } from './operations-sparkline.ts'

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value?: string): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag)
	node.className = className
	if (value !== undefined) node.textContent = value
	return node
}

export const createOperationsComponents = () => {
	const number = exactNumber
	const operationCard = (label: string, value: string, detail?: string, trend?: readonly JsonRecord[]) => {
		const card = element('div', 'operations-card')
		card.append(element('span', '', label), element('strong', '', value))
		if (detail !== undefined) card.append(element('small', '', detail))
		if (trend !== undefined) {
			const { points, range } = sparklineBuckets(trend)
			if (range !== undefined) {
				const sparkline = Plot.plot({ width: 180, height: 38, margin: 0, style: { background: 'transparent' }, x: { axis: null }, y: { axis: null, domain: [0, Math.max(1, ...points.map(point => point.y))] }, marks: [Plot.lineY(points, { x: 'x', y: 'y', stroke: '#56d7d0' })] })
				sparkline.setAttribute('role', 'img')
				sparkline.setAttribute('aria-label', `${label}: indexed transitions from ${range[0]} to ${range[1]}`)
				card.append(sparkline)
			}
		}
		return card
	}

	const operationRow = (title: string, status: string, identity: string | undefined, block: unknown, href?: string) => {
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

	const exactEvidenceRow = (title: string, status: string, fields: ReadonlyArray<readonly [label: string, value: unknown]>, block?: unknown): HTMLElement => {
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

	const operationsPanel = (title: string, rows: Element[], empty: string, scope?: { readonly label: string; readonly scannerWide?: boolean }) => {
		const panel = element('section', 'operations-panel')
		if (scope?.scannerWide === true) panel.classList.add('operations-panel-scanner-wide')
		panel.append(element('h3', '', title))
		if (scope !== undefined) panel.append(element('p', 'operations-panel-scope', scope.label))
		const list = element('div', 'operations-list')
		list.append(...(rows.length === 0 ? [element('div', 'state-placeholder', empty)] : rows))
		panel.append(list)
		return panel
	}

	return { operationCard, operationRow, exactEvidenceRow, operationsPanel }
}

export const renderOperationsTimelineFilters = (pageUrl: URL, chainId: string, isDemo: boolean, operationsHref: (path: string) => string): HTMLFormElement => {
	const form = document.createElement('form')
	form.className = 'filters operations-filters'
	form.method = 'get'
	form.action = '/operations/timeline'
	form.setAttribute('role', 'search')
	const field = (label: string, name: string, placeholder: string, inputMode?: 'numeric') => {
		const wrapper = document.createElement('label')
		const input = document.createElement('input')
		input.type = 'search'
		input.name = name
		input.placeholder = placeholder
		input.value = pageUrl.searchParams.get(name) ?? ''
		if (inputMode !== undefined) input.inputMode = inputMode
		wrapper.append(element('span', '', label), input)
		return wrapper
	}
	const canonicalLabel = document.createElement('label')
	const canonical = document.createElement('select')
	canonical.name = 'canonical'
	canonical.append(new Option('Canonical only', 'canonical'), new Option('Canonical and superseded', 'all'))
	canonical.value = pageUrl.searchParams.get('canonical') === 'all' ? 'all' : 'canonical'
	canonicalLabel.append(element('span', '', 'Evidence'), canonical)
	for (const [name, value] of [['chainId', chainId], ...(isDemo ? [['demo', '1']] : [])] as const) {
		const input = document.createElement('input')
		input.type = 'hidden'
		input.name = name
		input.value = value
		form.append(input)
	}
	const submit = element('button', 'primary', 'Apply filters')
	submit.setAttribute('type', 'submit')
	const clear = document.createElement('a')
	clear.className = 'secondary button-link'
	clear.href = operationsHref('/operations/timeline')
	clear.textContent = 'Clear filters'
	const actions = element('div', 'operations-filter-actions')
	actions.append(submit, clear)
	form.append(
		field('Search', 'q', 'Event, entity, or evidence…'),
		field('Entity type', 'entityType', 'fork, vault, amm…'),
		field('Event', 'event', 'ReportDisputed…'),
		field('Address', 'address', '0x…'),
		field('From block', 'fromBlock', '0', 'numeric'),
		field('To block', 'toBlock', 'Latest', 'numeric'),
		canonicalLabel,
		actions,
	)
	return form
}

export const renderOperationsRiskSnapshotFilter = (pageUrl: URL, chainId: string, isDemo: boolean, operationsHref: (path: string) => string): HTMLFormElement => {
	const form = document.createElement('form')
	form.className = 'filters operations-filters operations-as-of-filter'
	form.method = 'get'
	form.action = '/operations/risk'
	const label = document.createElement('label')
	const input = document.createElement('input')
	input.type = 'search'
	input.inputMode = 'numeric'
	input.name = 'atBlock'
	input.placeholder = 'Latest available block'
	input.value = pageUrl.searchParams.get('atBlock') ?? ''
	label.append(element('span', '', 'State at block'), input)
	for (const [name, value] of [['chainId', chainId], ...(isDemo ? [['demo', '1']] : [])] as const) {
		const hidden = document.createElement('input')
		hidden.type = 'hidden'
		hidden.name = name
		hidden.value = value
		form.append(hidden)
	}
	const submit = element('button', 'primary', 'View snapshot')
	submit.setAttribute('type', 'submit')
	const latest = document.createElement('a')
	latest.className = 'secondary button-link'
	const latestDestination = new URL(operationsHref('/operations/risk'), location.origin)
	latestDestination.searchParams.delete('atBlock')
	latest.href = `${latestDestination.pathname}${latestDestination.search}`
	latest.textContent = 'Latest state'
	form.append(label, submit, latest)
	return form
}
