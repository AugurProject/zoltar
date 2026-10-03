/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { appQueryCache } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { UseSecurityPoolsOverviewDependencies } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import { createCoordinatorFundingRequirement, createSecurityPoolsOverviewDependencies, renderSecurityPoolsOverviewHook, type TestSecurityPoolsOverviewWriteClient } from './testSupport/securityPoolsOverviewDependencies.js'
import { createSelectedPool } from './workflow/builders.js'

function createListedSecurityPool(questionId: string, securityPoolAddress: Address = zeroAddress): ListedSecurityPool {
	return createSelectedPool({ marketDetails: createMarketDetails({ description: `Description for ${questionId}`, questionId, title: `Question ${questionId}` }), questionId, securityPoolAddress })
}

const unexpectedCall = (name: string) =>
	mock(() => {
		throw new Error(`${name} should not be called in this test`)
	})
const unexpectedAsyncCall = (name: string) =>
	mock(async () => {
		throw new Error(`${name} should not be called in this test`)
	})

void describe('useSecurityPoolsOverview helpers', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		resetActiveEnvironmentForTesting()
		mock.restore()
	})

	const renderHook = async (dependencies: UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>, options: Parameters<typeof renderSecurityPoolsOverviewHook>[1] = {}) => {
		const hook = await renderSecurityPoolsOverviewHook(dependencies, options)
		cleanupRenderedComponent = hook.cleanup
		return hook
	}

	void test('does not discover pools on mount', async () => {
		const loadSecurityPoolLineage = unexpectedAsyncCall('loadSecurityPoolLineage')
		await renderHook(createSecurityPoolsOverviewDependencies({ loadSecurityPoolLineage }))
		expect(loadSecurityPoolLineage).not.toHaveBeenCalled()
	})

	void test('loads only the checked pool lineage for workflow details', async () => {
		const selectedAddress = getAddress('0x0000000000000000000000000000000000000001')
		const selectedPools = [createListedSecurityPool('0x01', selectedAddress)]
		const loadSecurityPoolLineage = mock(async () => selectedPools)
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				createWalletWriteClient: unexpectedCall('createWalletWriteClient'),
				loadSecurityPoolLineage,
				queueSecurityPoolLiquidation: unexpectedAsyncCall('queueSecurityPoolLiquidation'),
			}),
		)

		await act(async () => {
			await state().loadSecurityPools(selectedAddress)
		})

		expect(loadSecurityPoolLineage).toHaveBeenCalledWith(selectedAddress, zeroAddress, expect.objectContaining({ read: expect.any(Function) }))
		expect(state().securityPools.map(pool => pool.questionId)).toEqual(['0x01'])
	})

	void test('applies a confirmed vault pool total before the lineage refresh completes', async () => {
		const selectedAddress = getAddress('0x0000000000000000000000000000000000000001')
		const initial = createListedSecurityPool('0x01', selectedAddress)
		const refresh = createDeferred<ListedSecurityPool[]>()
		let reads = 0
		const { state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadSecurityPoolLineage: async () => (++reads === 1 ? [initial] : await refresh.promise) }))
		await act(async () => await state().loadSecurityPools(selectedAddress))
		let pending: Promise<void> | undefined
		await act(() => {
			pending = state().refreshSecurityPools()
		})
		await act(() => state().updatePoolCommitment(selectedAddress, 388n * 10n ** 18n))
		expect(state().securityPools[0]?.totalUnderwritingLimitAttoEth).toBe(388n * 10n ** 18n)
		await act(async () => {
			refresh.resolve([initial])
			await pending
		})
		expect(state().securityPools[0]?.totalUnderwritingLimitAttoEth).toBe(388n * 10n ** 18n)
	})

	void test.each(['explicit load', 'background refresh'])('a slow lineage refresh never overwrites a newer %s', async newerRead => {
		const selectedAddress = getAddress('0x0000000000000000000000000000000000000001')
		const staleRefresh = createDeferred<ListedSecurityPool[]>()
		let lineageReads = 0
		const loadSecurityPoolLineage = mock(async () => {
			lineageReads += 1
			if (lineageReads === 1) return [createListedSecurityPool('0x01', selectedAddress)]
			if (lineageReads === 2) return [createListedSecurityPool('0x02', selectedAddress)]
			if (lineageReads === 3) return await staleRefresh.promise
			return [createListedSecurityPool('0x04', selectedAddress)]
		})
		const { state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadSecurityPoolLineage }))
		await act(async () => {
			await state().loadSecurityPools(selectedAddress)
		})
		expect(state().securityPoolsFreshness.updatedAt).toBeNumber()

		// An in-place refresh replaces the pools without the explicit loading state.
		await act(async () => {
			await state().refreshSecurityPools()
		})
		expect(state().securityPools.map(pool => pool.questionId)).toEqual(['0x02'])
		expect(state().loadingSecurityPools).toBe(false)

		// A refresh still in flight when a newer read commits is discarded.
		let pendingRefresh: Promise<void> | undefined
		await act(() => {
			pendingRefresh = state().refreshSecurityPools()
		})
		await act(async () => {
			if (newerRead === 'explicit load') await state().loadSecurityPools(selectedAddress)
			else {
				appQueryCache.invalidateAll('block')
				void state().refreshSecurityPools()
				expect(lineageReads).toBe(3)
			}
		})
		if (newerRead === 'explicit load') expect(state().securityPools.map(pool => pool.questionId)).toEqual(['0x04'])
		await act(async () => {
			staleRefresh.resolve([createListedSecurityPool('0x03', selectedAddress)])
			await pendingRefresh
		})
		expect(state().securityPools.map(pool => pool.questionId)).toEqual([newerRead === 'explicit load' ? '0x04' : '0x03'])
		appQueryCache.clear()
	})

	void test('stops background lineage follow-up RPC reads after unmount', async () => {
		const firstRead = createDeferred<void>()
		let loads = 0
		let followupReads = 0
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadSecurityPoolLineage: mock(async (_address, _account, operation) => {
				if (++loads === 1) return []
				if (operation === undefined) throw new Error('Missing read operation')
				await operation.read(() => firstRead.promise)
				await operation.read(async () => ++followupReads)
				return []
			}),
		})
		const rendered = await renderHook(dependencies)
		const { state } = rendered
		await act(async () => await state().loadSecurityPools('0x0000000000000000000000000000000000000001'))
		let pending: Promise<void> | undefined
		await act(() => {
			pending = state().refreshSecurityPools()
		})
		expect(loads).toBe(2)
		await rendered.cleanup()
		cleanupRenderedComponent = undefined
		firstRead.resolve()
		await pending
		expect(followupReads).toBe(0)
		appQueryCache.clear()
	})

	void test('marks prior-environment pool results stale until the current environment loads', async () => {
		const firstLoad = createDeferred<ListedSecurityPool[]>()
		const selectedAddress = getAddress('0x0000000000000000000000000000000000000001')
		const loadSecurityPoolLineage = mock(async () => (loadSecurityPoolLineage.mock.calls.length === 1 ? await firstLoad.promise : [createListedSecurityPool('0x02')]))
		const { rerender, state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadSecurityPoolLineage }), { environmentRefreshKey: 0 })

		const staleLoadPromise = state().loadSecurityPools(selectedAddress)
		await rerender({ environmentRefreshKey: 1 })
		firstLoad.resolve([createListedSecurityPool('0x01')])
		await staleLoadPromise

		expect(state().hasLoadedSecurityPools).toBe(false)
		expect(state().securityPoolsLoadedEnvironmentRefreshKey).toBe(0)
		await act(async () => {
			await state().loadSecurityPools(selectedAddress)
		})
		expect(state().hasLoadedSecurityPools).toBe(true)
		expect(state().securityPools.map(pool => pool.questionId)).toEqual(['0x02'])
	})

	describe('queueLiquidation with a pending wallet balance read', () => {
		// Starts a two-minute, one-ETH liquidation whose preflight waits on the wallet ETH balance.
		const startLiquidationAwaitingBalance = async (queueSecurityPoolLiquidation: UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>['queueSecurityPoolLiquidation'], managerAddress: Address, securityPoolAddress: Address, targetVault: Address) => {
			const walletBalance = createDeferred<bigint>()
			const readClient = { getBalance: mock(async () => await walletBalance.promise) }
			installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: zeroAddress }))
			const { state } = await renderHook(
				createSecurityPoolsOverviewDependencies({
					createConnectedReadClient: mock(() => readClient),
					loadCoordinatorInitialReportFundingRequirement: mock(async () => createCoordinatorFundingRequirement({ reputationTokenAddress: zeroAddress })),
					loadOracleManagerQueueOperationEthValue: mock(async () => 1n),
					queueSecurityPoolLiquidation,
				}),
			)

			await act(async () => {
				state().openLiquidationModal(managerAddress, securityPoolAddress, targetVault)
				state().setLiquidationAmount('1')
				state().setLiquidationTimeoutMinutes('2')
			})

			let queuePromise = Promise.resolve()
			await act(() => {
				queuePromise = state().queueLiquidation(managerAddress, securityPoolAddress)
			})

			await waitFor(() => {
				expect(readClient.getBalance).toHaveBeenCalledTimes(1)
			})
			const finishPreflight = async () => {
				await act(async () => {
					walletBalance.resolve(2n * 10n ** 18n)
					await queuePromise
				})
			}
			return { finishPreflight, state }
		}

		void test('queueLiquidation snapshots the submitted modal inputs before async preflight completes', async () => {
			const managerAddressA = getAddress('0x00000000000000000000000000000000000000a1')
			const managerAddressB = getAddress('0x00000000000000000000000000000000000000b1')
			const securityPoolAddressA = getAddress('0x00000000000000000000000000000000000000a2')
			const securityPoolAddressB = getAddress('0x00000000000000000000000000000000000000b2')
			const targetVaultA = getAddress('0x00000000000000000000000000000000000000a3')
			const targetVaultB = getAddress('0x00000000000000000000000000000000000000b3')
			const queueSecurityPoolLiquidation = mock(async (_client: unknown, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint) => {
				expect(managerAddress).toBe(managerAddressA)
				expect(targetVault).toBe(targetVaultA)
				expect(amount).toBe(1n * 10n ** 18n)
				expect(validForSeconds).toBe(120n)
				return { hash: zeroHash }
			})
			const { finishPreflight, state } = await startLiquidationAwaitingBalance(queueSecurityPoolLiquidation, managerAddressA, securityPoolAddressA, targetVaultA)

			await act(async () => {
				state().openLiquidationModal(managerAddressB, securityPoolAddressB, targetVaultB)
				state().setLiquidationAmount('3')
				state().setLiquidationTimeoutMinutes('5')
			})
			await finishPreflight()

			expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
			expect(state().liquidationTargetVault).toBe(targetVaultB)
			expect(state().liquidationDebtEthAmount).toBe('3')
			expect(state().liquidationTimeoutMinutes).toBe('5')
		})

		void test('queueLiquidation ignores stale modal errors after the amount and timeout inputs change', async () => {
			const queueSecurityPoolLiquidation = mock(async () => {
				throw new Error('liquidation reverted')
			})
			const { finishPreflight, state } = await startLiquidationAwaitingBalance(queueSecurityPoolLiquidation, getAddress('0x00000000000000000000000000000000000000c1'), getAddress('0x00000000000000000000000000000000000000c2'), getAddress('0x00000000000000000000000000000000000000c3'))

			await act(async () => {
				state().setLiquidationAmount('3')
				state().setLiquidationTimeoutMinutes('5')
			})
			await finishPreflight()

			expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
			expect(state().liquidationDebtEthAmount).toBe('3')
			expect(state().liquidationTimeoutMinutes).toBe('5')
			expect(state().securityPoolLiquidationError).toBeUndefined()
			expect(state().securityPoolOverviewFeedback?.status.tone).toBe('error')
			expect(state().securityPoolOverviewFeedback?.status.detail).toContain('liquidation reverted')
		})
	})
})
