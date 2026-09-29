import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { renderOperationsDetail } from '../../browser/operations-detail.ts'
import { createOperationsComponents } from '../../browser/operations-components.ts'

test('keeps risk lifecycle evidence with its history continuation', () => {
	const browser = new Window({ url: 'http://localhost/pool/0x01?tab=history' })
	const originals = new Map<string, PropertyDescriptor | undefined>()
	for (const [key, value] of Object.entries({ window: browser, document: browser.document, location: browser.location, HTMLAnchorElement: browser.HTMLAnchorElement })) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value })
	}
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
				loadOperations: async () => true,
				components: createOperationsComponents(),
			},
			{ chainId: '1', asOf: {}, data: { history: { lifecycleEvents: [{ block_number: '10' }], truncated: true, nextCursor: 'older', limit: 100 } } },
			{ kind: 'pool', identity: ['0x01'] },
		)
		expect(document.body.textContent).toContain('Show older evidence')
		expect(document.body.textContent).toContain('Risk lifecycle events')
		expect(document.body.textContent).toContain('Pool lifecycle observation')
	} finally {
		for (const [key, descriptor] of originals) {
			if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
			else Object.defineProperty(globalThis, key, descriptor)
		}
		void browser.happyDOM.close()
	}
})
