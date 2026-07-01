/// <reference types="bun-types" />

import { waitFor } from './testUtils/queries'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from 'viem'
import type { SecurityVaultDetails } from '../types/contracts.js'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '../lib/transactionTray.js'
import type { TransactionIntent } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseSecurityVaultOperations = typeof import('../hooks/useSecurityVaultOperations.js')['useSecurityVaultOperations']
type UseSecurityVaultOperationsState = ReturnType<UseSecurityVaultOperations>
const REP = 10n ** 18n

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createSecurityVaultDetails(securityPoolAddress: Address, vaultAddress: Address, repToken: Address): SecurityVaultDetails {
	return {
		currentRetentionRate: 0n,
		escalationEscrowedRep: 0n,
		managerAddress: getAddress('0x00000000000000000000000000000000000000f1'),
		poolOwnershipDenominator: 100n,
		repDepositShare: 10n,
		repToken,
		securityBondAllowance: 0n,
		securityPoolAddress,
		totalSecurityBondAllowance: 0n,
		unpaidEthFees: 0n,
		universeId: 1n,
		vaultAddress,
	}
}

function createHarness(
	useSecurityVaultOperations: UseSecurityVaultOperations,
	onRender: (state: UseSecurityVaultOperationsState) => void,
	{
		onTransactionCanceled = () => undefined,
		onTransactionFinished = () => undefined,
		onTransactionRequested = () => undefined,
	}: {
		onTransactionCanceled?: () => void
		onTransactionFinished?: () => void
		onTransactionRequested?: Parameters<UseSecurityVaultOperations>[0]['onTransactionRequested']
	} = {},
) {
	return function SecurityVaultOperationsHarness() {
		const state = useSecurityVaultOperations({
			accountAddress: zeroAddress,
			enabled: true,
			onTransactionCanceled,
			onTransactionFinished,
			onTransactionPresented: () => undefined,
			onTransactionRequested,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
		})

		onRender(state)

		return <div />
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
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: zeroAddress }))
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

	test('depositRep ignores a stale post-success refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000a1')
		const poolB = getAddress('0x00000000000000000000000000000000000000b1')
		const repTokenA = getAddress('0x00000000000000000000000000000000000000c1')
		const repTokenB = getAddress('0x00000000000000000000000000000000000000d1')
		const postSuccessRefresh = createDeferred<SecurityVaultDetails>()
		const poolALoads: SecurityVaultDetails[] = []
		const detailsA = createSecurityVaultDetails(poolA, zeroAddress, repTokenA)
		const detailsB = createSecurityVaultDetails(poolB, zeroAddress, repTokenB)

		const loadSecurityVaultDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
			if (securityPoolAddress === poolA) {
				if (poolALoads.length === 0) {
					poolALoads.push(detailsA)
					return detailsA
				}
				return await postSuccessRefresh.promise
			}
			if (securityPoolAddress === poolB) return detailsB
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const loadErc20Balance = mock(async (_client: unknown, repToken: Address) => {
			if (repToken === repTokenA) return 11n * REP
			if (repToken === repTokenB) return 22n * REP
			throw new Error(`Unexpected REP token ${repToken}`)
		})
		const loadErc20Allowance = mock(async (_client: unknown, repToken: Address) => {
			if (repToken === repTokenA) return 111n * REP
			if (repToken === repTokenB) return 222n * REP
			throw new Error(`Unexpected REP token ${repToken}`)
		})
		const depositRepToSecurityPool = mock(async () => ({
			action: 'depositRep' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000de',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToSecurityPool,
			loadErc20Allowance,
			loadErc20Balance,
			loadOracleManagerDetails: mock(async () => {
				throw new Error('loadOracleManagerDetails should not be called in this test')
			}),
			loadSecurityVaultDetails,
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
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useSecurityVaultOperations } = await import(`../hooks/useSecurityVaultOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(useSecurityVaultOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).securityVaultForm.selectedVaultAddress).toBe(zeroAddress))

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '1',
				securityPoolAddress: poolA,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolA))
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(11n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(111n * REP)

		let depositPromise = Promise.resolve()
		await act(() => {
			depositPromise = requireHookState(hookState).depositRep()
		})

		await waitFor(() => expect(loadSecurityVaultDetails).toHaveBeenCalledTimes(2))

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				securityPoolAddress: poolB,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB))
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(22n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(222n * REP)

		await act(async () => {
			postSuccessRefresh.resolve(detailsA)
			await depositPromise
		})

		expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB)
		expect(requireHookState(hookState).securityVaultDetails?.repToken).toBe(repTokenB)
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(22n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(222n * REP)
		expect(depositRepToSecurityPool).toHaveBeenCalledTimes(1)
	})

	test('depositRep ignores a stale preflight balance refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000a3')
		const poolB = getAddress('0x00000000000000000000000000000000000000b3')
		const repTokenA = getAddress('0x00000000000000000000000000000000000000c3')
		const repTokenB = getAddress('0x00000000000000000000000000000000000000d3')
		const staleBalance = createDeferred<bigint>()
		const detailsA = createSecurityVaultDetails(poolA, zeroAddress, repTokenA)
		const detailsB = createSecurityVaultDetails(poolB, zeroAddress, repTokenB)
		let repTokenABalanceLoads = 0

		const loadSecurityVaultDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
			if (securityPoolAddress === poolA) return detailsA
			if (securityPoolAddress === poolB) return detailsB
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const loadErc20Balance = mock(async (_client: unknown, repToken: Address) => {
			if (repToken === repTokenA) {
				repTokenABalanceLoads += 1
				if (repTokenABalanceLoads === 1) return 11n * REP
				return await staleBalance.promise
			}
			if (repToken === repTokenB) return 22n * REP
			throw new Error(`Unexpected REP token ${repToken}`)
		})
		const loadErc20Allowance = mock(async (_client: unknown, repToken: Address) => {
			if (repToken === repTokenA) return 111n * REP
			if (repToken === repTokenB) return 222n * REP
			throw new Error(`Unexpected REP token ${repToken}`)
		})
		const depositRepToSecurityPool = mock(async () => ({
			action: 'depositRep' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000df',
		}))
		let transactionState = createInitialTransactionTrayState()

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToSecurityPool,
			loadErc20Allowance,
			loadErc20Balance,
			loadOracleManagerDetails: mock(async () => {
				throw new Error('loadOracleManagerDetails should not be called in this test')
			}),
			loadSecurityVaultDetails,
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
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useSecurityVaultOperations } = await import(`../hooks/useSecurityVaultOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(
			useSecurityVaultOperations,
			state => {
				hookState = state
			},
			{
				onTransactionCanceled: () => {
					transactionState = markTransactionCanceled(transactionState)
				},
				onTransactionFinished: () => {
					transactionState = markTransactionFinished(transactionState)
				},
				onTransactionRequested: (intent: TransactionIntent) => {
					transactionState = markTransactionRequested(transactionState, intent)
				},
			},
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).securityVaultForm.selectedVaultAddress).toBe(zeroAddress))

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				depositAmount: '1',
				securityPoolAddress: poolA,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolA))
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(11n * REP)

		let depositPromise = Promise.resolve()
		await act(() => {
			depositPromise = requireHookState(hookState).depositRep()
		})

		await waitFor(() => expect(loadErc20Balance).toHaveBeenCalledTimes(2))
		expect(requireHookState(hookState).securityVaultFeedback?.status.tone).toBe('pending')
		expect(transactionState.pendingIntent?.action).toBe('depositRep')

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				securityPoolAddress: poolB,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB))
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(22n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(222n * REP)

		await act(async () => {
			staleBalance.resolve(11n * REP)
			await depositPromise
		})

		expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB)
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(22n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(222n * REP)
		expect(requireHookState(hookState).securityVaultFeedback).toBeUndefined()
		expect(depositRepToSecurityPool).not.toHaveBeenCalled()
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.pendingIntent).toBeUndefined()
		expect(transactionState.inFlightCount).toBe(0)
	})

	test('redeemFees ignores a stale selection change before the first write starts', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000a5')
		const poolB = getAddress('0x00000000000000000000000000000000000000b5')
		const repTokenA = getAddress('0x00000000000000000000000000000000000000c5')
		const repTokenB = getAddress('0x00000000000000000000000000000000000000d5')
		const activeWallet = createDeferred<{ accountAddress: Address; chainId: string }>()
		const detailsA = createSecurityVaultDetails(poolA, zeroAddress, repTokenA)
		const detailsB = createSecurityVaultDetails(poolB, zeroAddress, repTokenB)
		const updateSecurityVaultFees = mock(async () => ({
			action: 'updateVaultFees' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e2',
		}))
		const redeemSecurityVaultFees = mock(async () => ({
			action: 'redeemFees' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e3',
		}))

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Allowance: mock(async (_client: unknown, repToken: Address) => {
				if (repToken === repTokenA) return 111n * REP
				if (repToken === repTokenB) return 222n * REP
				throw new Error(`Unexpected REP token ${repToken}`)
			}),
			loadErc20Balance: mock(async (_client: unknown, repToken: Address) => {
				if (repToken === repTokenA) return 11n * REP
				if (repToken === repTokenB) return 22n * REP
				throw new Error(`Unexpected REP token ${repToken}`)
			}),
			loadOracleManagerDetails: mock(async () => {
				throw new Error('loadOracleManagerDetails should not be called in this test')
			}),
			loadSecurityVaultDetails: mock(async (_client: unknown, securityPoolAddress: Address) => {
				if (securityPoolAddress === poolA) return detailsA
				if (securityPoolAddress === poolB) return detailsB
				throw new Error(`Unexpected security pool ${securityPoolAddress}`)
			}),
			queueOracleManagerOperation: mock(async () => {
				throw new Error('queueOracleManagerOperation should not be called in this test')
			}),
			redeemRepFromSecurityPool: mock(async () => {
				throw new Error('redeemRepFromSecurityPool should not be called in this test')
			}),
			redeemSecurityVaultFees,
			updateSecurityVaultFees,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))
		mock.module('../lib/walletGuards.js', () => ({
			assertActiveWallet: mock(async () => await activeWallet.promise),
		}))

		const { useSecurityVaultOperations } = await import(`../hooks/useSecurityVaultOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(useSecurityVaultOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).securityVaultForm.selectedVaultAddress).toBe(zeroAddress))

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				securityPoolAddress: poolA,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolA))

		let redeemPromise = Promise.resolve()
		await act(() => {
			redeemPromise = requireHookState(hookState).redeemFees()
		})

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				securityPoolAddress: poolB,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB))

		await act(async () => {
			activeWallet.resolve({
				accountAddress: zeroAddress,
				chainId: '0x1',
			})
			await redeemPromise
		})

		expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB)
		expect(updateSecurityVaultFees).not.toHaveBeenCalled()
		expect(redeemSecurityVaultFees).not.toHaveBeenCalled()
	})

	test('withdrawRep ignores a stale preflight oracle request after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000a4')
		const poolB = getAddress('0x00000000000000000000000000000000000000b4')
		const repTokenA = getAddress('0x00000000000000000000000000000000000000c4')
		const repTokenB = getAddress('0x00000000000000000000000000000000000000d4')
		const staleWalletBalance = createDeferred<bigint>()
		const detailsA = createSecurityVaultDetails(poolA, zeroAddress, repTokenA)
		const detailsB = createSecurityVaultDetails(poolB, zeroAddress, repTokenB)

		const loadSecurityVaultDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
			if (securityPoolAddress === poolA) return detailsA
			if (securityPoolAddress === poolB) return detailsB
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const loadErc20Balance = mock(async (_client: unknown, repToken: Address) => {
			if (repToken === repTokenA) return 11n * REP
			if (repToken === repTokenB) return 22n * REP
			throw new Error(`Unexpected REP token ${repToken}`)
		})
		const loadErc20Allowance = mock(async (_client: unknown, repToken: Address) => {
			if (repToken === repTokenA) return 111n * REP
			if (repToken === repTokenB) return 222n * REP
			throw new Error(`Unexpected REP token ${repToken}`)
		})
		const queueOracleManagerOperation = mock(async () => ({
			hash: '0x00000000000000000000000000000000000000000000000000000000000000e1',
		}))
		const readClient = {
			getBalance: mock(async () => await staleWalletBalance.promise),
		}

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			depositRepToSecurityPool: mock(async () => {
				throw new Error('depositRepToSecurityPool should not be called in this test')
			}),
			loadErc20Allowance,
			loadErc20Balance,
			loadOracleManagerDetails: mock(async () => ({
				isPriceValid: true,
				requestPriceEthCost: 1n,
			})),
			loadSecurityVaultDetails,
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
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useSecurityVaultOperations } = await import(`../hooks/useSecurityVaultOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(useSecurityVaultOperations, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).securityVaultForm.selectedVaultAddress).toBe(zeroAddress))

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				repWithdrawAmount: '1',
				securityPoolAddress: poolA,
				stagedOperationTimeoutMinutes: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolA))
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(11n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(111n * REP)

		let withdrawPromise = Promise.resolve()
		await act(() => {
			withdrawPromise = requireHookState(hookState).withdrawRep()
		})

		await waitFor(() => expect(readClient.getBalance).toHaveBeenCalledTimes(1))

		await act(async () => {
			requireHookState(hookState).setSecurityVaultForm(current => ({
				...current,
				securityPoolAddress: poolB,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadSecurityVault()
		})

		await waitFor(() => expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB))
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(22n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(222n * REP)

		await act(async () => {
			staleWalletBalance.resolve(2n * 10n ** 18n)
			await withdrawPromise
		})

		expect(requireHookState(hookState).securityVaultDetails?.securityPoolAddress).toBe(poolB)
		expect(requireHookState(hookState).securityVaultRepBalance).toBe(22n * REP)
		expect(requireHookState(hookState).securityVaultRepApproval.value).toBe(222n * REP)
		expect(queueOracleManagerOperation).not.toHaveBeenCalled()
	})
})
