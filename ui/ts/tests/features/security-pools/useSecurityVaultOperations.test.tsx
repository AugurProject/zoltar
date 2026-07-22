/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { waitFor } from '../../testUtils/queries'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import type { OracleManagerDetails, SecurityVaultDetails } from '../../../types/contracts.js'
import { useSecurityVaultOperations, type UseSecurityVaultOperationsDependencies } from '../../../features/security-pools/hooks/useSecurityVaultOperations.js'

type UseSecurityVaultOperationsState = ReturnType<typeof useSecurityVaultOperations>
type TestSecurityVaultWriteClient = { kind: 'injected-write-client' }

const WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECURITY_POOL_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const MANAGER_ADDRESS = getAddress('0x0000000000000000000000000000000000000003')
const REP_TOKEN_ADDRESS = getAddress('0x0000000000000000000000000000000000000004')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		currentRetentionRate: 0n,
		escalationEscrowedRep: 0n,
		managerAddress: MANAGER_ADDRESS,
		poolOwnershipDenominator: 1n,
		repDepositShare: 10n * 10n ** 18n,
		repToken: REP_TOKEN_ADDRESS,
		securityBondAllowance: 0n,
		securityPoolAddress: SECURITY_POOL_ADDRESS,
		totalSecurityBondAllowance: 0n,
		unpaidEthFees: 0n,
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
		pendingSettlementQueueCapacity: 1n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: undefined,
		queuedOperationEthCost: 1n,
		requestPriceEthCost: 10n,
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
		depositRepToSecurityPool: async () => {
			throw new Error('depositRepToSecurityPool should not be called in this test')
		},
		loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
			currentRepBalance: 1n,
			currentWethBalance: 1n,
			initialReportAmount2: 1n,
			maximumInitialWeth: 1n,
			minimumToken1Report: 1n,
			proposedRepPerEthPrice: 1n,
			reputationTokenAddress: REP_TOKEN_ADDRESS,
			requestedInitialWeth: 0n,
			wethShortfall: 0n,
		})),
		loadErc20Balance: mock(async () => 0n),
		loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
		loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
		queueOracleManagerOperation: async () => {
			throw new Error('queueOracleManagerOperation should not be called in this test')
		},
		redeemRepFromSecurityPool: async () => {
			throw new Error('redeemRepFromSecurityPool should not be called in this test')
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

	test('approveRep snapshots the submitted deposit amount before async preflight completes', async () => {
		const loadSecurityVaultDetailsDeferred = createDeferred<SecurityVaultDetails>()
		const approveErc20 = mock(async () => ({
			action: 'approveRep' as const,
			hash: '0x01' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20,
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => await loadSecurityVaultDetailsDeferred.promise),
			queueOracleManagerOperation: mock(async () => {
				throw new Error('queueOracleManagerOperation should not be called in this test')
			}),
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: WALLET_ADDRESS,
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
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => await loadSecurityVaultDetailsDeferred.promise),
			queueOracleManagerOperation,
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: WALLET_ADDRESS,
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

	test('setSecurityBondAllowance blocks stale-price queueing when the wallet cannot fund the required initial REP report', async () => {
		const queueOracleManagerOperation = mock(async () => ({
			action: 'queueSetSecurityBondAllowance' as const,
			hash: '0x03' as const,
		}))
		const dependencies = createSecurityVaultOperationsDependencies({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 10n ** 18n,
			})),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 0n,
				currentWethBalance: 0n,
				initialReportAmount2: 5n,
				maximumInitialWeth: 5n,
				minimumToken1Report: 5n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: REP_TOKEN_ADDRESS,
				requestedInitialWeth: 0n,
				wethShortfall: 5n,
			})),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceEthCost: 1n })),
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
				securityBondAllowanceAmount: '1',
				selectedVaultAddress: WALLET_ADDRESS,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).setSecurityBondAllowance()
		})

		expect(queueOracleManagerOperation).not.toHaveBeenCalled()
		await waitFor(() => {
			expect(requireHookState(hookState).securityVaultFeedback?.status.detail).toContain('fund the initial report')
		})
	})

	test('setSecurityBondAllowance can stage a fresh attached operation without a currently valid price', async () => {
		const queueOracleManagerOperation = mock(async () => ({
			action: 'queueSetSecurityBondAllowance' as const,
			hash: '0x03' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 10n,
				currentWethBalance: 10n,
				initialReportAmount2: 10n,
				maximumInitialWeth: 10n,
				minimumToken1Report: 10n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: REP_TOKEN_ADDRESS,
				requestedInitialWeth: 0n,
				wethShortfall: 0n,
			})),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceEthCost: 10n })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees: mock(async () => {
				throw new Error('redeemSecurityVaultFees should not be called in this test')
			}),
			updateSecurityVaultFees: mock(async () => {
				throw new Error('updateSecurityVaultFees should not be called in this test')
			}),
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 30n,
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
				securityBondAllowanceAmount: '1',
				selectedVaultAddress: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '5',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).setSecurityBondAllowance()
		})

		expect(queueOracleManagerOperation).toHaveBeenCalledWith(expect.anything(), MANAGER_ADDRESS, 'setSecurityBondsAllowance', WALLET_ADDRESS, 10n ** 18n, 5n * 60n)
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
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadCoordinatorInitialReportFundingRequirement: mock(async () => ({
				currentRepBalance: 10n,
				currentWethBalance: 10n,
				initialReportAmount2: 10n,
				maximumInitialWeth: 10n,
				minimumToken1Report: 10n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: REP_TOKEN_ADDRESS,
				requestedInitialWeth: 0n,
				wethShortfall: 0n,
			})),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceEthCost: 10n })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: WALLET_ADDRESS,
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
				currentRepBalance: 0n,
				currentWethBalance: 0n,
				initialReportAmount2: 5n,
				maximumInitialWeth: 5n,
				minimumToken1Report: 5n,
				proposedRepPerEthPrice: 1n,
				reputationTokenAddress: REP_TOKEN_ADDRESS,
				requestedInitialWeth: 0n,
				wethShortfall: 5n,
			})),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceEthCost: 1n })),
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
				selectedVaultAddress: WALLET_ADDRESS,
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
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: true })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: WALLET_ADDRESS,
				stagedOperationTimeoutMinutes: '5',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).withdrawRep()
		})

		expect(queueOracleManagerOperation).toHaveBeenCalledTimes(1)
	})

	test('depositRep ignores a stale preflight balance refresh after the selected vault changes', async () => {
		const staleBalance = createDeferred<bigint>()
		let balanceLoads = 0
		const depositRepToSecurityPool = mock(async () => ({
			action: 'depositRep' as const,
			hash: '0x06' as const,
		}))

		const dependencies = createSecurityVaultOperationsDependencies({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToSecurityPool,
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
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: WALLET_ADDRESS,
			}))
		})

		let depositPromise = Promise.resolve()
		await act(() => {
			depositPromise = requireHookState(hookState).depositRep()
		})

		await waitFor(() => expect(balanceLoads).toBe(1))

		await act(() => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				selectedVaultAddress: getAddress('0x0000000000000000000000000000000000000009'),
			}))
		})

		await act(async () => {
			staleBalance.resolve(10n * 10n ** 18n)
			await depositPromise
		})

		expect(depositRepToSecurityPool).not.toHaveBeenCalled()
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
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails()),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation: mock(async () => {
				throw new Error('queueOracleManagerOperation should not be called in this test')
			}),
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: getAddress('0x0000000000000000000000000000000000000009'),
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
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Balance: mock(async () => 0n),
			loadOracleManagerDetails: mock(async () => createOracleManagerDetails({ isPriceValid: false, requestPriceEthCost: 1n })),
			loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
			queueOracleManagerOperation,
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
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
				selectedVaultAddress: WALLET_ADDRESS,
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
				selectedVaultAddress: getAddress('0x0000000000000000000000000000000000000009'),
			}))
		})

		await act(async () => {
			staleWalletBalance.resolve(2n * 10n ** 18n)
			await withdrawPromise
		})

		expect(queueOracleManagerOperation).not.toHaveBeenCalled()
	})
})
