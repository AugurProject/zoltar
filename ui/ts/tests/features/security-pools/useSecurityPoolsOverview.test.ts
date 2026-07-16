/// <reference types='bun-types' />

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { h, type ComponentChildren } from 'preact'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/shared/ethereum'
import { createSecurityPoolPageFromLoadedPools, shouldFallbackToAllSecurityPoolsPage, useSecurityPoolsOverview, type UseSecurityPoolsOverviewDependencies } from '../../../features/security-pools/hooks/useSecurityPoolsOverview.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import type { ListedSecurityPool, MarketDetails } from '../../../types/contracts.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { waitFor } from '../../testUtils/queries'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { createSecurityPoolsOverviewDependencies, type TestSecurityPoolsOverviewWriteClient } from './testSupport/securityPoolsOverviewDependencies.js'

type UseSecurityPoolsOverviewState = ReturnType<typeof useSecurityPoolsOverview>

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

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

function createHarness(dependencies: UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>, onRender: (state: UseSecurityPoolsOverviewState) => void) {
	return function SecurityPoolsOverviewHarness({ environmentRefreshKey = 0 }: { children?: ComponentChildren; environmentRefreshKey?: number }) {
		const state = useSecurityPoolsOverview(
			{
				accountAddress: zeroAddress,
				environmentRefreshKey,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			},
			dependencies,
		)

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

	void test('recovers registry page no-data reads by rereading current registry context', async () => {
		const initialPools = [createListedSecurityPool('0x01', '0x0000000000000000000000000000000000000001')]
		const currentPools = [createListedSecurityPool('0x02', '0x0000000000000000000000000000000000000002'), createListedSecurityPool('0x03', '0x0000000000000000000000000000000000000003'), createListedSecurityPool('0x04', '0x0000000000000000000000000000000000000004')]
		let allPoolsLoadCount = 0
		const loadAllSecurityPools = mock(async () => {
			allPoolsLoadCount += 1
			return allPoolsLoadCount === 1 ? initialPools : currentPools
		})
		const loadSecurityPoolPage = mock(async () => {
			throw new Error('Contract function returned no data for registry page')
		})

		const dependencies = createSecurityPoolsOverviewDependencies({
			createWalletWriteClient: mock(() => {
				throw new Error('createWalletWriteClient should not be called in this test')
			}),
			loadAllSecurityPools,
			loadSecurityPoolPage,
			queueSecurityPoolLiquidation: mock(async () => {
				throw new Error('queueSecurityPoolLiquidation should not be called in this test')
			}),
		})

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadSecurityPools()
		})

		expect(allPoolsLoadCount).toBe(1)
		expect(requireHookState(hookState).securityPools.map(pool => pool.questionId)).toEqual(['0x01'])

		await act(async () => {
			await requireHookState(hookState).loadBrowseSecurityPoolPage(1, 2, 'current-request')
		})

		expect(allPoolsLoadCount).toBe(2)
		expect(loadSecurityPoolPage).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).securityPoolOverviewError).toBeUndefined()
		expect(requireHookState(hookState).securityPoolBrowseCount).toBe(3n)
		expect(requireHookState(hookState).securityPoolPage?.requestKey).toBe('current-request')
		expect(requireHookState(hookState).securityPoolPage?.pools.map(pool => pool.questionId)).toEqual(['0x04'])
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

		const dependencies = createSecurityPoolsOverviewDependencies({
			createWalletWriteClient: mock(() => {
				throw new Error('createWalletWriteClient should not be called in this test')
			}),
			loadAllSecurityPools: mock(async () => {
				throw new Error('loadAllSecurityPools should not be called in this test')
			}),
			loadSecurityPoolPage,
			queueSecurityPoolLiquidation: mock(async () => {
				throw new Error('queueSecurityPoolLiquidation should not be called in this test')
			}),
			waitForSecurityPoolReadBackend: async () => {
				await readyPromise
			},
		})

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadBrowseSecurityPoolPage(0, 2, 'ready-request')
		})

		expect(loadSecurityPoolPage).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).securityPoolOverviewError).toBeUndefined()
		expect(requireHookState(hookState).securityPoolPage?.pools.map(pool => pool.questionId)).toEqual(['0x01'])
	})

	void test('marks prior-environment pool results stale until the current environment loads', async () => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		const firstLoad = createDeferred<ListedSecurityPool[]>()
		const loadAllSecurityPools = mock(async () => (loadAllSecurityPools.mock.calls.length === 1 ? await firstLoad.promise : [createListedSecurityPool('0x02')]))
		const dependencies = createSecurityPoolsOverviewDependencies({ loadAllSecurityPools })
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, { environmentRefreshKey: 0 }))
		cleanupRenderedComponent = renderedComponent.cleanup

		const staleLoadPromise = requireHookState(hookState).loadSecurityPools()
		await act(() => {
			render(h(Harness, { environmentRefreshKey: 1 }), renderedComponent.container)
		})
		firstLoad.resolve([createListedSecurityPool('0x01')])
		await staleLoadPromise

		expect(requireHookState(hookState).hasLoadedSecurityPools).toBe(false)
		expect(requireHookState(hookState).securityPoolsLoadedEnvironmentRefreshKey).toBe(0)
		await act(async () => {
			await requireHookState(hookState).loadSecurityPools()
		})
		expect(requireHookState(hookState).hasLoadedSecurityPools).toBe(true)
		expect(requireHookState(hookState).securityPools.map(pool => pool.questionId)).toEqual(['0x02'])
	})

	void test('queueLiquidation snapshots the submitted modal inputs before async preflight completes', async () => {
		const managerAddressA = getAddress('0x00000000000000000000000000000000000000a1')
		const managerAddressB = getAddress('0x00000000000000000000000000000000000000b1')
		const securityPoolAddressA = getAddress('0x00000000000000000000000000000000000000a2')
		const securityPoolAddressB = getAddress('0x00000000000000000000000000000000000000b2')
		const targetVaultA = getAddress('0x00000000000000000000000000000000000000a3')
		const targetVaultB = getAddress('0x00000000000000000000000000000000000000b3')
		const walletBalance = createDeferred<bigint>()
		const readClient = {
			getBalance: mock(async () => await walletBalance.promise),
		}
		const queueSecurityPoolLiquidation = mock(async (_client: unknown, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint) => {
			expect(managerAddress).toBe(managerAddressA)
			expect(targetVault).toBe(targetVaultA)
			expect(amount).toBe(1n * 10n ** 18n)
			expect(validForSeconds).toBe(120n)
			return {
				hash: zeroHash,
			}
		})

		installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: zeroAddress }))
		const dependencies = createSecurityPoolsOverviewDependencies({
			createConnectedReadClient: mock(() => readClient),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 1n,
				currentWethBalance: 1n,
				initialReportAmount2: 1n,
				maximumInitialWeth: 1n,
				minimumToken1Report: 1n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: zeroAddress,
				requestedInitialWeth: 0n,
				wethShortfall: 0n,
			})),
			loadOracleManagerQueueOperationEthValue: mock(async () => 1n),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation,
		})

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).openLiquidationModal(managerAddressA, securityPoolAddressA, targetVaultA, 5n * 10n ** 18n)
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('2')
		})

		let queuePromise = Promise.resolve()
		await act(() => {
			queuePromise = requireHookState(hookState).queueLiquidation(managerAddressA, securityPoolAddressA)
		})

		await waitFor(() => {
			expect(readClient.getBalance).toHaveBeenCalledTimes(1)
		})

		await act(async () => {
			requireHookState(hookState).openLiquidationModal(managerAddressB, securityPoolAddressB, targetVaultB, 7n * 10n ** 18n)
			requireHookState(hookState).setLiquidationAmount('3')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		await act(async () => {
			walletBalance.resolve(2n * 10n ** 18n)
			await queuePromise
		})

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).liquidationTargetVault).toBe(targetVaultB)
		expect(requireHookState(hookState).liquidationAmount).toBe('3')
		expect(requireHookState(hookState).liquidationTimeoutMinutes).toBe('5')
	})

	void test('queueLiquidation ignores stale modal errors after the amount and timeout inputs change', async () => {
		const managerAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000c2')
		const targetVault = getAddress('0x00000000000000000000000000000000000000c3')
		const walletBalance = createDeferred<bigint>()
		const readClient = {
			getBalance: mock(async () => await walletBalance.promise),
		}
		const queueSecurityPoolLiquidation = mock(async () => {
			throw new Error('liquidation reverted')
		})

		installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: zeroAddress }))
		const dependencies = createSecurityPoolsOverviewDependencies({
			createConnectedReadClient: mock(() => readClient),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 1n,
				currentWethBalance: 1n,
				initialReportAmount2: 1n,
				maximumInitialWeth: 1n,
				minimumToken1Report: 1n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: zeroAddress,
				requestedInitialWeth: 0n,
				wethShortfall: 0n,
			})),
			loadOracleManagerQueueOperationEthValue: mock(async () => 1n),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation,
		})

		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).openLiquidationModal(managerAddress, securityPoolAddress, targetVault, 5n * 10n ** 18n)
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('2')
		})

		let queuePromise = Promise.resolve()
		await act(() => {
			queuePromise = requireHookState(hookState).queueLiquidation(managerAddress, securityPoolAddress)
		})

		await waitFor(() => {
			expect(readClient.getBalance).toHaveBeenCalledTimes(1)
		})

		await act(async () => {
			requireHookState(hookState).setLiquidationAmount('3')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		await act(async () => {
			walletBalance.resolve(2n * 10n ** 18n)
			await queuePromise
		})

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).liquidationAmount).toBe('3')
		expect(requireHookState(hookState).liquidationTimeoutMinutes).toBe('5')
		expect(requireHookState(hookState).securityPoolLiquidationError).toBeUndefined()
		expect(requireHookState(hookState).securityPoolOverviewFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).securityPoolOverviewFeedback?.status.detail).toContain('liquidation reverted')
	})
})
