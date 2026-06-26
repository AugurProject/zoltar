/// <reference types='bun-types' />

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress, type Address } from 'viem'
import { createSecurityPoolPageFromLoadedPools, shouldFallbackToAllSecurityPoolsPage } from '../hooks/useSecurityPoolsOverview.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { ListedSecurityPool, MarketDetails } from '../types/contracts.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseSecurityPoolsOverview = typeof import('../hooks/useSecurityPoolsOverview.js')['useSecurityPoolsOverview']
type UseSecurityPoolsOverviewState = ReturnType<UseSecurityPoolsOverview>

function createMarketDetails(questionId: string): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: `Description for ${questionId}`,
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId,
		startTime: 1n,
		title: `Question ${questionId}`,
	}
}

function createListedSecurityPool(questionId: string, securityPoolAddress: Address = zeroAddress): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 0n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: false,
		hasLoadedVaults: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(questionId),
		migratedRep: 0n,
		parent: zeroAddress,
		questionId,
		questionOutcome: 'none',
		securityMultiplier: 2n,
		securityPoolAddress,
		shareTokenSupply: 0n,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 0n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 0n,
		vaultCount: 0n,
		vaults: [],
	}
}

function createHarness(useSecurityPoolsOverview: UseSecurityPoolsOverview, onRender: (state: UseSecurityPoolsOverviewState) => void) {
	return function SecurityPoolsOverviewHarness() {
		const state = useSecurityPoolsOverview({
			accountAddress: zeroAddress,
			onTransactionFinished: () => undefined,
			onTransactionPresented: () => undefined,
			onTransactionRequested: () => undefined,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
		})

		onRender(state)

		return h('div', {})
	}
}

function requireHookState(state: UseSecurityPoolsOverviewState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

void describe('useSecurityPoolsOverview helpers', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		resetActiveEnvironmentForTesting()
		mock.restore()
	})

	void test('detects no-data registry reads as all-pools fallback candidates', () => {
		expect(shouldFallbackToAllSecurityPoolsPage(new Error('Contract function returned no data for 0x1234.'))).toBe(true)
		expect(shouldFallbackToAllSecurityPoolsPage(new Error('RPC timeout'))).toBe(false)
	})

	void test('builds a paginated fallback page from loaded pools', () => {
		const pools = [createListedSecurityPool('0x01'), createListedSecurityPool('0x02'), createListedSecurityPool('0x03')]
		const page = createSecurityPoolPageFromLoadedPools(pools, 1, 2)

		expect(page.pageIndex).toBe(1)
		expect(page.pageSize).toBe(2)
		expect(page.poolCount).toBe(3n)
		expect(page.pools.map(pool => pool.questionId)).toEqual(['0x03'])
	})

	void test('recovers registry page no-data reads from already loaded pools without rereading the registry', async () => {
		const loadedPools = [createListedSecurityPool('0x01', '0x0000000000000000000000000000000000000001'), createListedSecurityPool('0x02', '0x0000000000000000000000000000000000000002'), createListedSecurityPool('0x03', '0x0000000000000000000000000000000000000003')]
		let allPoolsLoadCount = 0
		const loadAllSecurityPools = mock(async () => {
			allPoolsLoadCount += 1
			if (allPoolsLoadCount > 1) throw new Error('loadAllSecurityPools should not be called for cached registry page fallback')
			return loadedPools
		})
		const loadSecurityPoolPage = mock(async () => {
			throw new Error('Contract function returned no data for registry page')
		})

		mock.module('../contracts.js', () => ({
			loadAllSecurityPools,
			loadOracleManagerDetails: mock(async () => {
				throw new Error('loadOracleManagerDetails should not be called in this test')
			}),
			loadSecurityPoolPage,
			queueSecurityPoolLiquidation: mock(async () => {
				throw new Error('queueSecurityPoolLiquidation should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({})),
			createWalletWriteClient: mock(() => {
				throw new Error('createWalletWriteClient should not be called in this test')
			}),
		}))

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		const { useSecurityPoolsOverview } = await import(`../hooks/useSecurityPoolsOverview.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(useSecurityPoolsOverview, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadSecurityPools()
		})

		await act(async () => {
			await requireHookState(hookState).loadBrowseSecurityPoolPage(1, 2)
		})

		expect(allPoolsLoadCount).toBe(1)
		expect(loadSecurityPoolPage).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).securityPoolOverviewError).toBeUndefined()
		expect(requireHookState(hookState).securityPoolBrowseCount).toBe(3n)
		expect(requireHookState(hookState).securityPoolPage?.pools.map(pool => pool.questionId)).toEqual(['0x03'])
	})

	void test('waits for active backend readiness before loading the registry page', async () => {
		let backendReady = false
		const readyPromise = Promise.resolve().then(() => {
			backendReady = true
		})
		installActiveEnvironmentForTesting({
			...createFakeBackend(),
			waitUntilReady: async () => {
				await readyPromise
			},
		})
		const loadSecurityPoolPage = mock(async () => {
			if (!backendReady) throw new Error('loadSecurityPoolPage ran before backend readiness')
			return createSecurityPoolPageFromLoadedPools([createListedSecurityPool('0x01')], 0, 2)
		})

		mock.module('../contracts.js', () => ({
			loadAllSecurityPools: mock(async () => {
				throw new Error('loadAllSecurityPools should not be called in this test')
			}),
			loadOracleManagerDetails: mock(async () => {
				throw new Error('loadOracleManagerDetails should not be called in this test')
			}),
			loadSecurityPoolPage,
			queueSecurityPoolLiquidation: mock(async () => {
				throw new Error('queueSecurityPoolLiquidation should not be called in this test')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({})),
			createWalletWriteClient: mock(() => {
				throw new Error('createWalletWriteClient should not be called in this test')
			}),
		}))

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		const { useSecurityPoolsOverview } = await import(`../hooks/useSecurityPoolsOverview.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(useSecurityPoolsOverview, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadBrowseSecurityPoolPage(0, 2)
		})

		expect(loadSecurityPoolPage).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).securityPoolOverviewError).toBeUndefined()
		expect(requireHookState(hookState).securityPoolPage?.pools.map(pool => pool.questionId)).toEqual(['0x01'])
	})
})
