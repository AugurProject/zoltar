/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '@zoltar/ui-core-shared/lib/transactionTray.js'
import { useTradingOperations, type UseTradingOperationsDependencies } from '../../../features/markets/hooks/useTradingOperations.js'
import type { TransactionIntent } from '@zoltar/ui-zoltar/features/types.js'
import type { DeploymentStatus, TradingDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'

type UseTradingOperations = typeof useTradingOperations
type UseTradingOperationsState = ReturnType<UseTradingOperations>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const SECURITY_POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createDeploymentStep(id: DeploymentStatus['id']): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies: [],
		deploy: async () => zeroAddress,
		deployed: true,
		id,
		label: id,
	}
}

function createTradingDetails(overrides: Partial<TradingDetails> = {}): TradingDetails {
	return {
		maxRedeemableCompleteSetsAttoShares: 0n,
		shareBalances: {
			invalidAttoShares: 0n,
			noAttoShares: 0n,
			yesAttoShares: 0n,
		},
		universeId: 1n,
		...overrides,
	}
}

function createUniverseSummary(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThresholdAttoRep: 1n,
		forkQuestionDetails: undefined,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1n,
		universeId: 1n,
		...overrides,
	}
}

function requireHookState(state: UseTradingOperationsState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

function createHarness(
	useTradingOperations: UseTradingOperations,
	onRender: (state: UseTradingOperationsState) => void,
	onTransactionFailed: (message: string) => void,
	dependencies: UseTradingOperationsDependencies,
	{
		onTransactionCanceled = () => undefined,
		onTransactionFinished = () => undefined,
		onTransactionRequested = () => undefined,
	}: {
		onTransactionCanceled?: () => void
		onTransactionFinished?: () => void
		onTransactionRequested?: Parameters<UseTradingOperations>[0]['onTransactionRequested']
	} = {},
) {
	return function TradingOperationsHarness() {
		const state = useTradingOperations(
			{
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses: [createDeploymentStep('proxyDeployer')],
				enabled: true,
				onTransactionCanceled,
				onTransactionFailed,
				onTransactionFinished,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS,
			},
			dependencies,
		)
		onRender(state)
		return <div />
	}
}

function createTradingOperationsDependencies(overrides: Partial<UseTradingOperationsDependencies>): UseTradingOperationsDependencies {
	return {
		createCompleteSetInSecurityPool: async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called in this test')
		},
		getWalletEthBalance: async () => {
			throw new Error('getWalletEthBalance should not be called in this test')
		},
		loadSecurityPoolMintCapacity: async () => {
			throw new Error('loadSecurityPoolMintCapacity should not be called in this test')
		},
		loadTradingDetails: async () => {
			throw new Error('loadTradingDetails should not be called in this test')
		},
		loadZoltarUniverseSummary: async () => {
			throw new Error('loadZoltarUniverseSummary should not be called in this test')
		},
		migrateSharesFromUniverse: async () => {
			throw new Error('migrateSharesFromUniverse should not be called in this test')
		},
		redeemCompleteSetInSecurityPool: async () => {
			throw new Error('redeemCompleteSetInSecurityPool should not be called in this test')
		},
		redeemSharesInSecurityPool: async () => {
			throw new Error('redeemSharesInSecurityPool should not be called in this test')
		},
		...overrides,
	}
}

describe('useTradingOperations', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let resetEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetEnvironment?.()
		resetEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('blocks complete-set mint writes when latest pool capacity has no collateral exchange rate', async () => {
		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called when the latest mint capacity has no exchange rate')
		})
		const onTransactionFailed = mock(() => undefined)
		const dependencies = createTradingOperationsDependencies({
			createCompleteSetInSecurityPool,
			getWalletEthBalance: mock(async () => 2n * 10n ** 18n),
			loadSecurityPoolMintCapacity: mock(async () => ({
				settlementCollateralAttoEth: 0n,
				feeEligibleCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
				shareTokenSupplyAttoShares: 10n * 10n ** 18n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				isPriceValid: true,
			})),
			loadTradingDetails: mock(async () => createTradingDetails()),
			loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
		})

		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			dependencies,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).createCompleteSet()
		})

		expect(onTransactionFailed).toHaveBeenCalledWith('Minting is unavailable because this pool has complete-set shares but no collateral')
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
	})

	test('blocks complete-set mint writes when total capacity ownership exists but none is fee eligible', async () => {
		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called against unclaimed auction capacity ownership')
		})
		const onTransactionFailed = mock(() => undefined)
		const dependencies = createTradingOperationsDependencies({
			createCompleteSetInSecurityPool,
			getWalletEthBalance: mock(async () => 2n * 10n ** 18n),
			loadSecurityPoolMintCapacity: mock(async () => ({
				settlementCollateralAttoEth: 0n,
				feeEligibleCapacityOwnershipAttoRep: 0n,
				mintingCapacityAttoEth: 0n,
				shareTokenSupplyAttoShares: 0n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				isPriceValid: true,
			})),
			loadTradingDetails: mock(async () => createTradingDetails()),
			loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
		})

		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			dependencies,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).createCompleteSet()
		})

		expect(onTransactionFailed).toHaveBeenCalledWith('No mint capacity. No active capacity ownership')
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
	})

	test('allows the checkpoint-adjusted maximum mint amount through submit-time validation', async () => {
		const tokenPrecision = 10n ** 18n
		const createCompleteSetInSecurityPool = mock(async (_accountAddress: Address, _callbacks: unknown, securityPoolAddress: typeof SECURITY_POOL_ADDRESS, amount: bigint) => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			securityPoolAddress,
			universeId: 1n,
			amount,
		}))
		const onTransactionFailed = mock(() => undefined)
		const dependencies = createTradingOperationsDependencies({
			createCompleteSetInSecurityPool,
			getWalletEthBalance: mock(async () => 2n * tokenPrecision),
			loadSecurityPoolMintCapacity: mock(async () => ({
				currentRetentionRate: tokenPrecision / 2n,
				currentTimestamp: 2n,
				feeEligibleCapacityOwnershipAttoRep: 2n * tokenPrecision,
				feeEndTimestamp: 100n,
				feeIndexRemainder: 0n,
				isPriceValid: true,
				lastUpdatedFeeAccumulator: 1n,
				mintingCapacityAttoEth: 3n * tokenPrecision,
				settlementCollateralAttoEth: 2n * tokenPrecision,
				shareTokenSupplyAttoShares: 2n * tokenPrecision,
				totalCapacityOwnershipAttoRep: 3n * tokenPrecision,
				totalFeesOwedRemainder: 0n,
				totalPoolHeldAttoRep: 20n * tokenPrecision,
			})),
			loadTradingDetails: mock(async () => createTradingDetails()),
			loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
		})
		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			dependencies,
		)
		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({ ...current, completeSetAmount: '2' }))
		})
		await act(async () => {
			await requireHookState(hookState).createCompleteSet()
		})

		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(createCompleteSetInSecurityPool).toHaveBeenCalledTimes(1)
		expect(createCompleteSetInSecurityPool.mock.calls[0]?.[3]).toBe(2n * tokenPrecision)
	})

	test('converts redeem complete-set input to share units before submitting', async () => {
		const firstMintShareAmount = 10n ** 36n
		let submittedRedeemAmount: bigint | undefined
		const redeemCompleteSetInSecurityPool = mock(async (_accountAddress: Address, _callbacks: unknown, securityPoolAddress: typeof SECURITY_POOL_ADDRESS, amount: bigint) => {
			submittedRedeemAmount = amount
			return {
				action: 'redeemCompleteSet' as const,
				hash: zeroHash,
				securityPoolAddress,
				universeId: 1n,
			}
		})
		const onTransactionFailed = mock(() => undefined)
		const dependencies = createTradingOperationsDependencies({
			getWalletEthBalance: mock(async () => 2n * 10n ** 18n),
			loadSecurityPoolMintCapacity: mock(async () => ({
				settlementCollateralAttoEth: 1n * 10n ** 18n,
				feeEligibleCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
				shareTokenSupplyAttoShares: firstMintShareAmount,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				isPriceValid: true,
			})),
			loadTradingDetails: mock(async () =>
				createTradingDetails({
					maxRedeemableCompleteSetsAttoShares: firstMintShareAmount,
					shareBalances: {
						invalidAttoShares: firstMintShareAmount,
						noAttoShares: firstMintShareAmount,
						yesAttoShares: firstMintShareAmount,
					},
				}),
			),
			loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
			redeemCompleteSetInSecurityPool,
		})

		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			dependencies,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				redeemAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).redeemCompleteSet()
		})

		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(redeemCompleteSetInSecurityPool).toHaveBeenCalled()
		expect(submittedRedeemAmount).toBe(firstMintShareAmount)
	})

	test('createCompleteSet ignores a stale post-success refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000c1')
		const poolB = getAddress('0x00000000000000000000000000000000000000d1')
		const pendingResult = createDeferred<{
			action: 'createCompleteSet'
			hash: typeof zeroHash
			securityPoolAddress: typeof poolA
			universeId: bigint
		}>()
		const detailsA = createTradingDetails({
			shareBalances: {
				invalidAttoShares: 1n,
				noAttoShares: 2n,
				yesAttoShares: 3n,
			},
			universeId: 1n,
		})
		const detailsB = createTradingDetails({
			shareBalances: {
				invalidAttoShares: 4n,
				noAttoShares: 5n,
				yesAttoShares: 6n,
			},
			universeId: 2n,
		})
		const universeA = createUniverseSummary({ childUniverses: [{ exists: true, forkTime: 0n, outcomeIndex: 0n, outcomeLabel: 'Invalid', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 11n }], hasForked: true, universeId: 1n })
		const universeB = createUniverseSummary({ childUniverses: [{ exists: true, forkTime: 0n, outcomeIndex: 1n, outcomeLabel: 'Yes', parentUniverseId: 2n, reputationToken: zeroAddress, universeId: 22n }], hasForked: true, universeId: 2n })
		const createCompleteSetInSecurityPool = mock(async () => await pendingResult.promise)
		const loadTradingDetails = mock(async (securityPoolAddress: string) => {
			if (securityPoolAddress === poolA) return detailsA
			if (securityPoolAddress === poolB) return detailsB
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const loadZoltarUniverseSummary = mock(async (universeId: bigint) => {
			if (universeId === universeA.universeId) return universeA
			if (universeId === universeB.universeId) return universeB
			throw new Error(`Unexpected universe ${universeId.toString()}`)
		})
		const onTransactionFailed = mock(() => undefined)

		const dependencies = createTradingOperationsDependencies({
			createCompleteSetInSecurityPool,
			getWalletEthBalance: mock(async () => 2n * 10n ** 18n),
			loadSecurityPoolMintCapacity: mock(async () => ({
				settlementCollateralAttoEth: 1n * 10n ** 18n,
				feeEligibleCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
				shareTokenSupplyAttoShares: 1n * 10n ** 18n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				isPriceValid: true,
			})),
			loadTradingDetails,
			loadZoltarUniverseSummary,
		})

		let hookState: UseTradingOperationsState | undefined
		let setSelectedSecurityPoolAddress: ((value: typeof poolA | typeof poolB) => void) | undefined
		function TradingOperationsHarness() {
			const [selectedSecurityPoolAddress, setSelectedPoolAddress] = useState<typeof poolA | typeof poolB>(poolA)
			setSelectedSecurityPoolAddress = setSelectedPoolAddress
			const state = useTradingOperations(
				{
					accountAddress: WALLET_ADDRESS,
					deploymentStatuses: [createDeploymentStep('proxyDeployer')],
					enabled: true,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					selectedSecurityPoolAddress,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(TradingOperationsHarness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).tradingDetails?.universeId).toBe(universeA.universeId))
		await waitFor(() => expect(requireHookState(hookState).tradingForkUniverse?.universeId).toBe(universeA.universeId))

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireHookState(hookState).createCompleteSet()
		})

		await waitFor(() => expect(createCompleteSetInSecurityPool).toHaveBeenCalledTimes(1))

		await act(async () => {
			setSelectedSecurityPoolAddress?.(poolB)
		})

		await waitFor(() => expect(requireHookState(hookState).tradingDetails?.universeId).toBe(universeB.universeId))
		await waitFor(() => expect(requireHookState(hookState).tradingForkUniverse?.universeId).toBe(universeB.universeId))
		expect(requireHookState(hookState).tradingDetails?.shareBalances).toEqual(detailsB.shareBalances)

		await act(async () => {
			pendingResult.resolve({
				action: 'createCompleteSet',
				hash: zeroHash,
				securityPoolAddress: poolA,
				universeId: universeA.universeId,
			})
			await createPromise
		})

		expect(requireHookState(hookState).tradingDetails?.universeId).toBe(universeB.universeId)
		expect(requireHookState(hookState).tradingForkUniverse?.universeId).toBe(universeB.universeId)
		expect(requireHookState(hookState).tradingDetails?.shareBalances).toEqual(detailsB.shareBalances)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('createCompleteSet ignores a stale preflight refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000e1')
		const poolB = getAddress('0x00000000000000000000000000000000000000e2')
		const deferredMintCapacity = createDeferred<{
			settlementCollateralAttoEth: bigint
			feeEligibleCapacityOwnershipAttoRep: bigint
			mintingCapacityAttoEth: bigint
			shareTokenSupplyAttoShares: bigint
			totalPoolHeldAttoRep: bigint
			totalCapacityOwnershipAttoRep: bigint
			isPriceValid: boolean
		}>()
		const detailsA = createTradingDetails({ universeId: 1n })
		const detailsB = createTradingDetails({ universeId: 2n })
		const universeA = createUniverseSummary({ hasForked: true, universeId: 1n })
		const universeB = createUniverseSummary({ hasForked: true, universeId: 2n })
		const createCompleteSetInSecurityPool = mock(async () => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			securityPoolAddress: poolA,
			universeId: universeA.universeId,
		}))
		const loadTradingDetails = mock(async (securityPoolAddress: string) => {
			if (securityPoolAddress === poolA) return detailsA
			if (securityPoolAddress === poolB) return detailsB
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const loadZoltarUniverseSummary = mock(async (universeId: bigint) => {
			if (universeId === universeA.universeId) return universeA
			if (universeId === universeB.universeId) return universeB
			throw new Error(`Unexpected universe ${universeId.toString()}`)
		})
		const onTransactionFailed = mock(() => undefined)
		let transactionState = createInitialTransactionTrayState()

		const dependencies = createTradingOperationsDependencies({
			createCompleteSetInSecurityPool,
			getWalletEthBalance: mock(async () => 2n * 10n ** 18n),
			loadSecurityPoolMintCapacity: mock(async () => await deferredMintCapacity.promise),
			loadTradingDetails,
			loadZoltarUniverseSummary,
		})

		let hookState: UseTradingOperationsState | undefined
		let setSelectedSecurityPoolAddress: ((value: typeof poolA | typeof poolB) => void) | undefined
		function TradingOperationsHarness() {
			const [selectedSecurityPoolAddress, setSelectedPoolAddress] = useState<typeof poolA | typeof poolB>(poolA)
			setSelectedSecurityPoolAddress = setSelectedPoolAddress
			hookState = useTradingOperations(
				{
					accountAddress: WALLET_ADDRESS,
					deploymentStatuses: [createDeploymentStep('proxyDeployer')],
					enabled: true,
					onTransactionCanceled: () => {
						transactionState = markTransactionCanceled(transactionState)
					},
					onTransactionFailed,
					onTransactionFinished: () => {
						transactionState = markTransactionFinished(transactionState)
					},
					onTransactionPresented: () => undefined,
					onTransactionRequested: (intent: TransactionIntent) => {
						transactionState = markTransactionRequested(transactionState, intent)
					},
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					selectedSecurityPoolAddress,
				},
				dependencies,
			)
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(TradingOperationsHarness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).tradingDetails?.universeId).toBe(universeA.universeId))

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireHookState(hookState).createCompleteSet()
		})

		await waitFor(() => expect(loadTradingDetails).toHaveBeenCalled())
		expect(requireHookState(hookState).tradingFeedback?.status.tone).toBe('pending')
		expect(transactionState.pendingIntent?.action).toBe('createCompleteSet')

		await act(async () => {
			setSelectedSecurityPoolAddress?.(poolB)
		})

		await waitFor(() => expect(requireHookState(hookState).tradingDetails?.universeId).toBe(universeB.universeId))

		await act(async () => {
			deferredMintCapacity.resolve({
				settlementCollateralAttoEth: 1n * 10n ** 18n,
				feeEligibleCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				mintingCapacityAttoEth: 2n * 10n ** 18n,
				shareTokenSupplyAttoShares: 1n * 10n ** 18n,
				totalPoolHeldAttoRep: 20n * 10n ** 18n,
				totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
				isPriceValid: true,
			})
			await createPromise
		})

		expect(requireHookState(hookState).tradingDetails?.universeId).toBe(universeB.universeId)
		expect(requireHookState(hookState).tradingFeedback).toBeUndefined()
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.pendingIntent).toBeUndefined()
		expect(transactionState.inFlightCount).toBe(0)
	})

	test('does not request a mint transaction when the active wallet account changed', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called when the active wallet account changed')
		})
		const getWalletEthBalance = mock(async () => 2n * 10n ** 18n)
		const onTransactionFailed = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)
		const loadSecurityPoolMintCapacity = mock(async () => ({
			settlementCollateralAttoEth: 1n * 10n ** 18n,
			feeEligibleCapacityOwnershipAttoRep: 2n * 10n ** 18n,
			mintingCapacityAttoEth: 2n * 10n ** 18n,
			shareTokenSupplyAttoShares: 1n * 10n ** 18n,
			totalPoolHeldAttoRep: 20n * 10n ** 18n,
			totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
			isPriceValid: true,
		}))
		const loadTradingDetails = mock(async () => createTradingDetails())
		const loadZoltarUniverseSummary = mock(async () => createUniverseSummary())

		const dependencies = createTradingOperationsDependencies({
			createCompleteSetInSecurityPool,
			getWalletEthBalance,
			loadSecurityPoolMintCapacity,
			loadTradingDetails,
			loadZoltarUniverseSummary,
		})

		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			dependencies,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup
		getWalletEthBalance.mockClear()
		loadTradingDetails.mockClear()
		loadZoltarUniverseSummary.mockClear()
		loadSecurityPoolMintCapacity.mockClear()

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				completeSetAmount: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).createCompleteSet()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
		expect(getWalletEthBalance).not.toHaveBeenCalled()
		expect(loadTradingDetails).not.toHaveBeenCalled()
		expect(loadZoltarUniverseSummary).not.toHaveBeenCalled()
		expect(loadSecurityPoolMintCapacity).not.toHaveBeenCalled()
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
	})

	test('does not request a share-migration transaction when the active wallet account changed', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const migrateSharesFromUniverse = mock(async () => {
			throw new Error('migrateSharesFromUniverse should not be called when the active wallet account changed')
		})
		const getWalletEthBalance = mock(async () => 2n * 10n ** 18n)
		const onTransactionFailed = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)
		const loadTradingDetails = mock(async () =>
			createTradingDetails({
				shareBalances: {
					invalidAttoShares: 0n,
					noAttoShares: 1n * 10n ** 18n,
					yesAttoShares: 1n * 10n ** 18n,
				},
			}),
		)
		const loadZoltarUniverseSummary = mock(async () =>
			createUniverseSummary({
				childUniverses: [
					{
						exists: true,
						forkTime: 0n,
						outcomeIndex: 0n,
						outcomeLabel: 'Invalid',
						parentUniverseId: 1n,
						reputationToken: zeroAddress,
						universeId: 2n,
					},
				],
				hasForked: true,
			}),
		)

		const dependencies = createTradingOperationsDependencies({
			getWalletEthBalance,
			loadTradingDetails,
			loadZoltarUniverseSummary,
			migrateSharesFromUniverse,
		})

		let hookState: UseTradingOperationsState | undefined
		const Harness = createHarness(
			useTradingOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
			dependencies,
			{ onTransactionRequested },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup
		getWalletEthBalance.mockClear()
		loadTradingDetails.mockClear()
		loadZoltarUniverseSummary.mockClear()

		await act(async () => {
			requireHookState(hookState).setTradingForm(current => ({
				...current,
				selectedShareOutcome: 'yes',
				targetOutcomeIndexes: '0,1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).migrateShares()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
		expect(getWalletEthBalance).not.toHaveBeenCalled()
		expect(loadTradingDetails).not.toHaveBeenCalled()
		expect(loadZoltarUniverseSummary).not.toHaveBeenCalled()
		expect(migrateSharesFromUniverse).not.toHaveBeenCalled()
	})
})
