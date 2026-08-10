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
import type { LiquidationApprovalDetails } from '../../../types/contracts.js'

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

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledWith(expect.anything(), zeroAddress, '0x0000000000000000000000000000000000000001', 10n ** 18n, 5n * 60n, 0n, '0x0000000000000000000000000000000000000001', `0x${'00'.repeat(32)}`)
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
				currentRepBalanceAttoRep: 25n,
				currentWethBalanceAttoEth: 2n,
				initialReportAmount2: 10n,
				maximumInitialAttoWeth: 5n,
				minimumToken1ReportAttoEth: 5n,
				proposedRepPerEthPrice: 2n * 10n ** 18n,
				reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
				requestedInitialAttoWeth: 0n,
				wethShortfallAttoEth: 3n,
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
			currentRepBalanceAttoRep: 25n,
			currentWethBalanceAttoEth: 2n,
			initialReportRepRequiredAttoRep: 10n,
			initialReportWethRequiredAttoEth: 5n,
			queueOperationValueAttoEth: 12n,
			totalWalletEthRequiredAttoEth: 15n,
			wethShortfallAttoEth: 3n,
		})
	})

	test('invalidates a resolved liquidation funding preview when the wallet changes', async () => {
		const loadCoordinatorInitialReportFundingRequirement = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _managerAddress: Address, walletAddress: Address) => ({
			currentRepBalanceAttoRep: walletAddress === WALLET_ADDRESS ? 25n : 50n,
			currentWethBalanceAttoEth: walletAddress === WALLET_ADDRESS ? 2n : 4n,
			initialReportAmount2: 10n,
			maximumInitialAttoWeth: 5n,
			minimumToken1ReportAttoEth: 5n,
			proposedRepPerEthPrice: 2n * 10n ** 18n,
			reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
			requestedInitialAttoWeth: 0n,
			wethShortfallAttoEth: walletAddress === WALLET_ADDRESS ? 3n : 1n,
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
		expect(requireHookState(hookState).liquidationFundingPreview?.currentRepBalanceAttoRep).toBe(25n)

		await act(() => {
			render(h(Harness, { accountAddress: SECOND_WALLET_ADDRESS }), renderedComponent.container)
		})
		expect(requireHookState(hookState).liquidationFundingPreview).toBeUndefined()

		await act(async () => {
			await requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		})
		expect(requireHookState(hookState).liquidationFundingPreview?.currentRepBalanceAttoRep).toBe(50n)
		expect(loadCoordinatorInitialReportFundingRequirement.mock.calls.map(call => call[2])).toEqual([WALLET_ADDRESS, SECOND_WALLET_ADDRESS])
	})

	test('does not commit an in-flight liquidation funding preview after the wallet changes', async () => {
		const firstWalletFunding = createDeferred<{
			currentRepBalanceAttoRep: bigint
			currentWethBalanceAttoEth: bigint
			initialReportAmount2: bigint
			maximumInitialAttoWeth: bigint
			minimumToken1ReportAttoEth: bigint
			proposedRepPerEthPrice: bigint
			reputationTokenAddress: Address
			requestedInitialAttoWeth: bigint
			wethShortfallAttoEth: bigint
		}>()
		const secondWalletFunding = createDeferred<{
			currentRepBalanceAttoRep: bigint
			currentWethBalanceAttoEth: bigint
			initialReportAmount2: bigint
			maximumInitialAttoWeth: bigint
			minimumToken1ReportAttoEth: bigint
			proposedRepPerEthPrice: bigint
			reputationTokenAddress: Address
			requestedInitialAttoWeth: bigint
			wethShortfallAttoEth: bigint
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
			currentRepBalanceAttoRep: 25n,
			currentWethBalanceAttoEth: 2n,
			initialReportAmount2: 10n,
			maximumInitialAttoWeth: 5n,
			minimumToken1ReportAttoEth: 5n,
			proposedRepPerEthPrice: 2n * 10n ** 18n,
			reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
			requestedInitialAttoWeth: 0n,
			wethShortfallAttoEth: 3n,
		})
		await act(async () => {
			await firstWalletLoad
		})
		expect(requireHookState(hookState).liquidationFundingPreview).toBeUndefined()

		const secondWalletLoad = requireHookState(hookState).loadLiquidationFundingPreview(zeroAddress)
		secondWalletFunding.resolve({
			currentRepBalanceAttoRep: 50n,
			currentWethBalanceAttoEth: 4n,
			initialReportAmount2: 10n,
			maximumInitialAttoWeth: 5n,
			minimumToken1ReportAttoEth: 5n,
			proposedRepPerEthPrice: 2n * 10n ** 18n,
			reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
			requestedInitialAttoWeth: 0n,
			wethShortfallAttoEth: 1n,
		})
		await act(async () => {
			await secondWalletLoad
		})
		expect(requireHookState(hookState).liquidationFundingPreview?.currentRepBalanceAttoRep).toBe(50n)
	})

	test('aborts submission preflight when the environment changes before funding resolves', async () => {
		const queueOperationValueAttoEth = createDeferred<bigint>()
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x04' as const,
			securityPoolAddress: zeroAddress,
		}))
		const loadOracleManagerQueueOperationEthValue = mock(async () => await queueOperationValueAttoEth.promise)
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
		queueOperationValueAttoEth.resolve(0n)
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
				currentRepBalanceAttoRep: 10n,
				currentWethBalanceAttoEth: 0n,
				initialReportAmount2: 5n,
				maximumInitialAttoWeth: 10n,
				minimumToken1ReportAttoEth: 10n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: getAddress('0x0000000000000000000000000000000000000006'),
				requestedInitialAttoWeth: 0n,
				wethShortfallAttoEth: 5n,
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
				queuedOperationCostAttoEth: 0n,
				requestPriceCostAttoEth: 1n,
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
					errorMessage: 'Target debt',
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
		expect(requireHookState(hookState).securityPoolOverviewFeedback?.status.detail).toBe('The target vault would fall below the minimum security-bond debt after liquidation.')
		expect(presentedTransactions).toHaveLength(1)
		expect(presentedTransactions[0]?.tone).toBe('error')
		expect(presentedTransactions[0]?.title).toBe('Liquidation Failed')
		expect(presentedTransactions[0]?.detail).toBe('The target vault would fall below the minimum security-bond debt after liquidation.')
	})

	test('ignores a stale approval response after the approval ID is replaced', async () => {
		const firstApproval = createDeferred<LiquidationApprovalDetails>()
		const secondApproval = createDeferred<LiquidationApprovalDetails>()
		const firstApprovalId = `0x${'11'.repeat(32)}` as const
		const secondApprovalId = `0x${'22'.repeat(32)}` as const
		const createApproval = (nonce: bigint): LiquidationApprovalDetails => ({
			registryAddress: zeroAddress,
			params: {
				securityPool: zeroAddress,
				receiverVault: SECOND_WALLET_ADDRESS,
				operator: WALLET_ADDRESS,
				targetVault: zeroAddress,
				maxCumulativeDebtAttoEth: 10n,
				maxDebtPerLiquidationAttoEth: 5n,
				minPostLiquidationHealthFactorBps: 10_000n,
				validAfter: 0n,
				validUntil: 2_000_000_000n,
				nonce,
			},
			availableDebtAttoEth: 10n,
			reservedDebtAttoEth: 0n,
			consumedDebtAttoEth: 0n,
			minimumValidNonce: 0n,
			revoked: false,
		})
		const dependencies = createSecurityPoolsOverviewDependencies({
			loadLiquidationApproval: mock(async (_managerAddress, approvalId) => await (approvalId === firstApprovalId ? firstApproval.promise : secondApproval.promise)),
		})
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationApprovalId(firstApprovalId)
		})
		const firstLoad = requireHookState(hookState).loadLiquidationApproval()
		await act(() => {
			requireHookState(hookState).setLiquidationApprovalId(secondApprovalId)
		})
		const secondLoad = requireHookState(hookState).loadLiquidationApproval()
		secondApproval.resolve(createApproval(2n))
		await act(async () => {
			await secondLoad
		})
		firstApproval.resolve(createApproval(1n))
		await act(async () => {
			await firstLoad
		})

		expect(requireHookState(hookState).liquidationApprovalDetails?.params.nonce).toBe(2n)
	})

	test('loads delegated receiver vault state independently from the operator vault', async () => {
		const loadSecurityPoolVaultSummary = mock(async (_securityPoolAddress: Address, vaultAddress: Address) => ({
			openInterestAttoEth: 3n,
			disputeStakedAttoRep: 4n,
			vaultAttoRepBacking: 5n,
			capacityOwnershipAttoRep: 6n,
			claimableFeesAttoEth: 7n,
			vaultAddress,
		}))
		const dependencies = createSecurityPoolsOverviewDependencies({ loadSecurityPoolVaultSummary })
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			requireHookState(hookState).setLiquidationReceiverVault(SECOND_WALLET_ADDRESS)
		})
		await act(async () => {
			await requireHookState(hookState).loadLiquidationReceiverVaultSummary()
		})

		expect(loadSecurityPoolVaultSummary).toHaveBeenCalledWith(zeroAddress, SECOND_WALLET_ADDRESS)
		expect(requireHookState(hookState).liquidationReceiverVaultSummaryResolved).toBe(true)
		expect(requireHookState(hookState).liquidationReceiverVaultSummary?.vaultAddress).toBe(SECOND_WALLET_ADDRESS)
		expect(requireHookState(hookState).liquidationReceiverVaultSummary?.capacityOwnershipAttoRep).toBe(6n)
	})
})
