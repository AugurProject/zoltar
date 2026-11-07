import { expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { JsonRecord, OperationsResponse } from '../../browser/api-validation.ts'
import { createOperationsComponents } from '../../browser/operations-components.ts'
import { createOperationsData } from '../../browser/operations-data.ts'
import { createOperationsLoader } from '../../browser/operations-loader.ts'
import { renderOperationsOverview } from '../../browser/operations-overview.ts'
import { operationsRenderSignature } from '../../browser/operations-render-signature.ts'
import { createOperationsRouteView } from '../../browser/operations-route-view.ts'
import { createOperationsRouteState } from '../../browser/operations-state.ts'
import { captureViewState, restoreViewState } from '../../browser/view-state.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

const blockHash = `0x${'1'.repeat(64)}`
const asOfBlock = (blockNumber: string, historical = false): JsonRecord => ({
	blockNumber,
	blockHash,
	blockTimestamp: '1767225600',
	indexedHead: blockNumber,
	invalidationId: '0',
	abiSourceHash: 'abi',
	applicationSourceHash: 'app',
	projectionSourceHash: 'projection',
	phase: historical ? 'historical' : 'live',
	historical,
	lagBlocks: '0',
	observedHead: blockNumber,
})

const withOperationsPage = async (url: string, run: (browser: Window) => Promise<void> | void): Promise<void> => {
	const browser = new Window({ url })
	browser.document.body.innerHTML = '<p id="operations-status" role="status"></p><div id="operations-content"></div>'
	const restoreGlobals = overrideGlobals({
		window: browser,
		document: browser.document,
		location: browser.location,
		history: browser.history,
		HTMLElement: browser.HTMLElement,
		HTMLAnchorElement: browser.HTMLAnchorElement,
		HTMLButtonElement: browser.HTMLButtonElement,
		HTMLFormElement: browser.HTMLFormElement,
		// happy-dom has no Option constructor; the timeline filter builds its evidence select with one.
		Option: function Option(text: string, value: string) {
			const option = browser.document.createElement('option')
			option.textContent = text
			option.value = value
			return option
		},
	})
	try {
		await run(browser)
	} finally {
		restoreGlobals()
		await browser.happyDOM.close()
	}
}

const lookup = (selector: string): HTMLElement => {
	const node = document.querySelector<HTMLElement>(selector)
	if (node === null) throw new Error(`Missing ${selector}`)
	return node
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag)
	node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

const createRouteView = () => {
	const components = createOperationsComponents()
	const routeView = createOperationsRouteView({
		lookup,
		getPageUrl: () => new URL(location.href),
		selectedChainId: () => '1',
		requiredChainId: () => '1',
		isDemo: false,
		element,
		number: value => String(value ?? '—'),
		counted: (value, singular) => `${String(value ?? '—')} ${singular}`,
		operationRow: components.operationRow,
		navigate: () => undefined,
	})
	return { components, routeView }
}

const renderOverview = (response: OperationsResponse, live: boolean) => {
	const { components, routeView } = createRouteView()
	renderOperationsOverview(
		{
			lookup,
			captureContext: routeView.captureOperationsRenderContext,
			restoreContext: routeView.restoreOperationsRenderContext,
			networks: [],
			requiredChainId: () => '1',
			element,
			number: value => String(value ?? '—'),
			operationNumber: routeView.operationNumber,
			operationCounted: routeView.operationCounted,
			operationsHref: routeView.operationsHref,
			approvalTransitionSummary: routeView.approvalTransitionSummary,
			operationsCatalogSection: routeView.operationsCatalogSection,
			operationsSectionFilters: routeView.operationsSectionFilters,
			connection: element('div'),
			setRiskCatalogState: () => undefined,
			setCatalogState: () => undefined,
			loadOperations: async () => true,
			components,
		},
		response,
		undefined,
		live,
	)
}

const timelineItem = (index: number): JsonRecord => ({ block_hash: blockHash, tx_hash: `0x${String(index).repeat(64)}`, log_index: index, block_number: String(100 + index), entity_type: 'report', entity_identity: `report-${index}`, semantic_event_kind: 'ReportDisputed' })

test('a live re-render keeps typed but unapplied timeline filters and their focus', async () => {
	await withOperationsPage('http://localhost/operations/timeline?chainId=1&q=report', () => {
		renderOverview({ chainId: '1', asOf: asOfBlock('100'), data: { timeline: [], _catalogPage: { total: 0 } } }, false)
		const form = document.querySelector<HTMLFormElement>('form.operations-filters')
		const search = form?.querySelector<HTMLInputElement>('input[name="q"]')
		if (form === null || form === undefined || search === null || search === undefined) throw new Error('Timeline filters did not render')
		expect(search.value).toBe('report')
		search.value = 'reported by 0x'
		search.focus()
		renderOverview({ chainId: '1', asOf: asOfBlock('101'), data: { timeline: [timelineItem(1)], _catalogPage: { total: 1 } } }, true)
		expect(document.body.textContent).toContain('1 matching transition')
		expect(document.querySelector('form.operations-filters')).toBe(form)
		expect(search.value).toBe('reported by 0x')
		expect(document.activeElement).toBe(search)
		// Applying different filters renders a form filled from the new URL.
		history.replaceState(null, '', '/operations/timeline?chainId=1&q=dispute')
		renderOverview({ chainId: '1', asOf: asOfBlock('102'), data: { timeline: [], _catalogPage: { total: 0 } } }, true)
		expect(document.querySelector('form.operations-filters')).not.toBe(form)
		expect(document.querySelector<HTMLInputElement>('form.operations-filters input[name="q"]')?.value).toBe('dispute')
	})
})

test('raw evidence stays open on the same record when newer evidence arrives above it', async () => {
	await withOperationsPage('http://localhost/pool/0x01?chainId=1', () => {
		const { routeView } = createRouteView()
		const content = lookup('#operations-content')
		const record = (index: number): JsonRecord => ({ ...timelineItem(index), event_name: `Event ${index}` })
		content.replaceChildren(...routeView.detailEvidenceRows([record(2), record(1)]))
		const older = content.querySelectorAll<HTMLDetailsElement>('details.operations-raw-evidence')[1]
		if (older === undefined) throw new Error('Raw evidence did not render')
		older.open = true
		const snapshot = captureViewState(content)
		content.replaceChildren(...routeView.detailEvidenceRows([record(3), record(2), record(1)]))
		restoreViewState(content, snapshot)
		expect([...content.querySelectorAll<HTMLDetailsElement>('details.operations-raw-evidence')].map(details => details.open)).toEqual([false, false, true])
	})
})

test('the render signature ignores per-block freshness, cursors, and the detail tab but not displayed evidence', () => {
	const inputs = { chainId: '1', url: new URL('http://localhost/pool/0x01?chainId=1'), networkName: 'Ethereum Mainnet', liveConnected: true }
	const signature = (blockNumber: string, data: JsonRecord, overrides: Partial<typeof inputs> = {}, historical = false) => operationsRenderSignature({ chainId: '1', asOf: asOfBlock(blockNumber, historical), data }, { ...inputs, ...overrides })
	const page = (cursor: string, count: string): JsonRecord => ({ events: { items: [{ count }], hasMore: true, nextCursor: cursor } })
	expect(signature('101', page('cursor-101', '1'))).toBe(signature('100', page('cursor-100', '1')))
	expect(signature('100', page('cursor-100', '1'), { url: new URL('http://localhost/pool/0x01?chainId=1&tab=history') })).toBe(signature('100', page('cursor-100', '1')))
	expect(signature('100', page('cursor-100', '2'))).not.toBe(signature('100', page('cursor-100', '1')))
	expect(signature('100', page('cursor-100', '1'), { url: new URL('http://localhost/pool/0x01?chainId=1&atBlock=90') })).not.toBe(signature('100', page('cursor-100', '1')))
	// A historical snapshot shows the current head and connection state, so those count.
	expect(signature('101', page('cursor-101', '1'), {}, true)).not.toBe(signature('100', page('cursor-100', '1'), {}, true))
	expect(signature('100', page('cursor-100', '1'), { liveConnected: false }, true)).not.toBe(signature('100', page('cursor-100', '1'), {}, true))
})

test('an unchanged live refresh keeps the rendered operations page and a changed one re-renders it', async () => {
	await withOperationsPage('http://localhost/operations?chainId=1', async () => {
		let response: OperationsResponse = { chainId: '1', asOf: asOfBlock('100'), data: { reports: [], hasMore: true, nextCursor: 'cursor-100' } }
		const api = async () => response
		const renderOperations = mock((_response: OperationsResponse, _context?: unknown, _live?: boolean) => {
			lookup('#operations-content').replaceChildren(element('p', '', 'Rendered operations'))
			lookup('#operations-content').setAttribute('aria-busy', 'false')
			lookup('#operations-status').hidden = true
		})
		const loadOperations = createOperationsLoader({
			state: createOperationsRouteState(),
			requiredChainId: () => '1',
			lookup,
			api,
			operationsDetailRoute: () => undefined,
			operationsCatalogSection: () => undefined,
			operationsDetailRouteKey: route => route.kind,
			data: createOperationsData(
				api,
				() => '1',
				() => new URL(location.href),
			),
			renderOperations,
			renderOperationsDetailPage: () => undefined,
			renderSignature: value => operationsRenderSignature(value, { chainId: '1', url: new URL(location.href), networkName: undefined, liveConnected: true }),
			renderRetryStatus: () => undefined,
		})
		expect(await loadOperations()).toBe(true)
		expect(renderOperations).toHaveBeenCalledTimes(1)
		const rendered = document.querySelector('#operations-content p')
		response = { ...response, asOf: asOfBlock('101'), data: { ...response.data, nextCursor: 'cursor-101' } }
		expect(await loadOperations({ live: true })).toBe(true)
		expect(renderOperations).toHaveBeenCalledTimes(1)
		expect(document.querySelector('#operations-content p')).toBe(rendered)
		expect(lookup('#operations-content').getAttribute('aria-busy')).toBe('false')
		expect(lookup('#operations-status').hidden).toBe(true)
		response = { ...response, data: { ...response.data, reports: [{ open_oracle_address: `0x${'a'.repeat(40)}`, report_id: '1' }] } }
		expect(await loadOperations({ live: true })).toBe(true)
		expect(renderOperations).toHaveBeenCalledTimes(2)
		expect(renderOperations.mock.calls[1]?.[2]).toBe(true)
		// Pagination always renders, because it restores focus to its continuation control.
		expect(await loadOperations({ live: true, preservedContext: { focusLoadMore: true, focusHistoryMore: false, scrollY: 0 } })).toBe(true)
		expect(renderOperations).toHaveBeenCalledTimes(3)
	})
})
