/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useStatoblastUrlState } from '../../app/hooks/useStatoblastUrlState.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

type UseUrlState = typeof useStatoblastUrlState
type UseUrlStateState = ReturnType<UseUrlState>

function createHarness(onRender: (state: UseUrlStateState) => void) {
	return function UrlStateHarness() {
		const state = useStatoblastUrlState()
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

const POOL_A = '0x1111111111111111111111111111111111111111'
const POOL_B = '0x2222222222222222222222222222222222222222'
const POOL_C = '0x3333333333333333333333333333333333333333'

describe('useStatoblastUrlState', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		installStatoblastRouting()
		cleanupDom = installDomEnvironment(`http://localhost/#/pools/${POOL_A}/vaults?universe=1`).cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
		resetRoutingForTesting()
	})

	async function renderHarness() {
		let hookState: UseUrlStateState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		return () => requireState(hookState)
	}

	test('loads the initial pool page from the route hash', async () => {
		const state = await renderHarness()
		expect(state().activeUniverseId).toBe(1n)
		expect(state().securityPoolsView).toBe('operate')
		expect(state().securityPoolAddress).toBe(POOL_A)
		expect(state().selectedPoolView).toBe('vaults')
	})

	test('rewrites legacy security pool links onto the pool path', async () => {
		const state = await renderHarness()
		await act(() => {
			window.location.hash = `#/security-pools?securityPool=${POOL_B}&securityPoolsView=operate&selectedPoolView=reporting&universe=2`
			window.dispatchEvent(new Event('hashchange'))
		})
		expect(window.location.hash).toBe(`#/pools/${POOL_B}/reporting?universe=2`)
		expect(state().securityPoolAddress).toBe(POOL_B)
		expect(state().selectedPoolView).toBe('reporting')
		expect(state().activeUniverseId).toBe(2n)
	})

	test('updates the pool path and query through setter callbacks', async () => {
		const state = await renderHarness()

		await act(() => state().setActiveUniverseId(7n))
		expect(window.location.hash).toBe(`#/pools/${POOL_A}/vaults?universe=7`)

		await act(() => state().setSelectedPoolView('trading'))
		expect(window.location.hash).toBe(`#/pools/${POOL_A}/trading?universe=7`)
		expect(state().selectedPoolView).toBe('trading')

		await act(() => state().setSecurityPoolAddress(POOL_C))
		expect(window.location.hash).toBe(`#/pools/${POOL_C}?universe=7`)
		expect(state().securityPoolAddress).toBe(POOL_C)
		expect(state().selectedPoolView).toBe('')

		await act(() => state().setSecurityPoolsView('operate'))
		expect(state().securityPoolAddress).toBe(POOL_C)

		await act(() => state().setSecurityPoolsView('universes'))
		expect(window.location.hash).toBe('#/pools/universes?universe=7')
		expect(state().securityPoolAddress).toBe('')

		await act(() => state().setSecurityPoolQuestionId('0x99'))
		expect(window.location.hash).toBe('#/pools/create?universe=7&questionId=0x99')
		expect(state().securityPoolQuestionId).toBe('0x99')

		await act(() => state().setSecurityPoolsView('browse'))
		expect(window.location.hash).toBe('#/pools?universe=7')

		await act(() => state().setSecurityPoolAddress(''))
		expect(window.location.hash).toBe('#/pools?universe=7')
	})

	test('keeps Open Oracle state in the query of the current route', async () => {
		const state = await renderHarness()
		window.location.hash = '#/open-oracle'
		await act(() => window.dispatchEvent(new Event('hashchange')))

		await act(() => state().setOpenOracleView('create'))
		expect(window.location.hash).toBe('#/open-oracle?openOracleView=create')
		expect(state().openOracleView).toBe('create')

		await act(() => state().setOpenOracleReport('555', 'replace'))
		expect(window.location.hash).toBe('#/open-oracle?openOracleView=selected-report&openOracleReportId=555')
		expect(state().openOracleReportId).toBe('555')
	})
})
