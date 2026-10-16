/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { UniverseIdentity } from '@zoltar/ui-core-shared/components/UniverseIdentity.js'
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

	test('recovers from oversized universe URLs and renders the maximum uint248 identity', async () => {
		const overflow = 1n << 248n
		const maximum = overflow - 1n
		window.history.replaceState({}, '', `/#/zoltar?universe=0x${overflow.toString(16)}`)
		let hookState: ZoltarUrlState | undefined
		function Harness() {
			hookState = useZoltarUrlState()
			return <UniverseIdentity universeId={hookState.activeUniverseId} variant='backdrop' />
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		expect(requireState(hookState).activeUniverseId).toBe(0n)
		expect(rendered.container.querySelector('.universe-identity-backdrop')?.getAttribute('data-universe-id')).toBe('0')
		await act(() => {
			window.history.replaceState({}, '', `/#/zoltar?universe=${maximum}`)
			window.dispatchEvent(new Event('popstate'))
		})
		expect(requireState(hookState).activeUniverseId).toBe(maximum)
		expect(rendered.container.querySelector('.universe-identity-backdrop')?.getAttribute('data-universe-id')).toBe(maximum.toString())
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

	test('keeps the chosen fork question in the URL across views and reloads without a history entry per edit', async () => {
		window.history.replaceState({}, '', '/#/zoltar?universe=7&zoltarView=questions')
		let hookState: ZoltarUrlState | undefined
		function Harness() {
			hookState = useZoltarUrlState()
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		expect(requireState(hookState).forkQuestionId).toBe('')

		const historyLength = window.history.length
		await act(() => requireState(hookState).setForkQuestionId('0x0b'))
		expect(window.history.length).toBe(historyLength)
		expect(requireState(hookState).forkQuestionId).toBe('0x0b')
		await act(() => requireState(hookState).setZoltarView('fork'))
		expect(window.location.hash).toBe('#/zoltar?universe=7&zoltarView=fork&forkQuestion=0x0b')
		expect(requireState(hookState).forkQuestionId).toBe('0x0b')

		// A reload reads the choice back from the URL.
		await rendered.cleanup()
		hookState = undefined
		cleanupRenderedComponent = (await renderIntoDocument(<Harness />)).cleanup
		expect(requireState(hookState).forkQuestionId).toBe('0x0b')
		await act(() => requireState(hookState).setForkQuestionId(''))
		expect(window.location.hash).toBe('#/zoltar?universe=7&zoltarView=fork')
	})

	test('keeps a malformed universe in the URL so route validation can reject it instead of opening Genesis', async () => {
		for (const universe of ['abc', '-1', '']) {
			window.history.replaceState({}, '', `/#/zoltar?universe=${universe}&zoltarView=questions`)
			let hookState: ZoltarUrlState | undefined
			function Harness() {
				hookState = useZoltarUrlState()
				return <div />
			}
			const rendered = await renderIntoDocument(<Harness />)
			try {
				expect(requireState(hookState).activeUniverseId).toBe(0n)
				expect(new URLSearchParams(window.location.hash.split('?')[1]).get('universe')).toBe(universe)
				await act(() => requireState(hookState).setActiveUniverseId(3n))
				expect(window.location.hash).toBe('#/zoltar?universe=3&zoltarView=questions')
			} finally {
				await rendered.cleanup()
			}
		}
	})
})
