import { expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { JsonRecord, OperationsResponse } from '../../browser/api-validation.ts'
import { createOperationsComponents, renderOperationsTimelineFilters } from '../../browser/operations-components.ts'
import { escalationPayoutSummary } from '../../browser/escalation-payouts.ts'
import { timelineEntityTypeLabel } from '../../browser/history-evidence.ts'
import { createOperationsData } from '../../browser/operations-data.ts'
import { createOperationsLoader } from '../../browser/operations-loader.ts'
import { renderOperationsOverview } from '../../browser/operations-overview.ts'
import { operationsRenderSignature } from '../../browser/operations-render-signature.ts'
import { createOperationsRouteView } from '../../browser/operations-route-view.ts'
import { createOperationsRouteState } from '../../browser/operations-state.ts'
import { captureViewState, restoreViewState } from '../../browser/view-state.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

const blockHash = `0x${'1'.repeat(64)}`
const asOfBlock = (blockNumber: string, historical = false): OperationsResponse['asOf'] => ({
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

test('AMM LP transfer and approval evidence shows the ERC-20 value argument', async () => {
	await withOperationsPage('http://localhost/trading/0x01?chainId=1', () => {
		const { routeView } = createRouteView()
		const owner = `0x${'1'.repeat(40)}`
		const spender = `0x${'2'.repeat(40)}`
		const rows = routeView.detailEvidenceRowsFor('trading', [
			{ event_name: 'Transfer', event_data: { from: owner, to: spender, value: '2500000000000000000' }, block_number: '100', tx_hash: `0x${'a'.repeat(64)}` },
			{ event_name: 'Approval', event_data: { owner, spender, value: '1000000000000000000' }, block_number: '100', tx_hash: `0x${'b'.repeat(64)}` },
		])
		// Anchor the whole summary so a wrong value such as 11 or 0.1 LP shares cannot satisfy the assertion.
		expect(rows.map(row => row.textContent)).toEqual([expect.stringMatching(/^Transfer2\.5 LP shares · 0x111111…111111 → 0x222222…222222/), expect.stringMatching(/^Approval1 LP shares · 0x111111…111111 approved 0x222222…222222/)])
	})
})

test('report detail distinguishes observed untracked rounds and their comparison labels', async () => {
	await withOperationsPage('http://localhost/operations/report/0x01/7?chainId=1', () => {
		const { routeView } = createRouteView()
		const rows = routeView.detailEvidenceRowsFor('report', [
			{ event_name: 'ReportDisputed', round_number: '0', observed_round_number: '3', comparison: { state: 'compared', previousRoundNumber: '0', previousObservedRoundNumber: '2' } },
			{ event_name: 'ReportSubmitted', round_number: '1', observed_round_number: null, comparison: { state: 'initial' } },
		])
		expect(rows[0]?.textContent).toContain('ReportDisputed · observed round 3')
		expect(rows[0]?.textContent).toContain('Changes from observed round 2')
		expect(rows[1]?.textContent).toContain('ReportSubmitted · round 1')
	})
})

test('shows the escalation depositor’s wallet as the recipient of payable REP', () => {
	expect(escalationPayoutSummary({ payout_atto_rep: '142000000000000000000', burn_atto_rep: '2000000000000000000' })).toContain('142 REP payable to the depositor’s wallet · 2 REP protocol burn allocation')
	expect(escalationPayoutSummary({ status: 'pending' })).not.toContain('payable')
})

test('labels the OpenOracle approval entity separately from a price coordinator', () => {
	expect(timelineEntityTypeLabel('open-oracle')).toBe('OpenOracle')
	expect(timelineEntityTypeLabel('price-coordinator')).toBe('Price coordinator')
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
			operationsSectionFilters: () => [],
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

test('trading catalog displays volumes using each market collateral unit', async () => {
	await withOperationsPage('http://localhost/operations/trading?chainId=1', () => {
		const markets = [
			{ question_title: 'USDC market', volume: '250000000000', collateral: { symbol: 'USDC', decimals: 6 }, pair_address: `0x${'1'.repeat(40)}` },
			{ question_title: 'WETH market', volume: '2000000000000000000', collateral: { symbol: 'WETH', decimals: 18 }, pair_address: `0x${'2'.repeat(40)}` },
			{ question_title: 'Unknown collateral market', volume: '25', pair_address: `0x${'3'.repeat(40)}` },
		]
		renderOverview({ chainId: '1', asOf: asOfBlock('100'), data: { trading: markets.map(market => ({ ...market, eth_volume_24h_atto_eth: market.volume, eth_volume_atto_eth: market.volume })) } }, false)
		const rendered = document.body.textContent
		for (const volume of ['250,000 USDC', '2 WETH', '25 collateral units']) {
			expect(rendered).toContain(`${volume} 24-hour volume`)
			expect(rendered).toContain(`${volume} all-time volume`)
		}
	})
})

test('short unscoped timeline text stays editable and is rejected before navigation', async () => {
	await withOperationsPage('http://localhost/operations/timeline?chainId=1', () => {
		const navigate = mock((_url: URL) => undefined)
		const form = renderOperationsTimelineFilters(new URL(location.href), '1', false, path => path, navigate)
		lookup('#operations-content').append(form)
		const dispatch = (type: string) => {
			const event = document.createEvent('Event')
			event.initEvent(type, true, true)
			form.dispatchEvent(event)
		}
		const search = form.querySelector<HTMLInputElement>('input[name="q"]')
		if (search === null) throw new Error('Missing search input')
		for (const query of ['zz', '!!!', 'a!b!c', '%_%']) {
			search.value = query
			dispatch('input')
			dispatch('submit')
			expect(navigate).not.toHaveBeenCalled()
		}
		expect(form.textContent).toContain('3 consecutive letters or digits')
		search.value = 'price'
		dispatch('input')
		dispatch('submit')
		expect(navigate).toHaveBeenCalledTimes(1)
		const entity = form.querySelector<HTMLInputElement>('input[name="entityType"]')
		if (entity === null) throw new Error('Missing entity filter')
		entity.value = 'report'
		search.value = '!!!'
		dispatch('input')
		dispatch('submit')
		expect(navigate).toHaveBeenCalledTimes(2)
	})
})

test('a direct invalid timeline URL retains editable filters after the API rejects it', async () => {
	await withOperationsPage('http://localhost/operations/timeline?chainId=1&q=zz', async () => {
		const { routeView } = createRouteView()
		const api = async () => {
			throw new Error('q must contain 3 consecutive letters or digits')
		}
		const load = createOperationsLoader({
			state: createOperationsRouteState(),
			requiredChainId: () => '1',
			lookup,
			api,
			operationsDetailRoute: () => undefined,
			operationsCatalogSection: () => 'timeline',
			operationsDetailRouteKey: route => route.kind,
			operationsSectionFilters: routeView.operationsSectionFilters,
			data: createOperationsData(
				api,
				() => '1',
				() => new URL(location.href),
			),
			renderOperations: () => undefined,
			renderOperationsDetailPage: () => undefined,
			renderSignature: () => '',
			renderRetryStatus: (status, message) => {
				status.textContent = message
			},
		})
		expect(await load()).toBe(false)
		expect(document.querySelector<HTMLInputElement>('input[name="q"]')?.value).toBe('zz')
		expect(document.body.textContent).toContain('Clear filters')
		expect(lookup('#operations-status').textContent).toContain('3 consecutive letters or digits')
	})
})
