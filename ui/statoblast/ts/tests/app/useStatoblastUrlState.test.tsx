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

	test('lands on Browse pools before the default route hash is installed', async () => {
		window.history.replaceState({}, '', '/')
		const state = await renderHarness()
		expect(state().securityPoolsView).toBe('browse')
		expect(state().securityPoolAddress).toBe('')
		await act(() => state().setSecurityPoolsView('create'))
		expect(window.location.hash).toBe('#/pools/create')
		expect(state().securityPoolsView).toBe('create')
		await act(() => state().setSecurityPoolsView('browse'))
		expect(window.location.hash).toBe('#/pools')
	})

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

	test('replaces history while a question ID is typed and pushes when leaving another view', async () => {
		window.history.replaceState({}, '', '/#/pools?universe=1')
		const originalPushState = window.history.pushState.bind(window.history)
		const originalReplaceState = window.history.replaceState.bind(window.history)
		let pushes = 0
		let replaces = 0
		window.history.pushState = (...parameters: Parameters<History['pushState']>) => {
			pushes += 1
			return originalPushState(...parameters)
		}
		window.history.replaceState = (...parameters: Parameters<History['replaceState']>) => {
			replaces += 1
			return originalReplaceState(...parameters)
		}
		try {
			const state = await renderHarness()
			pushes = 0
			replaces = 0
			await act(() => state().setSecurityPoolQuestionId('0x1'))
			expect(pushes).toBe(1)
			for (const questionId of ['0x12', '0x123', '0x1234']) await act(() => state().setSecurityPoolQuestionId(questionId))
			expect(pushes).toBe(1)
			expect(replaces).toBe(3)
			expect(window.location.hash).toBe('#/pools/create?universe=1&questionId=0x1234')
			await act(() => state().setSecurityPoolQuestionId(''))
			expect(pushes).toBe(1)
			expect(window.location.hash).toBe('#/pools/create?universe=1')
			await act(() => {
				window.history.back()
				window.dispatchEvent(new Event('popstate'))
			})
			expect(state().securityPoolsView).toBe('browse')
		} finally {
			window.history.pushState = originalPushState
			window.history.replaceState = originalReplaceState
		}
	})

	test('opens a pool in another universe with one history entry', async () => {
		const state = await renderHarness()
		await act(() => state().setVaultAddress(POOL_C))
		await act(() => state().setVaultView('vault-by-address'))
		const originalPushState = window.history.pushState.bind(window.history)
		let pushes = 0
		window.history.pushState = (...parameters: Parameters<History['pushState']>) => {
			pushes += 1
			return originalPushState(...parameters)
		}
		try {
			await act(() => state().openSecurityPoolInUniverse(3n, POOL_B))
			expect(pushes).toBe(1)
			expect(window.location.hash).toBe(`#/pools/${POOL_B}?universe=3`)
			expect(state().vaultAddress).toBeUndefined()
			expect(state().vaultView).toBeUndefined()
			expect(state().activeUniverseId).toBe(3n)
			expect(state().securityPoolAddress).toBe(POOL_B)
			await act(() => {
				window.history.back()
				window.dispatchEvent(new Event('popstate'))
			})
			expect(state().activeUniverseId).toBe(1n)
			expect(state().securityPoolAddress).toBe(POOL_A)
		} finally {
			window.history.pushState = originalPushState
		}
	})

	test('keeps OpenOracle state in the query of the current route', async () => {
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
	test('restores browser and vault selections through history and clears vaults for another pool', async () => {
		const state = await renderHarness()
		await act(() => state().setPoolBrowseState({ searchText: 'pool one', sortKey: 'endTime', stateFilter: 'ended' }))
		await act(() => state().setVaultAddress(POOL_B))
		await act(() => state().setVaultView('vault-by-address'))
		expect(state().poolBrowseState).toEqual({ searchText: 'pool one', sortKey: 'endTime', stateFilter: 'ended' })
		expect(state().vaultAddress).toBe(POOL_B)
		expect(state().vaultView).toBe('vault-by-address')
		const savedHash = window.location.hash
		await act(() => state().setSecurityPoolAddress(POOL_C))
		expect(state().vaultAddress).toBeUndefined()
		expect(state().vaultView).toBeUndefined()
		expect(state().poolBrowseState.searchText).toBe('pool one')
		await act(() => {
			window.history.replaceState({}, '', savedHash)
			window.dispatchEvent(new Event('popstate'))
		})
		expect(state().vaultAddress).toBe(POOL_B)
		expect(state().vaultView).toBe('vault-by-address')
		await act(() => state().setVaultView('selected-vault'))
		expect(state().vaultAddress).toBeUndefined()
		await act(() => state().setPoolBrowseState({ searchText: '', stateFilter: 'all', sortKey: 'recent' }))
		expect(new URLSearchParams(window.location.hash.split('?')[1]).has('poolSearch')).toBe(false)
	})

	test('reads universe from page parameters and permits a hash override', async () => {
		window.history.replaceState({}, '', '/?universe=7#/pools')
		const state = await renderHarness()
		expect(state().activeUniverseId).toBe(7n)
		await act(() => state().setActiveUniverseId(9n))
		expect(state().activeUniverseId).toBe(9n)
		await act(() => {
			window.history.replaceState({}, '', '/?universe=7#/pools?universe=7')
			window.dispatchEvent(new Event('popstate'))
		})
		expect(state().activeUniverseId).toBe(7n)
	})

	test('ignores invalid enum and address parameters', async () => {
		window.history.replaceState({}, '', '#/pools?poolFilter=bad&poolSort=bad&vault=0x123&vaultView=bad')
		const state = await renderHarness()
		expect(state().poolBrowseState).toEqual({ searchText: '', sortKey: 'recent', stateFilter: 'all' })
		expect(state().vaultAddress).toBeUndefined()
		expect(state().vaultView).toBeUndefined()
	})
	test('opens an address-only vault link in By address and keeps My vault wallet-relative', async () => {
		window.history.replaceState({}, '', '#/pools/' + POOL_A + '?vault=' + POOL_B)
		const state = await renderHarness()
		expect(state().vaultAddress).toBe(POOL_B)
		expect(state().vaultView).toBe('vault-by-address')
		await act(() => {
			window.history.replaceState({}, '', '#/pools/' + POOL_A + '?vault=' + POOL_B + '&vaultView=selected-vault')
			window.dispatchEvent(new Event('popstate'))
		})
		expect(state().vaultAddress).toBeUndefined()
		expect(state().vaultView).toBe('selected-vault')
	})
})
