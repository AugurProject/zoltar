/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useHashRoute } from '../../app/hooks/useHashRoute.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

type UseHashRoute = typeof import('../../app/hooks/useHashRoute.js')['useHashRoute']
type UseHashRouteState = ReturnType<UseHashRoute>

function createHarness(onRender: (state: UseHashRouteState) => void) {
	return function HashRouteHarness() {
		const state = useHashRoute()
		onRender(state)
		return <div />
	}
}

function requireState(state: UseHashRouteState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

describe('useHashRoute', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/#/zoltar?universe=7&zoltarView=create&simulate=1').cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('keeps shared state and removes source-route state when navigating between top-level routes', async () => {
		let hookState: UseHashRouteState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(async () => {
			requireState(hookState).navigate('security-pools')
			window.dispatchEvent(new Event('hashchange'))
			await Promise.resolve()
		})

		expect(window.location.hash).toBe('#/security-pools?universe=7&simulate=1')
		expect(requireState(hookState).route).toBe('security-pools')
	})

	test('preserves explicitly requested return context across a cross-feature handoff', async () => {
		window.location.hash = '#/security-pools?universe=7&securityPool=0x123&securityPoolsView=operate&selectedPoolView=reporting&openOracleView=selected-report&openOracleReportId=9'
		let hookState: UseHashRouteState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(async () => {
			requireState(hookState).navigate('open-oracle', new Set(['securityPool', 'securityPoolsView', 'selectedPoolView']))
			window.dispatchEvent(new Event('hashchange'))
			await Promise.resolve()
		})

		expect(window.location.hash).toBe('#/open-oracle?universe=7&securityPool=0x123&securityPoolsView=operate&selectedPoolView=reporting&openOracleView=selected-report&openOracleReportId=9')

		await act(async () => {
			requireState(hookState).navigate('security-pools')
			window.dispatchEvent(new Event('hashchange'))
			await Promise.resolve()
		})

		expect(window.location.hash).toBe('#/security-pools?universe=7&securityPool=0x123&securityPoolsView=operate&selectedPoolView=reporting')
	})
})
