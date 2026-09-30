/// <reference types='bun-types' />

import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TradingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useTradingOperations, type UseTradingOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

type UseTradingOperationsParameters = Parameters<typeof useTradingOperations>[0]
type MintCapacity = Awaited<ReturnType<UseTradingOperationsDependencies['loadSecurityPoolMintCapacity']>>
type HarnessProps = { enabled?: boolean; selectedSecurityPoolAddress?: Address }

const ATTO_ETH_PER_ETH = 10n ** 18n
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const SECURITY_POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const WALLET_ACCOUNT_CHANGED = 'Wallet account changed. Review the action with the connected account and try again'
const PROXY_DEPLOYER_STEP: DeploymentStatus = {
	address: zeroAddress,
	dependencies: [],
	deploy: async () => zeroAddress,
	deployed: true,
	id: 'proxyDeployer',
	label: 'proxyDeployer',
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

function createChildUniverse(parentUniverseId: bigint, outcomeIndex: bigint, outcomeLabel: string, universeId: bigint): ZoltarUniverseSummary['childUniverses'][number] {
	return { exists: true, forkTime: 0n, outcomeIndex, outcomeLabel, parentUniverseId, reputationToken: zeroAddress, universeId }
}

function createMintCapacity(overrides: Partial<MintCapacity> = {}): MintCapacity {
	return {
		currentTimestamp: 100n,
		priceValidUntilTimestamp: 400n,
		settlementCollateralAttoEth: ATTO_ETH_PER_ETH,
		feeEligibleUnderwritingLimitAttoEth: 2n * ATTO_ETH_PER_ETH,
		mintingCapacityAttoEth: 2n * ATTO_ETH_PER_ETH,
		shareTokenSupplyAttoShares: ATTO_ETH_PER_ETH,
		totalPoolHeldAttoRep: 20n * ATTO_ETH_PER_ETH,
		totalUnderwritingLimitAttoEth: 2n * ATTO_ETH_PER_ETH,
		isPriceValid: true,
		...overrides,
	}
}

function createTradingOperationsDependencies(overrides: Partial<UseTradingOperationsDependencies>): UseTradingOperationsDependencies {
	const unexpected = (name: string) => async () => {
		throw new Error(`${name} should not be called in this test`)
	}
	return {
		createCompleteSetInSecurityPool: unexpected('createCompleteSetInSecurityPool'),
		getWalletEthBalance: unexpected('getWalletEthBalance'),
		loadSecurityPoolMintCapacity: unexpected('loadSecurityPoolMintCapacity'),
		loadTradingDetails: unexpected('loadTradingDetails'),
		loadZoltarUniverseSummary: unexpected('loadZoltarUniverseSummary'),
		migrateSharesFromUniverse: unexpected('migrateSharesFromUniverse'),
		redeemCompleteSetInSecurityPool: unexpected('redeemCompleteSetInSecurityPool'),
		redeemSharesInSecurityPool: unexpected('redeemSharesInSecurityPool'),
		...overrides,
	}
}

/** Mint-ready dependencies: a funded wallet, default pool capacity, and single-universe pool reads. */
function createMintDependencies(overrides: Partial<UseTradingOperationsDependencies>): UseTradingOperationsDependencies {
	return createTradingOperationsDependencies({
		getWalletEthBalance: mock(async () => 2n * ATTO_ETH_PER_ETH),
		loadSecurityPoolMintCapacity: mock(async () => createMintCapacity()),
		loadTradingDetails: mock(async () => createTradingDetails()),
		loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
		...overrides,
	})
}

/** Two pools on different universes, so a test can switch the selected pool and tell whose data is displayed. */
function createTwoPoolReads(pools: { address: Address; details: TradingDetails; universe: ZoltarUniverseSummary }[]) {
	return {
		loadTradingDetails: mock(async (securityPoolAddress: Address) => {
			const pool = pools.find(candidate => candidate.address === securityPoolAddress)
			if (pool === undefined) throw new Error(`Unexpected security pool ${securityPoolAddress}`)
			return pool.details
		}),
		loadZoltarUniverseSummary: mock(async (universeId: bigint) => {
			const pool = pools.find(candidate => candidate.universe.universeId === universeId)
			if (pool === undefined) throw new Error(`Unexpected universe ${universeId.toString()}`)
			return pool.universe
		}),
	}
}

describe('useTradingOperations', () => {
	const { replaceEnvironment, trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	async function renderTradingHook(dependencies: UseTradingOperationsDependencies, parameters: Partial<UseTradingOperationsParameters> = {}, initialProps: HarnessProps = {}) {
		const onTransactionFailed = mock((_message: string, _details?: unknown) => undefined)
		let hookState: ReturnType<typeof useTradingOperations> | undefined
		function TradingOperationsHarness({ enabled = true, selectedSecurityPoolAddress = SECURITY_POOL_ADDRESS }: HarnessProps) {
			hookState = useTradingOperations(
				{
					accountAddress: WALLET_ADDRESS,
					deploymentStatuses: [PROXY_DEPLOYER_STEP],
					enabled,
					onTransactionCanceled: () => undefined,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					selectedSecurityPoolAddress,
					...parameters,
				},
				dependencies,
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<TradingOperationsHarness {...initialProps} />)
		trackCleanup(rendered.cleanup)
		const state = () => requireHookState(hookState)
		return {
			onTransactionFailed,
			state,
			rerender: async (props: HarnessProps) => {
				await act(async () => {
					render(<TradingOperationsHarness {...props} />, rendered.container)
				})
			},
			setForm: async (update: Partial<ReturnType<typeof useTradingOperations>['tradingForm']>) => {
				await act(async () => {
					state().setTradingForm(current => ({ ...current, ...update }))
				})
			},
		}
	}

	test('disabling pool reads clears stale errors and discards an outstanding decode failure', async () => {
		const pendingDetails = createDeferred<TradingDetails>()
		const loadTradingDetails = mock(async () => await pendingDetails.promise)
		const hook = await renderTradingHook(createTradingOperationsDependencies({ loadTradingDetails }), {}, { enabled: false })
		expect(loadTradingDetails).not.toHaveBeenCalled()
		await hook.rerender({ enabled: true })
		await waitFor(() => expect(loadTradingDetails).toHaveBeenCalledTimes(1))
		await hook.rerender({ enabled: false })
		await act(async () => {
			pendingDetails.reject(new Error('Unable to decode universeId result'))
			await Promise.resolve()
		})
		expect(hook.state().tradingError).toBeUndefined()
		expect(hook.state().tradingDetails).toBeUndefined()
	})

	test.each([
		{
			capacity: createMintCapacity({ settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 10n * ATTO_ETH_PER_ETH }),
			expectedMessage: 'Minting is unavailable because this pool has complete-set shares but no collateral',
			name: 'latest pool capacity has no collateral exchange rate',
		},
		{
			capacity: createMintCapacity({ settlementCollateralAttoEth: 0n, feeEligibleUnderwritingLimitAttoEth: 0n, mintingCapacityAttoEth: 0n, shareTokenSupplyAttoShares: 0n }),
			expectedMessage: 'No mint capacity. No active underwriting commitments',
			name: 'total underwriting commitments exists but none is fee eligible',
		},
	])('blocks complete-set mint writes when $name', async ({ capacity, expectedMessage }) => {
		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called when minting is blocked')
		})
		const hook = await renderTradingHook(createMintDependencies({ createCompleteSetInSecurityPool, loadSecurityPoolMintCapacity: mock(async () => capacity) }))

		await hook.setForm({ completeSetAmount: '1' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})

		expect(hook.onTransactionFailed).toHaveBeenCalledWith(expectedMessage, expect.objectContaining({ kind: 'error' }))
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
	})

	test.each([399n, 340n])('blocks a still-fresh mint without a safe inclusion window at %s', async currentTimestamp => {
		const createCompleteSetInSecurityPool = mock(async () => ({ action: 'createCompleteSet' as const, hash: zeroHash, securityPoolAddress: SECURITY_POOL_ADDRESS, universeId: 1n }))
		const hook = await renderTradingHook(createMintDependencies({ createCompleteSetInSecurityPool, loadSecurityPoolMintCapacity: mock(async () => ({ ...createMintCapacity(), currentTimestamp, priceValidUntilTimestamp: 400n })) }))
		await hook.setForm({ completeSetAmount: '1' })
		await act(async () => await hook.state().createCompleteSet())
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
		expect(hook.onTransactionFailed).toHaveBeenCalledWith('The oracle price expires too soon. Mint after a new price settles', expect.objectContaining({ kind: 'error' }))
	})

	test('allows the checkpoint-adjusted maximum mint amount through submit-time validation', async () => {
		const createCompleteSetInSecurityPool = mock(async (_accountAddress: Address, _callbacks: unknown, securityPoolAddress: Address, amount: bigint) => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			securityPoolAddress,
			universeId: 1n,
			amount,
		}))
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInSecurityPool,
				loadSecurityPoolMintCapacity: mock(async () =>
					createMintCapacity({
						currentRetentionRate: ATTO_ETH_PER_ETH / 2n,
						currentTimestamp: 2n,
						feeEligibleUnderwritingLimitAttoEth: 3n * ATTO_ETH_PER_ETH,
						feeEndTimestamp: 100n,
						feeIndexRemainder: 0n,
						lastUpdatedFeeAccumulator: 1n,
						mintingCapacityAttoEth: 3n * ATTO_ETH_PER_ETH,
						settlementCollateralAttoEth: 2n * ATTO_ETH_PER_ETH,
						shareTokenSupplyAttoShares: 2n * ATTO_ETH_PER_ETH,
						totalUnderwritingLimitAttoEth: 3n * ATTO_ETH_PER_ETH,
						totalFeesOwedRemainder: 0n,
					}),
				),
			}),
		)

		await hook.setForm({ completeSetAmount: '1.999999999999999999' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(createCompleteSetInSecurityPool).toHaveBeenCalledTimes(1)
		expect(createCompleteSetInSecurityPool.mock.calls[0]?.[3]).toBe(2n * ATTO_ETH_PER_ETH - 1n)
	})

	test('converts redeem complete-set input to share units before submitting', async () => {
		const firstMintShareAmount = ATTO_ETH_PER_ETH
		let submittedRedeemAmount: bigint | undefined
		const redeemCompleteSetInSecurityPool = mock(async (_accountAddress: Address, _callbacks: unknown, securityPoolAddress: Address, amount: bigint) => {
			submittedRedeemAmount = amount
			return {
				action: 'redeemCompleteSet' as const,
				hash: zeroHash,
				securityPoolAddress,
				universeId: 1n,
			}
		})
		const hook = await renderTradingHook(
			createMintDependencies({
				loadSecurityPoolMintCapacity: mock(async () => createMintCapacity({ shareTokenSupplyAttoShares: firstMintShareAmount })),
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
				redeemCompleteSetInSecurityPool,
			}),
		)

		await hook.setForm({ redeemAmount: '1' })
		await act(async () => {
			await hook.state().redeemCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(redeemCompleteSetInSecurityPool).toHaveBeenCalled()
		expect(submittedRedeemAmount).toBe(firstMintShareAmount)
	})

	test('redeems the exact share balance when the ETH amount is the redeemable maximum', async () => {
		let submittedRedeemAmount: bigint | undefined
		const redeemCompleteSetInSecurityPool = mock(async (_accountAddress: Address, _callbacks: unknown, securityPoolAddress: Address, amount: bigint) => {
			submittedRedeemAmount = amount
			return { action: 'redeemCompleteSet' as const, hash: zeroHash, securityPoolAddress, universeId: 1n }
		})
		const hook = await renderTradingHook(
			createMintDependencies({
				loadSecurityPoolMintCapacity: mock(async () => createMintCapacity({ settlementCollateralAttoEth: 7n, shareTokenSupplyAttoShares: 100n })),
				loadTradingDetails: mock(async () => createTradingDetails({ maxRedeemableCompleteSetsAttoShares: 99n, shareBalances: { invalidAttoShares: 99n, noAttoShares: 99n, yesAttoShares: 99n } })),
				redeemCompleteSetInSecurityPool,
			}),
		)

		// 99 shares are worth 6 attoETH, which converts back to only 86 shares.
		await hook.setForm({ redeemAmount: '0.000000000000000006' })
		await act(async () => {
			await hook.state().redeemCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(submittedRedeemAmount).toBe(99n)
	})

	test('createCompleteSet ignores a stale post-success refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000c1')
		const poolB = getAddress('0x00000000000000000000000000000000000000d1')
		const pendingResult = createDeferred<{ action: 'createCompleteSet'; hash: typeof zeroHash; securityPoolAddress: Address; universeId: bigint }>()
		const detailsA = createTradingDetails({ shareBalances: { invalidAttoShares: 1n, noAttoShares: 2n, yesAttoShares: 3n }, universeId: 1n })
		const detailsB = createTradingDetails({ shareBalances: { invalidAttoShares: 4n, noAttoShares: 5n, yesAttoShares: 6n }, universeId: 2n })
		const universeA = createUniverseSummary({ childUniverses: [createChildUniverse(1n, 0n, 'Invalid', 11n)], hasForked: true, universeId: 1n })
		const universeB = createUniverseSummary({ childUniverses: [createChildUniverse(2n, 1n, 'Yes', 22n)], hasForked: true, universeId: 2n })
		const createCompleteSetInSecurityPool = mock(async () => await pendingResult.promise)
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInSecurityPool,
				...createTwoPoolReads([
					{ address: poolA, details: detailsA, universe: universeA },
					{ address: poolB, details: detailsB, universe: universeB },
				]),
			}),
			{},
			{ selectedSecurityPoolAddress: poolA },
		)

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeA.universeId))
		await waitFor(() => expect(hook.state().tradingForkUniverse?.universeId).toBe(universeA.universeId))

		await hook.setForm({ completeSetAmount: '1' })
		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = hook.state().createCompleteSet()
		})

		await waitFor(() => expect(createCompleteSetInSecurityPool).toHaveBeenCalledTimes(1))

		await hook.rerender({ selectedSecurityPoolAddress: poolB })

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId))
		await waitFor(() => expect(hook.state().tradingForkUniverse?.universeId).toBe(universeB.universeId))
		expect(hook.state().tradingDetails?.shareBalances).toEqual(detailsB.shareBalances)

		await act(async () => {
			pendingResult.resolve({
				action: 'createCompleteSet',
				hash: zeroHash,
				securityPoolAddress: poolA,
				universeId: universeA.universeId,
			})
			await createPromise
		})

		expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId)
		expect(hook.state().tradingForkUniverse?.universeId).toBe(universeB.universeId)
		expect(hook.state().tradingDetails?.shareBalances).toEqual(detailsB.shareBalances)
		expect(hook.onTransactionFailed.mock.calls).toEqual([])
	})

	test('createCompleteSet ignores a stale preflight refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000e1')
		const poolB = getAddress('0x00000000000000000000000000000000000000e2')
		const deferredMintCapacity = createDeferred<MintCapacity>()
		const universeA = createUniverseSummary({ hasForked: true, universeId: 1n })
		const universeB = createUniverseSummary({ hasForked: true, universeId: 2n })
		const createCompleteSetInSecurityPool = mock(async () => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			securityPoolAddress: poolA,
			universeId: universeA.universeId,
		}))
		const poolReads = createTwoPoolReads([
			{ address: poolA, details: createTradingDetails({ universeId: 1n }), universe: universeA },
			{ address: poolB, details: createTradingDetails({ universeId: 2n }), universe: universeB },
		])
		let transactionState = createInitialTransactionTrayState()
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInSecurityPool,
				loadSecurityPoolMintCapacity: mock(async () => await deferredMintCapacity.promise),
				...poolReads,
			}),
			{
				onTransactionCanceled: () => {
					transactionState = markTransactionCanceled(transactionState)
				},
				onTransactionFinished: () => {
					transactionState = markTransactionFinished(transactionState)
				},
				onTransactionRequested: intent => {
					transactionState = markTransactionRequested(transactionState, intent)
				},
			},
			{ selectedSecurityPoolAddress: poolA },
		)

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeA.universeId))

		await hook.setForm({ completeSetAmount: '1' })
		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = hook.state().createCompleteSet()
		})

		await waitFor(() => expect(poolReads.loadTradingDetails).toHaveBeenCalled())
		expect(hook.state().tradingFeedback?.status.tone).toBe('pending')
		expect(transactionState.entries[0]?.intent.action).toBe('createCompleteSet')

		await hook.rerender({ selectedSecurityPoolAddress: poolB })

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId))

		await act(async () => {
			deferredMintCapacity.resolve(createMintCapacity())
			await createPromise
		})

		expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId)
		expect(hook.state().tradingFeedback).toBeUndefined()
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.entries).toEqual([])
	})

	test('does not request a mint transaction when the active wallet account changed', async () => {
		replaceEnvironment(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const createCompleteSetInSecurityPool = mock(async () => {
			throw new Error('createCompleteSetInSecurityPool should not be called when the active wallet account changed')
		})
		const getWalletEthBalance = mock(async () => 2n * ATTO_ETH_PER_ETH)
		const onTransactionRequested = mock(() => undefined)
		const loadSecurityPoolMintCapacity = mock(async () => createMintCapacity())
		const loadTradingDetails = mock(async () => createTradingDetails())
		const loadZoltarUniverseSummary = mock(async () => createUniverseSummary())
		const hook = await renderTradingHook(createTradingOperationsDependencies({ createCompleteSetInSecurityPool, getWalletEthBalance, loadSecurityPoolMintCapacity, loadTradingDetails, loadZoltarUniverseSummary }), { onTransactionRequested })
		const reads = [getWalletEthBalance, loadTradingDetails, loadZoltarUniverseSummary, loadSecurityPoolMintCapacity]
		for (const read of reads) read.mockClear()

		await hook.setForm({ completeSetAmount: '1' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(hook.state().tradingFeedback?.status.detail).toBe(WALLET_ACCOUNT_CHANGED)
		for (const read of reads) expect(read).not.toHaveBeenCalled()
		expect(createCompleteSetInSecurityPool).not.toHaveBeenCalled()
	})

	test('does not request a share-migration transaction when the active wallet account changed', async () => {
		replaceEnvironment(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const migrateSharesFromUniverse = mock(async () => {
			throw new Error('migrateSharesFromUniverse should not be called when the active wallet account changed')
		})
		const getWalletEthBalance = mock(async () => 2n * ATTO_ETH_PER_ETH)
		const onTransactionRequested = mock(() => undefined)
		const loadTradingDetails = mock(async () => createTradingDetails({ shareBalances: { invalidAttoShares: 0n, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH } }))
		const loadZoltarUniverseSummary = mock(async () => createUniverseSummary({ childUniverses: [createChildUniverse(1n, 0n, 'Invalid', 2n)], hasForked: true }))
		const hook = await renderTradingHook(createTradingOperationsDependencies({ getWalletEthBalance, loadTradingDetails, loadZoltarUniverseSummary, migrateSharesFromUniverse }), { onTransactionRequested })
		const reads = [getWalletEthBalance, loadTradingDetails, loadZoltarUniverseSummary]
		for (const read of reads) read.mockClear()

		await hook.setForm({ selectedShareOutcome: 'yes', targetOutcomeIndexes: '0,1' })
		await act(async () => {
			await hook.state().migrateShares()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(hook.state().tradingFeedback?.status.detail).toBe(WALLET_ACCOUNT_CHANGED)
		for (const read of reads) expect(read).not.toHaveBeenCalled()
		expect(migrateSharesFromUniverse).not.toHaveBeenCalled()
	})
})
