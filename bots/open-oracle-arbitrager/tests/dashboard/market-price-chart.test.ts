import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { renderMarketPriceChart } from '#dashboard/market-price-chart'

const token = '0x0000000000000000000000000000000000000001' as Address
const pool = '0x0000000000000000000000000000000000000002' as Address

function point(blockNumber: string, priceWeth: string, sampledAt: string) {
	return { blockNumber, pool, priceWeth, sampledAt, symbol: 'REP', token, venue: 'Uniswap V3' }
}

function withDashboardDocument(run: (window: Window) => void) {
	const window = new Window({ url: 'http://127.0.0.1/' })
	// happy-dom does not expose the `Option` constructor the chart uses to fill its token selector.
	function Option(this: HTMLOptionElement, text: string, value: string) {
		const option = window.document.createElement('option')
		option.textContent = text
		option.value = value
		return option
	}
	const globalNames = ['document', 'HTMLElement', 'HTMLSelectElement', 'Option'] as const
	const previousGlobals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
	for (const name of globalNames) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'Option' ? Option : Reflect.get(window, name) })
	try {
		window.document.body.innerHTML = `<select id="price-token"><option value="${token}" selected>REP</option></select><span id="price-point-count"></span><div id="market-price-chart"></div>`
		run(window)
	} finally {
		for (const [name, descriptor] of previousGlobals) {
			if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
			else Object.defineProperty(globalThis, name, descriptor)
		}
		void window.happyDOM.close()
	}
}

test('plots only samples with finite prices so one malformed sample cannot poison the whole series', () => {
	withDashboardDocument(window => {
		renderMarketPriceChart({ priceHistory: [point('100', '0.01', '2026-09-21T10:00:00.000Z'), point('101', 'unavailable', '2026-09-21T10:01:00.000Z'), point('102', '0.02', '2026-09-21T10:02:00.000Z')] })
		const polyline = window.document.querySelector('polyline')
		const points = polyline?.getAttribute('points') ?? ''
		expect(points.split(' ')).toHaveLength(2)
		expect(points).not.toContain('NaN')
		expect(window.document.querySelectorAll('circle')).toHaveLength(2)
		expect(window.document.querySelector('#price-point-count')?.textContent).toBe('3 persisted samples')
		expect(window.document.querySelector('details.chart-data summary')?.textContent).toBe('Recent exact price samples (2 of 2 samples)')
		expect(window.document.querySelector('svg desc')?.textContent).toBe('2 current-head pool samples spanning observed heads at blocks 100 through 102. Exact recent values follow the chart in a table.')
		expect(window.document.querySelectorAll('details.chart-data tbody tr')).toHaveLength(2)
	})
})

test('shows the empty message instead of an infinite axis when no sample has a finite price', () => {
	withDashboardDocument(window => {
		renderMarketPriceChart({ priceHistory: [point('100', 'unavailable', '2026-09-21T10:00:00.000Z')] })
		expect(window.document.querySelector('svg')).toBeNull()
		expect(window.document.querySelector('#market-price-chart')?.textContent).toContain('No quoted price samples')
	})
})
