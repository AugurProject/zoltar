/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useHashRoute } from '../../app/hooks/useHashRoute.js'
import { useMissingDeploymentRedirect } from '../../app/hooks/useMissingDeploymentRedirect.js'
import { useUrlSearchState } from '../../app/hooks/useUrlSearchState.js'
import { installDomTestLifecycle, requireHookState } from '../testUtils/domTestLifecycle.js'
import { installTestRouting } from '../testUtils/testRouting.js'
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

describe('useHashRoute', () => {
	const { trackRendered } = installDomTestLifecycle({
		beforeTest: () => {
			installTestRouting()
		},
		url: 'http://localhost/#/zoltar?universe=7&zoltarView=create&simulate=1',
	})

	test('keeps shared state and removes source-route state when navigating between top-level routes', async () => {
		let hookState: UseHashRouteState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		trackRendered(rendered)

		await act(async () => {
			requireHookState(hookState).navigate('security-pools')
			window.dispatchEvent(new Event('hashchange'))
			await Promise.resolve()
		})

		expect(window.location.hash).toBe('#/security-pools?universe=7&simulate=1')
		expect(requireHookState(hookState).route).toBe('security-pools')
	})

	test('preserves explicitly requested return context across a cross-feature handoff', async () => {
		window.location.hash = '#/security-pools?universe=7&securityPool=0x123&securityPoolsView=operate&selectedPoolView=reporting&openOracleView=selected-report&openOracleReportId=9'
		let hookState: UseHashRouteState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		const rendered = await renderIntoDocument(<Harness />)
		trackRendered(rendered)

		await act(async () => {
			requireHookState(hookState).navigate('open-oracle', new Set(['securityPool', 'securityPoolsView', 'selectedPoolView']))
			window.dispatchEvent(new Event('hashchange'))
			await Promise.resolve()
		})

		expect(window.location.hash).toBe('#/open-oracle?universe=7&securityPool=0x123&securityPoolsView=operate&selectedPoolView=reporting&openOracleView=selected-report&openOracleReportId=9')

		await act(async () => {
			requireHookState(hookState).navigate('security-pools')
			window.dispatchEvent(new Event('hashchange'))
			await Promise.resolve()
		})

		expect(window.location.hash).toBe('#/security-pools?universe=7&securityPool=0x123&securityPoolsView=operate&selectedPoolView=reporting')
	})

	test('follows popstate so a link that changes path and search renders both together', async () => {
		const renders: string[] = []
		function Harness() {
			const { route } = useHashRoute()
			const { state: search } = useUrlSearchState(currentSearch => currentSearch)
			renders.push(`${route} ${search}`)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		trackRendered(rendered)
		renders.length = 0

		// A link or Back fires popstate before hashchange; both hooks must update from the first event.
		await act(async () => {
			window.history.pushState(null, '', '#/open-oracle?openOracleView=create')
			window.dispatchEvent(new Event('popstate'))
			await Promise.resolve()
		})

		expect(renders).toEqual(['open-oracle ?openOracleView=create'])
	})
})

describe('useHashRoute history entries', () => {
	const { trackRendered } = installDomTestLifecycle({
		beforeTest: () => {
			installTestRouting()
		},
		url: 'http://localhost/?simulate=1',
	})

	test('gives a hashless landing URL the default route in place instead of adding a history entry', async () => {
		const lengthBefore = window.history.length
		let hookState: UseHashRouteState | undefined
		const Harness = createHarness(state => {
			hookState = state
		})

		trackRendered(await renderIntoDocument(<Harness />))

		expect(window.location.hash).toBe('#/zoltar')
		expect(window.history.length).toBe(lengthBefore)
		expect(requireHookState(hookState).route).toBe('zoltar')
	})

	test('redirects to deployment by replacing the redirected entry, so Back cannot return to it', async () => {
		window.history.replaceState(null, '', '#/zoltar?universe=7')
		const lengthBefore = window.history.length
		let currentRoute: string | undefined
		function RedirectHarness() {
			const { navigate, route } = useHashRoute()
			currentRoute = route
			useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: true, navigateToDeployment: () => navigate('deploy') })
			return <div />
		}

		trackRendered(await renderIntoDocument(<RedirectHarness />))

		expect(window.location.hash).toBe('#/deploy?universe=7')
		expect(window.history.length).toBe(lengthBefore)
		expect(currentRoute).toBe('deploy')
	})
})
