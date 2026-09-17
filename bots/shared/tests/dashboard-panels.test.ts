import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { repMarketConsensusPanel, renderRepMarketConsensusPanel, renderRepMarketConsensusError } from '../src/dashboard/rep-market-consensus.ts'
import { rpcConnectivityFields } from '../src/dashboard/rpc-connectivity.ts'

const values = { cexPrice: '20', dexPrice: '21', guardedPrice: '20.5', dexBidDepth: '5 ETH', dexAskDepth: '6 ETH', cexBidDepth: '7 ETH', cexAskDepth: '8 ETH', sources: '2 CEX · 1 DEX' }

test('consensus panel renders metrics, safe observation text, empty states and retained refresh failures', () => {
	const window = new Window()
	const previousDocument = globalThis.document
	Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document })
	try {
		document.body.innerHTML = repMarketConsensusPanel()
		expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
		renderRepMarketConsensusError(document)
		expect(document.querySelector('td')?.textContent).toContain('unavailable')
		const model = { values, status: 'Reliable', emptyText: 'No observations', observations: [{ exchange: '<script>bad()</script>', market: 'REP/ETH', price: '20', bidDepth: '7 ETH', askDepth: '8 ETH', observed: '12:00' }] }
		renderRepMarketConsensusPanel(document, model)
		expect(document.querySelectorAll('dl').length).toBe(8)
		expect(document.querySelectorAll('tbody td').length).toBe(6)
		expect(document.querySelector('script')).toBeNull()
		expect(document.querySelector('tbody td')?.textContent).toBe('<script>bad()</script>')
		for (const cell of document.querySelectorAll('tbody td')) expect(document.getElementById(cell.getAttribute('headers') ?? '')?.textContent).toBe(cell.getAttribute('data-label'))
		renderRepMarketConsensusError(document)
		expect(document.querySelector('#centralized-market-status')?.textContent).toContain('last observations')
		expect(document.querySelectorAll('tbody td').length).toBe(6)
		renderRepMarketConsensusPanel(document, { ...model, observations: [] })
		expect(document.querySelector('tbody td')?.getAttribute('colspan')).toBe('6')
		expect(document.querySelector('tbody td')?.textContent).toBe('No observations')
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
