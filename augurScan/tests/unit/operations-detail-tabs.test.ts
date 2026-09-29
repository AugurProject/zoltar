import { expect, mock, test } from 'bun:test'
import type { OperationsDetailRoute } from '../../browser/browser-types.ts'
import type { JsonRecord } from '../../browser/api-validation.ts'
import { Window } from 'happy-dom'
import { renderOperationsDetail } from '../../browser/operations-detail.ts'
import { createOperationsComponents } from '../../browser/operations-components.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

function renderDetail(kind: OperationsDetailRoute['kind'], tab: string, data: JsonRecord, check: (load: ReturnType<typeof mock>) => void) {
	const browser = new Window({ url: `http://localhost/${kind}/0x01?tab=${tab}` })
	const load = mock(async () => true)
	const restoreGlobals = overrideGlobals({ window: browser, document: browser.document, location: browser.location, HTMLAnchorElement: browser.HTMLAnchorElement })
	try {
		document.body.innerHTML = '<main id="operations-content"></main><p id="operations-status"></p>'
		const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
			const node = document.createElement(tag)
			node.className = className
			node.textContent = text
			return node
		}
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
				setDetailState: () => undefined,
				requiredChainId: () => '1',
				operationsDetailRouteKey: () => 'pool:0x01',
				detailEvidenceRowsFor: () => [],
				loadOperations: load,
				components: createOperationsComponents(),
			},
			{ chainId: '1', asOf: {}, data },
			{ kind, identity: ['0x01', '1'] },
		)
		check(load)
	} finally {
		restoreGlobals()
		void browser.happyDOM.close()
	}
}

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
				expect(document.querySelector('.operations-grid .operations-panel')).not.toBeNull()
				expect(document.querySelector('.operations-grid > .state-placeholder')).toBeNull()
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
