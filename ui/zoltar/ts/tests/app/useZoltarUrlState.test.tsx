/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useZoltarUrlState } from '../../app/hooks/useZoltarUrlState.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

type ZoltarUrlState = ReturnType<typeof useZoltarUrlState>

function requireState(state: ZoltarUrlState | undefined) {
	if (state === undefined) throw new Error('Hook state is unavailable')
	return state
}

describe('useZoltarUrlState', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		installTestRouting()
		cleanupDom = installDomEnvironment(
			'http://localhost/#/zoltar?network=sepolia&rpcUrl=https%3A%2F%2Frpc.example&simulate=1&simScenario=deployed&simState=saved-1&universe=7&zoltarView=create&openOracleView=trading&openOracleReportId=10&securityPoolsView=operate&securityPool=0x1111111111111111111111111111111111111111',
		).cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('reads and writes only Zoltar-owned URL state', async () => {
		let hookState: ZoltarUrlState | undefined
		function Harness() {
			hookState = useZoltarUrlState()
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		expect(requireState(hookState).activeUniverseId).toBe(7n)
		expect(requireState(hookState).zoltarView).toBe('create')
		expect(window.location.hash).not.toContain('openOracle')
		expect(window.location.hash).not.toContain('securityPool')
		for (const sharedParameter of ['network=sepolia', 'rpcUrl=https%3A%2F%2Frpc.example', 'simulate=1', 'simScenario=deployed', 'simState=saved-1']) expect(window.location.hash).toContain(sharedParameter)
		await act(() => requireState(hookState).setZoltarView('questions'))
		expect(window.location.hash).toContain('universe=7')
		expect(window.location.hash).toContain('zoltarView=questions')
		expect(window.location.hash).not.toContain('openOracle')
		expect(window.location.hash).not.toContain('securityPool')
		for (const sharedParameter of ['network=sepolia', 'rpcUrl=https%3A%2F%2Frpc.example', 'simulate=1', 'simScenario=deployed', 'simState=saved-1']) expect(window.location.hash).toContain(sharedParameter)

		await act(() => requireState(hookState).setActiveUniverseId(9n))
		expect(window.location.hash).toContain('universe=9')
		expect(window.location.hash).toContain('zoltarView=questions')

		const historyLengthBeforeRecovery = window.history.length
		await act(() => requireState(hookState).replaceZoltarView('create'))
		expect(window.location.hash).toContain('zoltarView=create')
		expect(window.history.length).toBe(historyLengthBeforeRecovery)
	})
})
