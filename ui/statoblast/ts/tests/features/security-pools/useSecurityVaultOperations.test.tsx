import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
/// <reference types='bun-types' />

import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { OracleManagerDetails, SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { useSecurityVaultOperations, type UseSecurityVaultOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityVaultOperations.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'

type UseSecurityVaultOperationsState = ReturnType<typeof useSecurityVaultOperations>
type TestSecurityVaultWriteClient = { kind: 'injected-write-client' }

const WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECURITY_POOL_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const MANAGER_ADDRESS = getAddress('0x0000000000000000000000000000000000000003')
const REP_TOKEN_ADDRESS = getAddress('0x0000000000000000000000000000000000000004')

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		badDebtAttoEth: 0n,
		statoblastSecurityMultiplierBps: 20_000n,
		currentRetentionRate: 0n,
		disputeStakedAttoRep: 0n,
		managerAddress: MANAGER_ADDRESS,
		totalRepBackingUnits: 1n,
		vaultAttoRepBacking: 10n * 10n ** 18n,
		repToken: REP_TOKEN_ADDRESS,
		capacityOwnershipAttoRep: 0n,
		securityPoolAddress: SECURITY_POOL_ADDRESS,
		totalCapacityOwnershipAttoRep: 0n,
		claimableFeesAttoEth: 0n,
		universeId: 1n,
		vaultAddress: WALLET_ADDRESS,
		...overrides,
	}
}

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 10n ** 18n,
		lastSettlementTimestamp: 1n,
		managerAddress: MANAGER_ADDRESS,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: undefined,
		queuedOperationCostAttoEth: 1n,
		requestPriceCostAttoEth: 10n,
		token1: undefined,
		token2: undefined,
		...overrides,
	}
}

function createSecurityVaultOperationsDependencies(overrides: Partial<UseSecurityVaultOperationsDependencies<TestSecurityVaultWriteClient>> = {}): UseSecurityVaultOperationsDependencies<TestSecurityVaultWriteClient> {
	return {
		approveErc20: async () => {
			throw new Error('approveErc20 should not be called in this test')
		},
		createConnectedReadClient: mock(() => ({
			getBalance: async () => 0n,
		})),
		createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		depositRepToVaultToSecurityPool: async () => {
			throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
		},
		isSecurityPoolVaultAdmissionClosed: mock(async () => false),
		loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
			currentRepBalanceAttoRep: 1n,
			currentWethBalanceAttoEth: 1n,
			initialReportAmount2: 1n,
			maximumInitialAttoWeth: 1n,
			minimumToken1ReportAttoEth: 1n,
			proposedRepPerEthPrice: 1n,
			reputationTokenAddress: REP_TOKEN_ADDRESS,
			requestedInitialAttoWeth: 0n,
			wethShortfallAttoEth: 0n,
		})),
		loadErc20Balance: mock(async () => 0n),
		loadQueuedVaultOperationState: mock(async () => ({ status: 'queued' as const })),
		loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
		loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
		queueOracleManagerOperation: async () => {
			throw new Error('queueOracleManagerOperation should not be called in this test')
		},
		redeemRepFromVaultFromSecurityPool: async () => {
			throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
		},
		redeemSecurityVaultFees: async () => {
			throw new Error('redeemSecurityVaultFees should not be called in this test')
		},
		updateSecurityVaultFees: async () => {
			throw new Error('updateSecurityVaultFees should not be called in this test')
		},
		...overrides,
	}
}

function createHarness(dependencies: UseSecurityVaultOperationsDependencies<TestSecurityVaultWriteClient>, onRender: (state: UseSecurityVaultOperationsState) => void, overrides: Partial<Parameters<typeof useSecurityVaultOperations>[0]> = {}) {
	return function SecurityVaultOperationsHarness() {
		const state = useSecurityVaultOperations(
			{
				accountAddress: WALLET_ADDRESS,
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS,
				...overrides,
			},
			dependencies,
		)
		onRender(state)
		return h('div', {})
	}
}

function requireHookState(state: UseSecurityVaultOperationsState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

describe('useSecurityVaultOperations', () => {
	let restoreActiveEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		beforeTest: () => {
			restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			restoreActiveEnvironment?.()
			restoreActiveEnvironment = undefined
			mock.restore()
		},
	})

	test('adjustment revalidates commitments and prevents duplicate submissions', async () => {
		const write = createDeferred<{ hash: '0x01' }>()
		const queueOracleManagerOperation = mock(async () => await write.promise)
		let committed = false
		const dependencies = createSecurityVaultOperationsDependencies({
			queueOracleManagerOperation,
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ capacityOwnershipAttoRep: 5n * 10n ** 18n, totalCapacityOwnershipAttoRep: 5n * 10n ** 18n, settlementCollateralAttoEth: committed ? 1n : 0n })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		cleanupRenderedComponent = (await renderIntoDocument(h(Harness, {}))).cleanup
		const first = act(async () => await requireHookState(hookState).adjustBackingFactor('2'))
		await waitFor(() => expect(queueOracleManagerOperation).toHaveBeenCalledTimes(1))
		await requireHookState(hookState).adjustBackingFactor('3')
		expect(queueOracleManagerOperation).toHaveBeenCalledTimes(1)
		expect(queueOracleManagerOperation).toHaveBeenCalledWith(expect.anything(), MANAGER_ADDRESS, 'adjustVaultBackingFactor', WALLET_ADDRESS, 20_000n, 300n)
		write.resolve({ hash: '0x01' })
		await first
		expect(requireHookState(hookState).securityVaultFeedback?.status.tone).toBe('success')
		committed = true
		await act(async () => await requireHookState(hookState).adjustBackingFactor('100'))
		expect(queueOracleManagerOperation).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).securityVaultError).toContain('committed settlement collateral')
	})

	test('preserves the existing on-chain queue result for a target change', async () => {
		const queuedOperation = { isPendingSlot: true, operation: 'adjustVaultBackingFactor' as const, operationId: 7n }
		const dependencies = createSecurityVaultOperationsDependencies({
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ targetBackingFactorBps: 40_000n, settlementCollateralAttoEth: 0n })),
			queueOracleManagerOperation: mock(async () => ({ hash: '0x01' as const, queuedOperation })),
		})
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, next => {
			state = next
		})
		cleanupRenderedComponent = (await renderIntoDocument(h(Harness, {}))).cleanup
		await act(async () => requireHookState(state).setSecurityVaultForm(current => ({ ...current, stagedOperationTimeoutMinutes: 'invalid' })))
		await act(async () => await requireHookState(state).adjustBackingFactor('2'))
		expect(requireHookState(state).securityVaultResult?.queuedOperation).toEqual(queuedOperation)
		expect(requireHookState(state).securityVaultDetails?.targetBackingFactorBps).toBe(40_000n)
	})

	test.each(['executed', 'failed', 'expired', 'superseded'] as const)('reconciles a queued target to %s without replacing its submission receipt', async terminal => {
		let completed = false
		const queuedOperation = { isPendingSlot: false, operation: 'adjustVaultBackingFactor' as const, operationId: 7n }
		const execution = { operation: 'adjustVaultBackingFactor' as const, operationId: 7n, success: terminal === 'executed', errorMessage: terminal === 'executed' ? undefined : terminal }
		const dependencies = createSecurityVaultOperationsDependencies({
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ settlementCollateralAttoEth: 0n })),
			queueOracleManagerOperation: mock(async () => ({ hash: '0x01' as const, queuedOperation })),
			loadQueuedVaultOperationState: mock(async () => (completed ? { status: terminal, execution } : { status: 'manual-queued' as const })),
		})
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, next => {
			state = next
		})
		cleanupRenderedComponent = (await renderIntoDocument(h(Harness, {}))).cleanup
		await act(async () => await requireHookState(state).adjustBackingFactor('2'))
		await act(async () => await requireHookState(state).loadSecurityVault())
		expect(requireHookState(state).securityVaultResult?.queuedOperationState?.status).toBe('manual-queued')
		completed = true
		await act(async () => await requireHookState(state).loadSecurityVault())
		expect(requireHookState(state).securityVaultResult?.queuedOperationState?.status).toBe(terminal)
		expect(requireHookState(state).securityVaultResult?.hash).toBe('0x01')
		expect(requireHookState(state).securityVaultResult?.queuedOperation).toEqual(queuedOperation)
	})

	test('automatically refreshes a queued target after another actor executes it', async () => {
		let completed = false
		const dependencies = createSecurityVaultOperationsDependencies({
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ settlementCollateralAttoEth: 0n, targetBackingFactorBps: completed ? 20_000n : 40_000n })),
			queueOracleManagerOperation: mock(async () => ({ hash: '0x01' as const, queuedOperation: { isPendingSlot: true, operation: 'adjustVaultBackingFactor' as const, operationId: 7n } })),
			loadQueuedVaultOperationState: mock(async () => ({ status: completed ? ('executed' as const) : ('queued' as const) })),
		})
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, next => {
			state = next
		})
		cleanupRenderedComponent = (await renderIntoDocument(h(Harness, {}))).cleanup
		await act(async () => await requireHookState(state).adjustBackingFactor('2'))
		await waitFor(() => expect(requireHookState(state).securityVaultResult?.queuedOperationState?.status).toBe('queued'))
		completed = true
		await waitFor(() => expect(requireHookState(state).securityVaultResult?.queuedOperationState?.status).toBe('executed'), { timeout: 5_000 })
		await waitFor(() => expect(requireHookState(state).securityVaultDetails?.targetBackingFactorBps).toBe(20_000n))
		expect(requireHookState(state).securityVaultResult?.hash).toBe('0x01')
	})

	test('ignores an in-flight operation refresh after selecting another vault', async () => {
		const pendingRead = createDeferred<{ status: 'executed' }>()
		const loadQueuedVaultOperationState = mock(async () => await pendingRead.promise)
		const dependencies = createSecurityVaultOperationsDependencies({
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ settlementCollateralAttoEth: 0n })),
			queueOracleManagerOperation: mock(async () => ({ hash: '0x01' as const, queuedOperation: { isPendingSlot: true, operation: 'adjustVaultBackingFactor' as const, operationId: 7n } })),
			loadQueuedVaultOperationState,
		})
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, next => {
			state = next
		})
		cleanupRenderedComponent = (await renderIntoDocument(h(Harness, {}))).cleanup
		await act(async () => await requireHookState(state).adjustBackingFactor('2'))
		await waitFor(() => expect(loadQueuedVaultOperationState).toHaveBeenCalled())
		await act(async () => requireHookState(state).setSecurityVaultForm(current => ({ ...current, selectedVaultOwner: MANAGER_ADDRESS })))
		await act(async () => {
			pendingRead.resolve({ status: 'executed' })
			await pendingRead.promise
		})
		expect(requireHookState(state).securityVaultResult).toBeUndefined()
	})

	test('reports a rejected target execution as an error instead of success', async () => {
		const dependencies = createSecurityVaultOperationsDependencies({
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ settlementCollateralAttoEth: 0n })),
			queueOracleManagerOperation: mock(async () => ({ hash: '0x01' as const, stagedExecution: { operation: 'adjustVaultBackingFactor' as const, operationId: 8n, success: false, errorMessage: 'Vault backing insufficient' } })),
		})
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, next => {
			state = next
		})
		cleanupRenderedComponent = (await renderIntoDocument(h(Harness, {}))).cleanup
		await act(async () => await requireHookState(state).adjustBackingFactor('2'))
		expect(requireHookState(state).securityVaultError).toBe('Vault backing insufficient')
		expect(requireHookState(state).securityVaultFeedback?.status.tone).not.toBe('success')
	})

	test('approveRep snapshots the submitted deposit amount before async preflight completes', async () => {
		const loadSecurityVaultDetailsDeferred = createDeferred<SecurityVaultDetails>()
		const approveErc20 = mock(async () => ({
			action: 'approveRep' as const,
			hash: '0x01' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20,
			depositRepToVaultToSecurityPool: mock(async () => {
				throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => await loadSecurityVaultDetailsDeferred.promise),
			queueOracleManagerOperation: mock(async () => {
				throw new Error('queueOracleManagerOperation should not be called in this test')
			}),
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
			}))
		})

		const approvePromise = act(async () => {
			await requireHookState(hookState).approveRep()
		})

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '2',
			}))
		})

		loadSecurityVaultDetailsDeferred.resolve(createSecurityVaultDetails())
		await approvePromise

		expect(approveErc20).toHaveBeenCalledWith(expect.anything(), REP_TOKEN_ADDRESS, SECURITY_POOL_ADDRESS, 10n ** 18n, 'approveRep')
	})

	test('approveRep revalidates vault admission before broadcasting', async () => {
		const approveErc20 = mock(async () => ({
			action: 'approveRep' as const,
			hash: '0x01' as const,
		}))
		const isSecurityPoolVaultAdmissionClosed = mock(async () => true)
		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20,
			isSecurityPoolVaultAdmissionClosed,
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
			}))
		})
		await act(async () => {
			await requireHookState(hookState).approveRep()
		})

		expect(isSecurityPoolVaultAdmissionClosed).toHaveBeenCalledWith(SECURITY_POOL_ADDRESS)
		expect(approveErc20).not.toHaveBeenCalled()
		await waitFor(() => {
			expect(requireHookState(hookState).securityVaultFeedback?.status.detail).toContain('unavailable after this question ends')
		})
	})

	test('withdrawRep snapshots the submitted amount and staged timeout before async preflight completes', async () => {
		const loadSecurityVaultDetailsDeferred = createDeferred<SecurityVaultDetails>()
		const queueOracleManagerOperation = mock(async () => ({
			action: 'queueWithdrawRep' as const,
			hash: '0x02' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToVaultToSecurityPool: mock(async () => {
				throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => await loadSecurityVaultDetailsDeferred.promise),
			queueOracleManagerOperation,
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '5',
			}))
		})

		const withdrawPromise = act(async () => {
			await requireHookState(hookState).withdrawRep()
		})

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '2',
				stagedOperationTimeoutMinutes: '1',
			}))
		})

		loadSecurityVaultDetailsDeferred.resolve(createSecurityVaultDetails())
		await withdrawPromise

		expect(queueOracleManagerOperation).toHaveBeenCalledWith(expect.anything(), MANAGER_ADDRESS, 'withdrawRep', WALLET_ADDRESS, 10n ** 18n, 5n * 60n)
	})

	test('withdrawRep can stage a fresh attached operation without a currently valid price', async () => {
		const queueOracleManagerOperation = mock(async () => ({
			action: 'queueWithdrawRep' as const,
			hash: '0x04' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToVaultToSecurityPool: mock(async () => {
				throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
			}),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalanceAttoRep: 10n,
				currentWethBalanceAttoEth: 10n,
				initialReportAmount2: 10n,
				maximumInitialAttoWeth: 10n,
				minimumToken1ReportAttoEth: 10n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: REP_TOKEN_ADDRESS,
				requestedInitialAttoWeth: 0n,
				wethShortfallAttoEth: 0n,
			})),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceCostAttoEth: 10n })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 20n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '5',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).withdrawRep()
		})

		expect(queueOracleManagerOperation).toHaveBeenCalledWith(expect.anything(), MANAGER_ADDRESS, 'withdrawRep', WALLET_ADDRESS, 10n ** 18n, 5n * 60n)
	})

	test('withdrawRep blocks stale-price queueing when the wallet cannot fund the required initial REP report', async () => {
		const queueOracleManagerOperation = mock(async () => ({
			action: 'queueWithdrawRep' as const,
			hash: '0x04b' as const,
		}))
		const dependencies = createSecurityVaultOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 10n ** 18n,
			})),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalanceAttoRep: 0n,
				currentWethBalanceAttoEth: 0n,
				initialReportAmount2: 5n,
				maximumInitialAttoWeth: 5n,
				minimumToken1ReportAttoEth: 5n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: REP_TOKEN_ADDRESS,
				requestedInitialAttoWeth: 0n,
				wethShortfallAttoEth: 5n,
			})),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceCostAttoEth: 1n })),
			queueOracleManagerOperation,
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '5',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).withdrawRep()
		})

		expect(queueOracleManagerOperation).not.toHaveBeenCalled()
		await waitFor(() => {
			expect(requireHookState(hookState).securityVaultFeedback?.status.detail).toContain('fund the initial report')
		})
	})

	test('withdrawRep skips wallet ETH balance reads for zero-cost immediate executions', async () => {
		const queueOracleManagerOperation = mock(async () => ({
			action: 'queueWithdrawRep' as const,
			hash: '0x05' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToVaultToSecurityPool: mock(async () => {
				throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: true })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => ({
				getBalance: async () => {
					throw new Error('wallet ETH balance should not be loaded')
				},
			})),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '5',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).withdrawRep()
		})

		expect(queueOracleManagerOperation).toHaveBeenCalledTimes(1)
	})

	test.each(['', 'invalid', '1.5'])('deposits with the fresh saved target despite hidden input %s', async targetHealthFactor => {
		const deposit = mock(async () => ({ action: 'depositRepToVault' as const, hash: '0x06' as const }))
		const dependencies = createSecurityVaultOperationsDependencies({
			depositRepToVaultToSecurityPool: deposit,
			loadErc20Balance: mock(async () => 10n ** 18n),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails({ targetBackingFactorBps: 30_000n })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const rendered = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = rendered.cleanup
		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({ ...current, depositAmount: '1', selectedVaultOwner: WALLET_ADDRESS, targetHealthFactor }))
		})
		await act(async () => {
			await requireHookState(hookState).depositRepToVault()
		})
		expect(deposit).toHaveBeenCalledWith({ kind: 'injected-write-client' }, SECURITY_POOL_ADDRESS, 10n ** 18n, 30_000n)
	})

	test('depositRepToVault revalidates origin admission before broadcasting', async () => {
		const depositRepToVaultToSecurityPool = mock(async () => ({
			action: 'depositRepToVault' as const,
			hash: '0x06' as const,
		}))
		const isSecurityPoolVaultAdmissionClosed = mock(async () => true)
		const dependencies = createSecurityVaultOperationsDependencies({
			depositRepToVaultToSecurityPool,
			isSecurityPoolVaultAdmissionClosed,
			loadErc20Balance: mock(async () => 10n * 10n ** 18n),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
			}))
		})
		await act(async () => {
			await requireHookState(hookState).depositRepToVault()
		})

		expect(isSecurityPoolVaultAdmissionClosed).toHaveBeenCalledWith(SECURITY_POOL_ADDRESS)
		expect(depositRepToVaultToSecurityPool).not.toHaveBeenCalled()
		await waitFor(() => {
			expect(requireHookState(hookState).securityVaultFeedback?.status.detail).toContain('unavailable after this question ends')
		})
	})

	test('depositRepToVault ignores a stale preflight balance refresh after the selected vault changes', async () => {
		const staleBalance = createDeferred<bigint>()
		let balanceLoads = 0
		const depositRepToVaultToSecurityPool = mock(async () => ({
			action: 'depositRepToVault' as const,
			hash: '0x06' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToVaultToSecurityPool,
			loadErc20Balance: mock(async () => {
				balanceLoads += 1
				if (balanceLoads === 1) return await staleBalance.promise
				return 0n
			}),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation: mock(async () => {
				throw new Error('queueOracleManagerOperation should not be called in this test')
			}),
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
			}))
		})

		let depositPromise = Promise.resolve()
		await act(() => {
			depositPromise = requireHookState(hookState).depositRepToVault()
		})

		await waitFor(() => expect(balanceLoads).toBe(1))

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				selectedVaultOwner: getAddress('0x0000000000000000000000000000000000000009'),
			}))
		})

		await act(async () => {
			staleBalance.resolve(10n * 10n ** 18n)
			await depositPromise
		})

		expect(depositRepToVaultToSecurityPool).not.toHaveBeenCalled()
	})

	test('redeemFees ignores a stale selection change before the first write starts', async () => {
		const activeAccounts = createDeferred<readonly Address[]>()
		const updateSecurityVaultFees = mock(async () => ({
			action: 'updateVaultFees' as const,
			hash: '0x07' as const,
		}))
		const redeemSecurityVaultFees = mock(async () => ({
			action: 'redeemFees' as const,
			hash: '0x08' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToVaultToSecurityPool: mock(async () => {
				throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation: mock(async () => {
				throw new Error('queueOracleManagerOperation should not be called in this test')
			}),
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees,
			updateSecurityVaultFees,
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})

		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			getAccounts: async () => await activeAccounts.promise,
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		let redeemPromise = Promise.resolve()
		await act(() => {
			redeemPromise = requireHookState(hookState).redeemFees()
		})

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				selectedVaultOwner: getAddress('0x0000000000000000000000000000000000000009'),
			}))
		})

		await act(async () => {
			activeAccounts.resolve([WALLET_ADDRESS])
			await redeemPromise
		})

		expect(updateSecurityVaultFees).not.toHaveBeenCalled()
		expect(redeemSecurityVaultFees).not.toHaveBeenCalled()
	})

	test('withdrawRep ignores a stale preflight oracle request after the selected vault changes', async () => {
		const staleWalletBalance = createDeferred<bigint>()
		const queueOracleManagerOperation = mock(async () => ({
			hash: '0x09' as const,
		}))
		const readClient = {
			getBalance: mock(async () => await staleWalletBalance.promise),
		}

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToVaultToSecurityPool: mock(async () => {
				throw new Error('depositRepToVaultToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceCostAttoEth: 1n })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromVaultFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromVaultFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		})
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '1',
				selectedVaultOwner: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '1',
			}))
		})

		let withdrawPromise = Promise.resolve()
		await act(() => {
			withdrawPromise = requireHookState(hookState).withdrawRep()
		})

		await waitFor(() => expect(readClient.getBalance).toHaveBeenCalledTimes(1))

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				selectedVaultOwner: getAddress('0x0000000000000000000000000000000000000009'),
			}))
		})

		await act(async () => {
			staleWalletBalance.resolve(2n * 10n ** 18n)
			await withdrawPromise
		})

		expect(queueOracleManagerOperation).not.toHaveBeenCalled()
	})
})
