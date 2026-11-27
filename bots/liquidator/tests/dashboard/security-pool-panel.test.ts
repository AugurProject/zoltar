import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { renderSecurityPools } from '../../src/dashboard/security-pool-panel.tsx'
import { decodeSnapshot } from '../../src/dashboard/api-validation.ts'
import { securityPoolViews } from '../../src/state/security-pool-view.ts'
import { initialRuntimeState, operatorSnapshot } from '../../src/state/operator-state.ts'
import { ownerAddress, securityPoolObservation, securityPoolSettings } from '../support/security-pool-observation.ts'

function snapshot() {
	const state = initialRuntimeState(true, ownerAddress, 1)
	const observation = securityPoolObservation()
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	position.stalledRetirement = true
	position.retirementStatus = 'Capacity reserved for earlier requests'
	observation.positions.push({ ...position, id: 9n, auctionTarget: { auction: observation.selection.address, bidId: 9n, bidder: position.owner }, retirementStatus: 'No pending reduction', stalledRetirement: false })
	observation.knownAuctionBidCount = 512n
	observation.nextScope.auctionAfterBidId = 33n
	state.securityPools = [observation]
	return { ...operatorSnapshot(state, false), securityPools: securityPoolViews(state, securityPoolSettings()) }
}

test('security pool dashboard response validates nested observations and owner exposure', () => {
	const value = snapshot()
	expect(decodeSnapshot(value).securityPools?.[0]?.knownPositionCount).toBe('1')
	expect(() => decodeSnapshot({ ...value, securityPools: [{ ...value.securityPools[0], positions: [{ id: '1', distressed: 'yes' }] }] })).toThrow('invalid state snapshot')
})

test('security pool panel shows explicit automation and retirement blockers, empty and stale states', async () => {
	const window = new Window()
	const previous = Reflect.get(globalThis, 'document')
	try {
		Reflect.set(globalThis, 'document', window.document)
		window.document.body.innerHTML = '<div id="security-pool-monitor"></div>'
		const securityPools = snapshot().securityPools
		const first = securityPools[0]
		if (first === undefined) throw new Error('Fixture security pool missing')
		const twoSecurityPools = [first, { ...first, universeId: '7', knownPositionCount: '82', nextPositionId: '65' }]
		renderSecurityPools(twoSecurityPools)
		const disclosure = window.document.querySelector('details')
		expect(disclosure).not.toBeNull()
		expect(disclosure?.open).toBe(false)
		expect(disclosure?.querySelector('summary')).not.toBeNull()
		expect(window.document.querySelectorAll('details')).toHaveLength(1)
		expect(window.document.querySelectorAll('article')).toHaveLength(2)
		expect(window.document.querySelector('article details')).toBeNull()
		if (disclosure === null) throw new Error('Monitoring disclosure missing')
		disclosure.open = true
		renderSecurityPools(twoSecurityPools)
		expect(disclosure.open).toBe(true)
		expect(window.document.body.textContent).not.toContain('Execution reserve')
		expect(window.document.body.textContent).toContain('Retirement stalled: Capacity reserved for earlier requests')
		expect(window.document.body.textContent).toContain('Automation disabled')
		expect(window.document.body.textContent).toContain('Independent REP price')
		expect(window.document.body.textContent).toContain('Auction bid 9 · bidder position after claim')
		expect(window.document.body.textContent).toContain('Auction bids 512; winner scan after bid 33')
		expect(window.document.body.textContent).not.toContain('Position 0')
		expect(window.document.querySelector('button')).toBeNull()
		renderSecurityPools([], true)
		expect(window.document.body.textContent).toContain('observations are stale')
		expect(window.document.body.textContent).toContain('No managed security pool observations yet')
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, 'document')
		else Reflect.set(globalThis, 'document', previous)
		await window.happyDOM.close()
	}
})

test('automation badges require live mode, selection, universe approval and an unpaused operator', () => {
	const state = initialRuntimeState(false, ownerAddress, 1)
	const observation = securityPoolObservation()
	state.securityPools = [observation]
	const settings = securityPoolSettings()
	settings.runtime.execute = true
	const enabled = () => securityPoolViews(state, settings)[0]?.automation
	expect(enabled()).toBe(true)
	settings.runtime.execute = false
	expect(enabled()).toBe(false)
	settings.runtime.execute = true
	observation.selected = false
	expect(enabled()).toBe(false)
	observation.selected = true
	observation.approvedUniverse = false
	expect(enabled()).toBe(false)
	observation.approvedUniverse = true
	state.paused = true
	expect(enabled()).toBe(false)
})
