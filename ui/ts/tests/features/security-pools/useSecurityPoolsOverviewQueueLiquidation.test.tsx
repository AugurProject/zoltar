/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { waitFor } from '../../testUtils/queries'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { createSecurityPoolsOverviewDependencies, type TestSecurityPoolsOverviewWriteClient } from './testSupport/securityPoolsOverviewDependencies.js'
import { useSecurityPoolsOverview, type UseSecurityPoolsOverviewDependencies } from '../../../features/security-pools/hooks/useSecurityPoolsOverview.js'
import type { GlobalTransactionPresentation } from '../../../features/types.js'

type UseSecurityPoolsOverviewState = ReturnType<typeof useSecurityPoolsOverview>
type HarnessOptions = {
	onTransactionPresented?: (presentation: GlobalTransactionPresentation) => void
}

const WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECOND_WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

function createHarness(dependencies: UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>, onRender: (state: UseSecurityPoolsOverviewState) => void, options: HarnessOptions = {}) {
	return function SecurityPoolsOverviewHarness({ accountAddress = WALLET_ADDRESS, environmentRefreshKey = 0 }: { accountAddress?: Address; children?: ComponentChildren; environmentRefreshKey?: number }) {
		const state = useSecurityPoolsOverview(
			{
				accountAddress,
				environmentRefreshKey,
				onTransactionFinished: () => undefined,
				onTransactionPresented: options.onTransactionPresented ?? (() => undefined),
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

describe('useSecurityPoolsOverview queueLiquidation', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('snapshots submitted modal inputs before async preflight completes', async () => {
		const loadOracleManagerQueueOperationEthValueDeferred = createDeferred<bigint>()
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x01' as const,
			securityPoolAddress: zeroAddress,
		}))

		const dependencies = createSecurityPoolsOverviewDependencies({
			loadOracleManagerQueueOperationEthValue: mock(async () => await loadOracleManagerQueueOperationEthValueDeferred.promise),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation,
		})

		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		const queuePromise = act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		await act(() => {
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000002')
			requireHookState(hookState).setLiquidationAmount('2')
			requireHookState(hookState).setLiquidationTimeoutMinutes('1')
		})

		loadOracleManagerQueueOperationEthValueDeferred.resolve(0n)
		await queuePromise

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledWith(expect.anything(), zeroAddress, '0x0000000000000000000000000000000000000001', 10n ** 18n, 5n * 60n)
	})

	test('ignores stale modal errors after the user edits the form', async () => {
		const loadOracleManagerQueueOperationEthValueDeferred = createDeferred<bigint>()

		const dependencies = createSecurityPoolsOverviewDependencies({
			loadOracleManagerQueueOperationEthValue: mock(async () => await loadOracleManagerQueueOperationEthValueDeferred.promise),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation: mock(async () => {
				throw new Error('stale queued liquidation failure')
			}),
		})

		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		const queuePromise = act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		await act(() => {
			requireHookState(hookState).setLiquidationAmount('2')
		})
		loadOracleManagerQueueOperationEthValueDeferred.resolve(0n)
		await queuePromise

		await waitFor(() => {
			expect(requireHookState(hookState).securityPoolLiquidationError).toBeUndefined()
		})
	})

	test('skips wallet ETH balance reads for zero-cost liquidations', async () => {
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x02' as const,
			securityPoolAddress: zeroAddress,
		}))

		const dependencies = createSecurityPoolsOverviewDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => {
					throw new Error('wallet ETH balance should not be loaded')
				},
			})),
			loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation,
		})

		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		await act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
	})

	test('loads the exact buffered queue cost and WETH wrap into one funding preview', async () => {
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 25n,
				currentWethBalance: 2n,
				initialReportAmount2: 10n,
				maximumInitialWeth: 5n,
				minimumToken1Report: 5n,
				proposedRepPerEthPrice: 2n * 10n ** 18n,
				reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
				requestedInitialWeth: 0n,
				wethShortfall: 3n,
			})),
			loadOracleManagerQueueOperationEthValue: mock(async () => 12n),
		})
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
		})
		await act(async () => {
			await requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		})

		expect(requireHookState(hookState).liquidationFundingPreview).toEqual({
			currentRepBalance: 25n,
			currentWethBalance: 2n,
			initialReportRepRequired: 10n,
			initialReportWethRequired: 5n,
			queueOperationEthValue: 12n,
			totalWalletEthRequired: 15n,
			wethShortfall: 3n,
		})
	})

	test('invalidates a resolved liquidation funding preview when the wallet changes', async () => {
		const loadCoordinatorInitialReportFundingRequirement = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _managerAddress: Address, walletAddress: Address) => ({
			currentRepBalance: walletAddress === WALLET_ADDRESS ? 25n : 50n,
			currentWethBalance: walletAddress === WALLET_ADDRESS ? 2n : 4n,
			initialReportAmount2: 10n,
			maximumInitialWeth: 5n,
			minimumToken1Report: 5n,
			proposedRepPerEthPrice: 2n * 10n ** 18n,
			reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
			requestedInitialWeth: 0n,
			wethShortfall: walletAddress === WALLET_ADDRESS ? 3n : 1n,
		}))
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadCoordinatorInitialReportFundingRequirement,
			loadOracleManagerQueueOperationEthValue: mock(async () => 12n),
		})
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, { accountAddress: WALLET_ADDRESS }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
		})
		await act(async () => {
			await requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		})
		expect(requireHookState(hookState).liquidationFundingPreview?.currentRepBalance).toBe(25n)

		await act(() => {
			render(h(Harness, { accountAddress: SECOND_WALLET_ADDRESS }), renderedComponent.container)
		})
		expect(requireHookState(hookState).liquidationFundingPreview).toBeUndefined()

		await act(async () => {
			await requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		})
		expect(requireHookState(hookState).liquidationFundingPreview?.currentRepBalance).toBe(50n)
		expect(loadCoordinatorInitialReportFundingRequirement.mock.calls.map(call => call[2])).toEqual([WALLET_ADDRESS, SECOND_WALLET_ADDRESS])
	})

	test('does not commit an in-flight liquidation funding preview after the wallet changes', async () => {
		const firstWalletFunding = createDeferred<{
			currentRepBalance: bigint
			currentWethBalance: bigint
			initialReportAmount2: bigint
			maximumInitialWeth: bigint
			minimumToken1Report: bigint
			proposedRepPerEthPrice: bigint
			reputationTokenAddress: Address
			requestedInitialWeth: bigint
			wethShortfall: bigint
		}>()
		const secondWalletFunding = createDeferred<{
			currentRepBalance: bigint
			currentWethBalance: bigint
			initialReportAmount2: bigint
			maximumInitialWeth: bigint
			minimumToken1Report: bigint
			proposedRepPerEthPrice: bigint
			reputationTokenAddress: Address
			requestedInitialWeth: bigint
			wethShortfall: bigint
		}>()
		const loadCoordinatorInitialReportFundingRequirement = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _managerAddress: Address, walletAddress: Address) => await (walletAddress === WALLET_ADDRESS ? firstWalletFunding.promise : secondWalletFunding.promise))
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadCoordinatorInitialReportFundingRequirement,
			loadOracleManagerQueueOperationEthValue: mock(async () => 12n),
		})
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, { accountAddress: WALLET_ADDRESS }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
		})
		const firstWalletLoad = requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		await waitFor(() => {
			expect(loadCoordinatorInitialReportFundingRequirement).toHaveBeenCalledTimes(1)
		})

		await act(() => {
			render(h(Harness, { accountAddress: SECOND_WALLET_ADDRESS }), renderedComponent.container)
		})
		firstWalletFunding.resolve({
			currentRepBalance: 25n,
			currentWethBalance: 2n,
			initialReportAmount2: 10n,
			maximumInitialWeth: 5n,
			minimumToken1Report: 5n,
			proposedRepPerEthPrice: 2n * 10n ** 18n,
			reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
			requestedInitialWeth: 0n,
			wethShortfall: 3n,
		})
		await act(async () => {
			await firstWalletLoad
		})
		expect(requireHookState(hookState).liquidationFundingPreview).toBeUndefined()

		const secondWalletLoad = requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		secondWalletFunding.resolve({
			currentRepBalance: 50n,
			currentWethBalance: 4n,
			initialReportAmount2: 10n,
			maximumInitialWeth: 5n,
			minimumToken1Report: 5n,
			proposedRepPerEthPrice: 2n * 10n ** 18n,
			reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
			requestedInitialWeth: 0n,
			wethShortfall: 1n,
		})
		await act(async () => {
			await secondWalletLoad
		})
		expect(requireHookState(hookState).liquidationFundingPreview?.currentRepBalance).toBe(50n)
	})

	test('aborts submission preflight when the environment changes before funding resolves', async () => {
		const queueOperationEthValue = createDeferred<bigint>()
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x04' as const,
			securityPoolAddress: zeroAddress,
		}))
		const loadOracleManagerQueueOperationEthValue = mock(async () => await queueOperationEthValue.promise)
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadOracleManagerQueueOperationEthValue,
			queueSecurityPoolLiquidation,
		})
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, { environmentRefreshKey: 0 }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, SECOND_WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationTargetVault(SECOND_WALLET_ADDRESS)
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})
		const staleEnvironmentSubmission = requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		await waitFor(() => {
			expect(loadOracleManagerQueueOperationEthValue).toHaveBeenCalledTimes(1)
		})

		await act(() => {
			render(h(Harness, { environmentRefreshKey: 1 }), renderedComponent.container)
		})
		queueOperationEthValue.resolve(0n)
		await act(async () => {
			await staleEnvironmentSubmission
		})

		expect(queueSecurityPoolLiquidation).not.toHaveBeenCalled()
		expect(requireHookState(hookState).liquidationFundingPreview).toBeUndefined()
		expect(requireHookState(hookState).securityPoolLiquidationError).toContain('network changed')

		await act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})
		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
	})

	test('blocks queued liquidations when the wallet cannot fund the initial report WETH wrap', async () => {
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x03' as const,
			securityPoolAddress: zeroAddress,
		}))

		const dependencies = createSecurityPoolsOverviewDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 1n,
			})),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 10n,
				currentWethBalance: 0n,
				initialReportAmount2: 5n,
				maximumInitialWeth: 10n,
				minimumToken1Report: 10n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
				requestedInitialWeth: 0n,
				wethShortfall: 5n,
			})),
			loadOracleManagerDetails: mock(async () => ({
				callbackStateHash: undefined,
				exactToken1Report: undefined,
				isPriceValid: false,
				lastPrice: 0n,
				lastSettlementTimestamp: 0n,
				managerAddress: zeroAddress,
				openOracleAddress: zeroAddress,
				pendingOperation: undefined,
				pendingOperationSlotId: 0n,
				pendingSettlementOperationIds: [],
				pendingSettlementQueueCapacity: 4n,
				pendingReportId: 0n,
				priceValidUntilTimestamp: undefined,
				queuedOperationEthCost: 0n,
				requestPriceEthCost: 1n,
				token1: undefined,
				token2: undefined,
			})),
			loadOracleManagerQueueOperationEthValue: mock(async () => 1n),
			queueSecurityPoolLiquidation,
		})

		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		await act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		expect(queueSecurityPoolLiquidation).not.toHaveBeenCalled()
		await waitFor(() => {
			expect(requireHookState(hookState).securityPoolOverviewFeedback?.status.detail).toContain('fund the initial report and queue this liquidation')
		})
	})

	test('expands compact staged liquidation failure reasons in overview feedback', async () => {
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation: mock(async () => ({
				action: 'queueLiquidation' as const,
				hash: '0x03' as const,
				securityPoolAddress: zeroAddress,
				stagedExecution: {
					errorMessage: 'No gain',
					operation: 'liquidation' as const,
					operationId: 3n,
					success: false,
				},
			})),
		})

		const presentedTransactions: GlobalTransactionPresentation[] = []
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			{
				onTransactionPresented: presentation => {
					presentedTransactions.push(presentation)
				},
			},
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		await act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})
		expect(requireHookState(hookState).securityPoolOverviewFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).securityPoolOverviewFeedback?.status.detail).toBe('This liquidation amount is too small to improve the target vault health after rounding.')
		expect(presentedTransactions).toHaveLength(1)
		expect(presentedTransactions[0]?.tone).toBe('error')
		expect(presentedTransactions[0]?.title).toBe('Liquidation Failed')
		expect(presentedTransactions[0]?.detail).toBe('This liquidation amount is too small to improve the target vault health after rounding.')
	})
})
