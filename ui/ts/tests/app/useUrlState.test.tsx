/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useUrlState } from '../../app/hooks/useUrlState.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

type UseUrlState = typeof import('../../app/hooks/useUrlState.js')['useUrlState']
type UseUrlStateState = ReturnType<UseUrlState>

function createHarness(onRender: (state: UseUrlStateState) => void) {
	return function UrlStateHarness() {
		const state = useUrlState()
		onRender(state)
		return <div />
	}
}

function requireState(state: UseUrlStateState | undefined) {
	if (state === undefined) {
		throw new Error('Hook state is unavailable')
	}

	return state
}

describe('useUrlState', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/#/open-oracle?universe=1&openOracleView=selected-report&openOracleReportId=101&securityPool=0x1111111111111111111111111111111111111111&securityPoolsView=operate&selectedPoolView=positions&zoltarView=trading').cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('loads initial URL query state from the route hash', async () => {
		let hookState: UseUrlStateState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		expect(requireState(hookState).activeUniverseId).toBe(1n)
		expect(requireState(hookState).openOracleView).toBe('selected-report')
		expect(requireState(hookState).openOracleReportId).toBe('101')
		expect(requireState(hookState).securityPoolsView).toBe('operate')
		expect(requireState(hookState).selectedPoolView).toBe('positions')
		expect(requireState(hookState).securityPoolAddress).toBe('0x1111111111111111111111111111111111111111')
		expect(requireState(hookState).zoltarView).toBe('trading')
	})

	test('synchronizes hook state with hashchange and popstate events', async () => {
		let hookState: UseUrlStateState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			window.location.hash = '#/security-pools?securityPool=0x2222222222222222222222222222222222222222&openOracleReportId=202'
			window.dispatchEvent(new Event('hashchange'))
		})

		expect(requireState(hookState).activeUniverseId).toBe(0n)
		expect(requireState(hookState).securityPoolAddress).toBe('0x2222222222222222222222222222222222222222')
		expect(requireState(hookState).openOracleReportId).toBe('202')
	})

	test('updates route-backed params through setter callbacks', async () => {
		let hookState: UseUrlStateState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireState(hookState).setActiveUniverseId(7n)
		})
		expect(window.location.hash.includes('universe=7')).toBe(true)
		expect(requireState(hookState).activeUniverseId).toBe(7n)

		await act(() => {
			requireState(hookState).setActiveUniverseId(undefined)
		})
		expect(window.location.hash.includes('universe=')).toBe(false)

		await act(() => {
			requireState(hookState).setSecurityPoolAddress('0x3333333333333333333333333333333333333333')
		})
		expect(window.location.hash.includes('securityPool=0x3333333333333333333333333333333333333333')).toBe(true)
		expect(window.location.hash.includes('securityPoolsView=operate')).toBe(true)

		await act(() => {
			requireState(hookState).setSecurityPoolsView('history')
		})
		expect(window.location.hash.includes('securityPoolsView=history')).toBe(true)
		expect(window.location.hash.includes('securityPool=')).toBe(false)
		expect(window.location.hash.includes('selectedPoolView=')).toBe(false)

		await act(() => {
			requireState(hookState).setSelectedPoolView('positions')
		})
		expect(window.location.hash.includes('selectedPoolView=positions')).toBe(true)
		expect(window.location.hash.includes('securityPoolsView=operate')).toBe(true)

		await act(() => {
			requireState(hookState).setOpenOracleView('trading')
		})
		expect(window.location.hash.includes('openOracleView=trading')).toBe(true)
		expect(window.location.hash.includes('openOracleReportId')).toBe(false)
		expect(requireState(hookState).openOracleView).toBe('trading')

		await act(() => {
			requireState(hookState).setOpenOracleReport('555')
		})
		expect(window.location.hash.includes('openOracleReportId=555')).toBe(true)
		expect(window.location.hash.includes('openOracleView=selected-report')).toBe(true)
		expect(requireState(hookState).openOracleReportId).toBe('555')

		await act(() => {
			requireState(hookState).setZoltarView('deploy')
		})
		expect(window.location.hash.includes('zoltarView=deploy')).toBe(true)
	})
})
