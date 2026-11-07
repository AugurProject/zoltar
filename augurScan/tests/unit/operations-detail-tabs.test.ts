import { expect, mock, test } from 'bun:test'
import type { OperationsDetailRoute } from '../../browser/browser-types.ts'
import type { JsonRecord } from '../../browser/api-validation.ts'
import { Window } from 'happy-dom'
import { renderOperationsDetail, showOperationsDetailTab } from '../../browser/operations-detail.ts'
import { createOperationsComponents } from '../../browser/operations-components.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

interface DetailHarness {
	readonly render: (data: JsonRecord, live?: boolean) => void
	readonly load: ReturnType<typeof mock<() => Promise<boolean>>>
	readonly selectTab: ReturnType<typeof mock<(destination: URL) => void>>
}

function withDetail(kind: OperationsDetailRoute['kind'], tab: string, run: (harness: DetailHarness) => void) {
	const browser = new Window({ url: `http://localhost/${kind}/0x01?tab=${tab}` })
	const load = mock(async () => true)
	const selectTab = mock((_destination: URL) => undefined)
	const restoreGlobals = overrideGlobals({ window: browser, document: browser.document, location: browser.location, HTMLAnchorElement: browser.HTMLAnchorElement })
	try {
		document.body.innerHTML = '<main id="operations-content"></main><p id="operations-status"></p>'
		const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
			const node = document.createElement(tag)
			node.className = className
			node.textContent = text
			return node
		}
		const render = (data: JsonRecord, live = false) =>
			renderOperationsDetail(
				{
					lookup: selector => {
						const node = document.querySelector<HTMLElement>(selector)
						if (node === null) throw new Error(selector)
						return node
					},
					captureContext: () => ({ focusLoadMore: false, focusHistoryMore: false, scrollY: 0 }),
					restoreContext: () => undefined,
					element,
					connection: element('div'),
					operationsHref: path => path,
					approvalTransitionSummary: () => '',
					rawEvidence: () => element('pre'),
					operationCounted: (value, singular) => `${value} ${singular}`,
					operationRatio: () => '',
					operationNumber: String,
					operationsHistoryOffset: value => (typeof value === 'number' ? value : undefined),
					operationsRiskHistoryKeys: ['stateSnapshots', 'accountingSnapshots', 'lifecycleEvents', 'liquidations'],
					detailEvidenceRows: rows => rows.map(() => element('p', '', 'Pool lifecycle observation')),
					historyBlockRangeLabel: () => 'Block 10',
					isDemo: false,
					pageUrl: new URL(browser.location.href),
					demoRiskHistoryAutoLoadConsumed: false,
					consumeDemoRiskHistoryAutoLoad: () => undefined,
					selectTab,
					setDetailState: () => undefined,
					requiredChainId: () => '1',
					operationsDetailRouteKey: () => 'pool:0x01',
					detailEvidenceRowsFor: () => [],
					loadOperations: load,
					components: createOperationsComponents(),
				},
				{ chainId: '1', asOf: {}, data },
				{ kind, identity: ['0x01', '1'] },
				undefined,
				live,
			)
		run({ render, load, selectTab })
	} finally {
		restoreGlobals()
		void browser.happyDOM.close()
	}
}

function renderDetail(kind: OperationsDetailRoute['kind'], tab: string, data: JsonRecord, check: (load: ReturnType<typeof mock>) => void) {
	withDetail(kind, tab, ({ render, load }) => {
		render(data)
		check(load)
	})
}

const visibleTabGroups = () => [...document.querySelectorAll<HTMLElement>('.operations-grid > [data-detail-tab]')].filter(group => !group.hidden)

const riskHistory = { lifecycleEvents: [{ block_number: '10' }], truncated: true, nextCursor: 'older', limit: 100 }

test('keeps risk lifecycle evidence with its history continuation', () => {
	renderDetail('pool', 'history', { history: riskHistory }, load => {
		expect(document.body.textContent).toContain('Show older evidence')
		expect(document.body.textContent).toContain('Risk lifecycle events')
		expect(document.body.textContent).toContain('Pool lifecycle observation')
		document.querySelector<HTMLButtonElement>('.operations-history-more')?.click()
		expect(load).toHaveBeenCalledWith(expect.objectContaining({ historyTargetOffset: 100 }))
	})
})

for (const kind of ['pool', 'vault', 'trading', 'escalation', 'auction', 'fork', 'report'] as const)
	test(`renders only populated tabs for ${kind}`, () => {
		const data = { snapshot: { read_status: 'success', read_result: {} }, ...(kind === 'report' ? { current: { event_name: 'Reported' } } : {}), ...(kind === 'pool' || kind === 'vault' ? { history: riskHistory } : {}), ...(kind === 'auction' ? { finalization: { block_number: '10' } } : {}) }
		let tabs: string[] = []
		renderDetail(kind, 'overview', data, () => {
			tabs = Array.from(document.querySelectorAll<HTMLAnchorElement>('.entity-detail-tabs a'), anchor => new URL(anchor.href).searchParams.get('tab') ?? 'overview')
		})
		for (const tab of tabs)
			renderDetail(kind, tab, data, () => {
				expect(visibleTabGroups().length).toBeGreaterThan(0)
				expect(visibleTabGroups().every(group => group.classList.contains('operations-panel') && group.dataset['detailTab'] === tab)).toBe(true)
			})
	})

test('omits an unavailable Evidence tab and falls back to Overview', () => {
	renderDetail('fork', 'evidence', { summary: {} }, () => {
		expect(document.querySelector('a[href*="tab=evidence"]')).toBeNull()
		expect(document.querySelector('.entity-detail-tabs [aria-current="page"]')?.textContent).toBe('Overview')
		expect(document.body.textContent).toContain('Fork migration totals')
	})
})

test('keeps coordinator records and their pager on Evidence', () => {
	renderDetail('report', 'evidence', { coordinatorDecisions: { items: [{ event_name: 'DecisionAccepted' }], hasMore: true, nextCursor: 'older' } }, load => {
		expect(document.body.textContent).toContain('DecisionAccepted')
		document.querySelector<HTMLButtonElement>('[data-detail-collection="decisions"]')?.click()
		expect(load).toHaveBeenCalledWith(expect.objectContaining({ decisionTargetCount: 101 }))
	})
})

test('keeps market activity records and their pager on Evidence', () => {
	renderDetail('trading', 'evidence', { activity: { items: [{ kind: 'mint-complete-sets', shares: '1' }], hasMore: true, nextCursor: 'older' } }, load => {
		expect(document.body.textContent).toContain('Mint complete sets')
		const more = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Show older market activity')
		expect(more).toBeDefined()
		more?.click()
		expect(load).toHaveBeenCalledWith(expect.objectContaining({ activityTargetCount: 101 }))
	})
})

for (const kind of ['pool', 'vault'] as const)
	test(`puts canonical approval records on ${kind} Evidence`, () => {
		renderDetail(kind, 'evidence', { approvalEvents: [{ event_name: 'LiquidationApproved' }] }, () => {
			expect(document.body.textContent).toContain('Liquidation approval lifecycle')
			expect(document.body.textContent).toContain('LiquidationApproved')
			expect(document.querySelector('.entity-detail-tabs [aria-current="page"]')?.textContent).toBe('Evidence')
		})
	})

test('detail tabs switch in place without reloading the page', () => {
	withDetail('pool', 'overview', ({ render, load, selectTab }) => {
		render({ snapshot: { read_status: 'success', read_result: {} }, history: riskHistory, approvalEvents: [{ event_name: 'LiquidationApproved' }] })
		const content = document.querySelector<HTMLElement>('#operations-content')
		if (content === null) throw new Error('Operations content is missing')
		const current = () => document.querySelector('.entity-detail-tabs [aria-current="page"]')?.textContent
		expect(visibleTabGroups().every(group => group.dataset['detailTab'] === 'overview')).toBe(true)
		// Every tab's panels are rendered up front, so a switch needs no request.
		expect(document.body.textContent).toContain('Risk lifecycle events')
		document.querySelector<HTMLAnchorElement>('.entity-detail-tabs a[data-detail-tab="history"]')?.click()
		expect(load).not.toHaveBeenCalled()
		expect(selectTab).toHaveBeenCalledTimes(1)
		expect(selectTab.mock.calls[0]?.[0].searchParams.get('tab')).toBe('history')
		expect(current()).toBe('History')
		expect(visibleTabGroups().length).toBeGreaterThan(0)
		expect(visibleTabGroups().every(group => group.dataset['detailTab'] === 'history')).toBe(true)
		// History traversal applies the URL's tab to the same page.
		showOperationsDetailTab(content, 'evidence')
		expect(current()).toBe('Evidence')
		expect(visibleTabGroups().map(group => group.textContent)).toEqual([expect.stringContaining('LiquidationApproved')])
		showOperationsDetailTab(content, null)
		expect(current()).toBe('Overview')
		showOperationsDetailTab(content, 'missing')
		expect(current()).toBe('Overview')
		expect(load).not.toHaveBeenCalled()
	})
})

test('a modified click on a detail tab is left to the browser', () => {
	withDetail('pool', 'overview', ({ render, selectTab }) => {
		render({ snapshot: { read_status: 'success', read_result: {} }, history: riskHistory })
		const link = document.querySelector<HTMLAnchorElement>('.entity-detail-tabs a[data-detail-tab="history"]')
		if (link === null) throw new Error('History tab is missing')
		const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
		link.dispatchEvent(event)
		expect(event.defaultPrevented).toBe(false)
		expect(selectTab).not.toHaveBeenCalled()
	})
})

test('a live refresh with new evidence keeps open disclosures, focus, and the selected tab', () => {
	withDetail('pool', 'history', ({ render }) => {
		const snapshot = { read_status: 'success', read_result: {} }
		render({ snapshot, history: riskHistory })
		const identity = document.querySelector<HTMLDetailsElement>('details.operations-detail-identity')
		const historyLink = document.querySelector<HTMLAnchorElement>('.entity-detail-tabs a[data-detail-tab="history"]')
		if (identity === null || historyLink === null) throw new Error('Detail page did not render')
		identity.open = true
		historyLink.focus()
		render({ snapshot, history: { ...riskHistory, lifecycleEvents: [{ block_number: '11' }, { block_number: '10' }] } }, true)
		expect(document.querySelector('details.operations-detail-identity')).not.toBe(identity)
		expect(document.querySelector<HTMLDetailsElement>('details.operations-detail-identity')?.open).toBe(true)
		expect(document.activeElement).not.toBe(historyLink)
		expect(document.activeElement?.textContent).toBe('History')
		expect(visibleTabGroups().every(group => group.dataset['detailTab'] === 'history')).toBe(true)
	})
})
