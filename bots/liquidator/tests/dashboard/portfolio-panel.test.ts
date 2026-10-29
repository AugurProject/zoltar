import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { renderPortfolios } from '../../src/dashboard/portfolio-panel.tsx'
import { decodeSnapshot } from '../../src/dashboard/api-validation.ts'
import { portfolioViews } from '../../src/state/portfolio-view.ts'
import { initialRuntimeState, operatorSnapshot } from '../../src/state/operator-state.ts'
import { ownerAddress, portfolioObservation, portfolioSettings } from '../support/portfolio-observation.ts'

function snapshot() {
	const state = initialRuntimeState(true, ownerAddress, 1)
	const observation = portfolioObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	position.executionReserveAttoEth = 0n
	position.stalledRetirement = true
	position.retirementStatus = 'Earlier requests reserve available capacity'
	observation.positions.push({ ...position, id: 9n, auctionTarget: { auction: observation.selection.address, bidId: 9n, vault: position.owner }, retirementStatus: 'Not retiring', stalledRetirement: false })
	observation.knownAuctionBidCount = 512n
	observation.nextScope.nextAuctionBidId = 33n
	state.portfolios = [observation]
	return { ...operatorSnapshot(state, false), portfolios: portfolioViews(state, portfolioSettings()) }
}

test('portfolio dashboard response validates nested observations and owner exposure', () => {
	const value = snapshot()
	expect(decodeSnapshot(value).portfolios?.[0]?.knownPositionCount).toBe('1')
	expect(() => decodeSnapshot({ ...value, portfolios: [{ ...value.portfolios[0], positions: [{ id: '1', reserveAdequate: 'yes' }] }] })).toThrow('invalid state snapshot')
})

test('portfolio panel shows explicit automation, reserve and retirement blockers, empty and stale states', async () => {
	const window = new Window()
	const previous = Reflect.get(globalThis, 'document')
	try {
		Reflect.set(globalThis, 'document', window.document)
		window.document.body.innerHTML = '<div id="portfolio-monitor"></div>'
		const portfolios = snapshot().portfolios
		const first = portfolios[0]
		if (first === undefined) throw new Error('Fixture portfolio missing')
		const twoPortfolios = [first, { ...first, universeId: '7', knownPositionCount: '82', nextPositionId: '65' }]
		renderPortfolios(twoPortfolios)
		const disclosure = window.document.querySelector('details')
		expect(disclosure).not.toBeNull()
		expect(disclosure?.open).toBe(false)
		expect(disclosure?.querySelector('summary')).not.toBeNull()
		expect(window.document.querySelectorAll('details')).toHaveLength(1)
		expect(window.document.querySelectorAll('article')).toHaveLength(2)
		expect(window.document.querySelector('article details')).toBeNull()
		if (disclosure === null) throw new Error('Monitoring disclosure missing')
		disclosure.open = true
		renderPortfolios(twoPortfolios)
		expect(disclosure.open).toBe(true)
		expect(window.document.body.textContent).toContain('Underfunded')
		expect(window.document.body.textContent).toContain('Retirement stalled: Earlier requests')
		expect(window.document.body.textContent).toContain('Automation enabled')
		expect(window.document.body.textContent).toContain('Independent REP price')
		expect(window.document.body.textContent).toContain('Auction bid 9 · awaiting individual position')
		expect(window.document.body.textContent).toContain('Auction bids 512; next bid cursor 33')
		expect(window.document.body.textContent).not.toContain('Position 0')
		expect(window.document.querySelector('button')).toBeNull()
		renderPortfolios([], true)
		expect(window.document.body.textContent).toContain('observations are stale')
		expect(window.document.body.textContent).toContain('No managed portfolio observations yet')
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Reflect.set(globalThis, 'document', previous)
		await window.happyDOM.close()
	}
})
