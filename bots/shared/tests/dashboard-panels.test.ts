import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { repMarketConsensusPanel, renderRepMarketConsensus, renderRepMarketConsensusError } from '../src/dashboard/rep-market-consensus.ts'
import { rpcConnectivityFields } from '../src/dashboard/rpc-connectivity.ts'

const consensus = { cex: { sourceCount: 2 }, dex: { askDepthEth: '6', bidDepthEth: '5', priceRepPerEth: '21', reliable: true, sourceCount: 1 }, priceRepPerEth: '20.5', reasons: [], reliable: true }

test('consensus panel renders metrics, safe observation text, empty states and retained refresh failures', () => {
	const window = new Window()
	const previousDocument = globalThis.document
	Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document })
	try {
		document.body.innerHTML = repMarketConsensusPanel()
		expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
		renderRepMarketConsensusError(document)
		expect(document.querySelector('td')?.textContent).toContain('unavailable')
		const market = { askDepthEth: '8', bidDepthEth: '7', observations: [{ askDepthEth: '8', bidDepthEth: '7', exchangeId: '<script>bad()</script>', observedAt: 0, priceRepPerEth: '20', repMarket: 'REP/ETH' }], priceRepPerEth: '20', reasons: ['stale'], reliable: false }
		renderRepMarketConsensus(document, market, consensus)
		expect(document.querySelector('#centralized-market-status')?.textContent).toBe('Reliable independent CEX + DEX consensus')
		expect(Array.from(document.querySelectorAll('dd'), value => value.textContent)).toEqual(['20', '21', '20.5', '5 ETH', '6 ETH', '7 ETH', '8 ETH', '2 CEX · 1 DEX'])
		expect(document.querySelectorAll('dl').length).toBe(8)
		expect(document.querySelectorAll('tbody td').length).toBe(6)
		expect(document.querySelector('script')).toBeNull()
		expect(document.querySelector('tbody td')?.textContent).toBe('<script>bad()</script>')
		for (const cell of document.querySelectorAll('tbody td')) expect(document.getElementById(cell.getAttribute('headers') ?? '')?.textContent).toBe(cell.getAttribute('data-label'))
		renderRepMarketConsensusError(document)
		expect(document.querySelector('#centralized-market-status')?.textContent).toContain('last observations')
		expect(document.querySelectorAll('tbody td').length).toBe(6)
		renderRepMarketConsensus(document, { ...market, observations: [] }, undefined)
		expect(document.querySelector('#centralized-market-status')?.textContent).toBe('stale')
		expect(document.querySelector('#centralized-market-source-count')?.textContent).toBe('0 CEX')
		expect(document.querySelector('tbody td')?.getAttribute('colspan')).toBe('6')
		expect(document.querySelector('tbody td')?.textContent).toBe('Add public exchange sources in the operator configuration.')
		renderRepMarketConsensus(document, undefined, { ...consensus, reasons: ['thin DEX depth'], reliable: false })
		expect(document.querySelector('#centralized-market-status')?.textContent).toBe('thin DEX depth')
		expect(document.querySelector('#guarded-market-price')?.textContent).toBe('—')
		expect(document.querySelector('#centralized-market-status')?.getAttribute('role')).toBe('status')
	} finally {
		Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument })
		void window.happyDOM.close()
	}
})

test('RPC fields preserve required controls and optional independent quorum endpoints', () => {
	const window = new Window()
	try {
		for (const independentQuorum of [false, true]) {
			window.document.body.innerHTML = rpcConnectivityFields({ independentQuorum, submissionLimit: 8, statusId: 'network-status' })
			expect(window.document.querySelectorAll('select').length).toBe(2)
			expect(window.document.querySelector('#read-rpc-url')?.hasAttribute('required')).toBe(true)
			expect(window.document.querySelector('#public-rpc-urls')?.hasAttribute('required')).toBe(true)
			expect(window.document.querySelector('#quorum-rpc-urls') !== null).toBe(independentQuorum)
			expect(window.document.querySelector('#network-status')?.getAttribute('aria-live')).toBe('polite')
		}
	} finally {
		void window.happyDOM.close()
	}
})
