/// <reference types='bun-types' />

import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { LiquidationApprovalDetails, OracleManagerDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { UseSecurityPoolsOverviewDependencies } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import type { GlobalTransactionPresentation } from '@zoltar/ui-zoltar-shared/features/types.js'
import { type CoordinatorFundingRequirement, createCoordinatorFundingRequirement, createSecurityPoolsOverviewDependencies, renderSecurityPoolsOverviewHook, type TestSecurityPoolsOverviewWriteClient } from './testSupport/securityPoolsOverviewDependencies.js'

const WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECOND_WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const REP_TOKEN_ADDRESS = getAddress('0x0000000000000000000000000000000000000006')

// Funding for a 2 REP/ETH initial report that needs 10 REP and 5 WETH.
const createPricedFunding = (overrides: Partial<CoordinatorFundingRequirement> = {}) =>
	createCoordinatorFundingRequirement({
		currentRepBalanceAttoRep: 25n,
		currentWethBalanceAttoEth: 2n,
		requiredRepAttoRep: 10n,
		initialReportAmount2: 10n,
		maximumInitialAttoWeth: 5n,
		minimumToken1ReportAttoEth: 5n,
		proposedRepPerEthPrice: 2n * 10n ** 18n,
		reputationTokenAddress: REP_TOKEN_ADDRESS,
		wethShortfallAttoEth: 3n,
		...overrides,
	})

const invalidPriceManagerDetails: OracleManagerDetails = {
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
}

const mockQueuedLiquidation = (hash: `0x${string}`) => mock(async () => ({ action: 'queueLiquidation' as const, hash, securityPoolAddress: zeroAddress }))
const unexpectedPageLoad = () =>
	mock(async () => {
		throw new Error('loadSecurityPoolPage should not be called in this test')
	})

describe('useSecurityPoolsOverview queueLiquidation', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	const renderHook = async (dependencies: UseSecurityPoolsOverviewDependencies<TestSecurityPoolsOverviewWriteClient>, options: Parameters<typeof renderSecurityPoolsOverviewHook>[1] = {}) => {
		const hook = await renderSecurityPoolsOverviewHook(dependencies, { accountAddress: WALLET_ADDRESS, ...options })
		trackCleanup(hook.cleanup)
		return hook
	}

	// Opens the modal for the connected wallet and fills a one-ETH, five-minute liquidation of vault 0x…01.
	const fillLiquidationForm = async (state: Awaited<ReturnType<typeof renderHook>>['state']) => {
		await act(() => {
			state().openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			state().setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			state().setLiquidationAmount('1')
			state().setLiquidationTimeoutMinutes('5')
		})
	}

	test('uses the supplied initial price for liquidation funding and submission', async () => {
		const price = 3n * 10n ** 18n
		const queueSecurityPoolLiquidation = mock(async () => ({ hash: '0x01' as const }))
		const dependencies = createSecurityPoolsOverviewDependencies({ loadOracleManagerQueueOperationEthValue: mock(async () => 1n), queueSecurityPoolLiquidation, createConnectedReadClient: () => ({ getBalance: async () => 10n ** 18n }) })
		const funding = createCoordinatorFundingRequirement()
		const loadFunding = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _manager: Address, _wallet: Address, proposedPrice?: bigint) => {
			if (proposedPrice === undefined) throw new Error('Automatic pricing unavailable')
			return { ...funding, proposedRepPerEthPrice: proposedPrice }
		})
		dependencies.loadCoordinatorInitialReportFundingRequirement = loadFunding
		const { state } = await renderHook(dependencies)
		await act(async () => {
			state().openLiquidationModal(zeroAddress, zeroAddress, SECOND_WALLET_ADDRESS, 1n * 10n ** 18n)
			state().setLiquidationAmount('1')
			await state().loadLiquidationFundingPreview(zeroAddress, price)
		})
		expect(state().liquidationFundingPreviewError).toBeUndefined()
		await act(async () => await state().queueLiquidation(zeroAddress, zeroAddress, price))
		expect(state().securityPoolLiquidationError).toBeUndefined()
		expect(loadFunding).toHaveBeenCalledWith(expect.anything(), zeroAddress, WALLET_ADDRESS, price)
		expect(queueSecurityPoolLiquidation).toHaveBeenCalledWith(expect.anything(), zeroAddress, SECOND_WALLET_ADDRESS, 1n * 10n ** 18n, 300n, 0n, WALLET_ADDRESS, `0x${'00'.repeat(32)}`, price)
	})

	test('ignores a late automatic funding result after switching to a manual price', async () => {
		const dependencies = createSecurityPoolsOverviewDependencies({ loadOracleManagerQueueOperationEthValue: mock(async () => 1n) })
		const funding = createCoordinatorFundingRequirement()
		const automaticFunding = createDeferred<typeof funding>()
		const loadFunding = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _manager: Address, _wallet: Address, price?: bigint) => (price === undefined ? await automaticFunding.promise : { ...funding, requiredRepAttoRep: price }))
		dependencies.loadCoordinatorInitialReportFundingRequirement = loadFunding
		const { state } = await renderHook(dependencies)
		await act(() => {
			state().openLiquidationModal(zeroAddress, zeroAddress, SECOND_WALLET_ADDRESS, 1n)
		})
		const automaticLoad = state().loadLiquidationFundingPreview(zeroAddress)
		await waitFor(() => {
			expect(loadFunding).toHaveBeenCalledTimes(1)
		})
		await act(async () => {
			await state().loadLiquidationFundingPreview(zeroAddress, 3n)
		})
		expect(state().liquidationFundingPreview?.initialReportRepRequiredAttoRep).toBe(3n)
		automaticFunding.resolve(funding)
		await act(async () => {
			await automaticLoad
		})
		expect(state().liquidationFundingPreview?.initialReportRepRequiredAttoRep).toBe(3n)
	})

	test('snapshots submitted modal inputs before async preflight completes', async () => {
		const queueOperationValue = createDeferred<bigint>()
		const queueSecurityPoolLiquidation = mockQueuedLiquidation('0x01')
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				loadOracleManagerQueueOperationEthValue: mock(async () => await queueOperationValue.promise),
				loadSecurityPoolPage: unexpectedPageLoad(),
				queueSecurityPoolLiquidation,
			}),
		)
		await fillLiquidationForm(state)

		const queuePromise = act(async () => {
			await state().queueLiquidation(zeroAddress, zeroAddress)
		})

		await act(() => {
			state().setLiquidationTargetVault('0x0000000000000000000000000000000000000002')
			state().setLiquidationAmount('2')
			state().setLiquidationTimeoutMinutes('1')
		})

		queueOperationValue.resolve(0n)
		await queuePromise

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledWith(expect.anything(), zeroAddress, '0x0000000000000000000000000000000000000001', 10n ** 18n, 5n * 60n, 0n, '0x0000000000000000000000000000000000000001', `0x${'00'.repeat(32)}`, undefined)
	})

	test('keeps the dialog closed when a liquidation the user closed while pending fails', async () => {
		const queueOperationValue = createDeferred<bigint>()
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				loadOracleManagerQueueOperationEthValue: mock(async () => await queueOperationValue.promise),
				loadSecurityPoolPage: unexpectedPageLoad(),
				queueSecurityPoolLiquidation: mock(async () => {
					throw new Error('queued liquidation failure')
				}),
			}),
		)
		await fillLiquidationForm(state)

		const queuePromise = act(async () => {
			await state().queueLiquidation(zeroAddress, zeroAddress)
		})
		await act(() => {
			state().closeLiquidationModal()
		})
		queueOperationValue.resolve(0n)
		await queuePromise

		// The failure reaches the transaction toast; the dismissed dialog does not reopen.
		expect(state().liquidationModalOpen).toBe(false)
		expect(state().securityPoolLiquidationError).toBeUndefined()
	})

	test('ignores stale modal errors after the user edits the form', async () => {
		const queueOperationValue = createDeferred<bigint>()
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				loadOracleManagerQueueOperationEthValue: mock(async () => await queueOperationValue.promise),
				loadSecurityPoolPage: unexpectedPageLoad(),
				queueSecurityPoolLiquidation: mock(async () => {
					throw new Error('stale queued liquidation failure')
				}),
			}),
		)
		await fillLiquidationForm(state)

		const queuePromise = act(async () => {
			await state().queueLiquidation(zeroAddress, zeroAddress)
		})

		await act(() => {
			state().setLiquidationAmount('2')
		})
		queueOperationValue.resolve(0n)
		await queuePromise

		await waitFor(() => {
			expect(state().securityPoolLiquidationError).toBeUndefined()
		})
	})

	test('skips wallet ETH balance reads for zero-cost liquidations', async () => {
		const queueSecurityPoolLiquidation = mockQueuedLiquidation('0x02')
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				createConnectedReadClient: mock(() => ({
					getBalance: async () => {
						throw new Error('wallet ETH balance should not be loaded')
					},
				})),
				loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
				loadSecurityPoolPage: unexpectedPageLoad(),
				queueSecurityPoolLiquidation,
			}),
		)
		await fillLiquidationForm(state)

		await act(async () => {
			await state().queueLiquidation(zeroAddress, zeroAddress)
		})

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
	})

	test('loads the exact buffered queue cost and WETH wrap into one funding preview', async () => {
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				loadCoordinatorInitialReportFundingRequirement: mock(async () => createPricedFunding()),
				loadOracleManagerQueueOperationEthValue: mock(async () => 12n),
			}),
		)

		await act(() => {
			state().openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
		})
		await act(async () => {
			await state().loadLiquidationFundingPreview(zeroAddress)
		})

		expect(state().liquidationFundingPreview).toEqual({
			currentRepBalanceAttoRep: 25n,
			currentWethBalanceAttoEth: 2n,
			initialReportRepRequiredAttoRep: 10n,
			initialReportWethRequiredAttoEth: 5n,
			queueOperationValueAttoEth: 12n,
			totalWalletEthRequiredAttoEth: 15n,
			wethShortfallAttoEth: 3n,
		})
	})

	describe('wallet switches', () => {
		const firstWalletFunding = () => createPricedFunding()
		const secondWalletFunding = () => createPricedFunding({ currentRepBalanceAttoRep: 50n, currentWethBalanceAttoEth: 4n, wethShortfallAttoEth: 1n })

		test('moves a receiver that follows the wallet to the newly connected wallet', async () => {
			const { rerender, state } = await renderHook(createSecurityPoolsOverviewDependencies())
			await act(() => {
				state().openLiquidationModal(zeroAddress, zeroAddress, REP_TOKEN_ADDRESS, 1n)
			})
			expect(state().liquidationReceiverVault).toBe(WALLET_ADDRESS)

			await rerender({ accountAddress: SECOND_WALLET_ADDRESS })
			expect(state().liquidationReceiverVault).toBe(SECOND_WALLET_ADDRESS)
		})

		test('keeps a custom receiver when the wallet changes', async () => {
			const customReceiver = getAddress('0x00000000000000000000000000000000000000c1')
			const { rerender, state } = await renderHook(createSecurityPoolsOverviewDependencies())
			await act(() => {
				state().openLiquidationModal(zeroAddress, zeroAddress, REP_TOKEN_ADDRESS, 1n)
				state().setLiquidationReceiverVault(customReceiver)
			})

			await rerender({ accountAddress: SECOND_WALLET_ADDRESS })
			expect(state().liquidationReceiverVault).toBe(customReceiver)
		})

		test('invalidates a resolved liquidation funding preview when the wallet changes', async () => {
			const loadCoordinatorInitialReportFundingRequirement = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _managerAddress: Address, walletAddress: Address) => (walletAddress === WALLET_ADDRESS ? firstWalletFunding() : secondWalletFunding()))
			const { rerender, state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadCoordinatorInitialReportFundingRequirement, loadOracleManagerQueueOperationEthValue: mock(async () => 12n) }))

			await act(() => {
				state().openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			})
			await act(async () => {
				await state().loadLiquidationFundingPreview(zeroAddress)
			})
			expect(state().liquidationFundingPreview?.currentRepBalanceAttoRep).toBe(25n)

			await rerender({ accountAddress: SECOND_WALLET_ADDRESS })
			expect(state().liquidationFundingPreview).toBeUndefined()

			await act(async () => {
				await state().loadLiquidationFundingPreview(zeroAddress)
			})
			expect(state().liquidationFundingPreview?.currentRepBalanceAttoRep).toBe(50n)
			expect(loadCoordinatorInitialReportFundingRequirement.mock.calls.map(call => call[2])).toEqual([WALLET_ADDRESS, SECOND_WALLET_ADDRESS])
		})

		test('does not commit an in-flight liquidation funding preview after the wallet changes', async () => {
			const firstWalletLoadResult = createDeferred<CoordinatorFundingRequirement>()
			const secondWalletLoadResult = createDeferred<CoordinatorFundingRequirement>()
			const loadCoordinatorInitialReportFundingRequirement = mock(async (_client: TestSecurityPoolsOverviewWriteClient, _managerAddress: Address, walletAddress: Address) => await (walletAddress === WALLET_ADDRESS ? firstWalletLoadResult.promise : secondWalletLoadResult.promise))
			const { rerender, state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadCoordinatorInitialReportFundingRequirement, loadOracleManagerQueueOperationEthValue: mock(async () => 12n) }))

			await act(() => {
				state().openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			})
			const firstWalletLoad = state().loadLiquidationFundingPreview(zeroAddress)
			await waitFor(() => {
				expect(loadCoordinatorInitialReportFundingRequirement).toHaveBeenCalledTimes(1)
			})

			await rerender({ accountAddress: SECOND_WALLET_ADDRESS })
			firstWalletLoadResult.resolve(firstWalletFunding())
			await act(async () => {
				await firstWalletLoad
			})
			expect(state().liquidationFundingPreview).toBeUndefined()

			const secondWalletLoad = state().loadLiquidationFundingPreview(zeroAddress)
			secondWalletLoadResult.resolve(secondWalletFunding())
			await act(async () => {
				await secondWalletLoad
			})
			expect(state().liquidationFundingPreview?.currentRepBalanceAttoRep).toBe(50n)
		})
	})

	test('aborts submission preflight when the environment changes before funding resolves', async () => {
		const queueOperationValueAttoEth = createDeferred<bigint>()
		const queueSecurityPoolLiquidation = mockQueuedLiquidation('0x04')
		const loadOracleManagerQueueOperationEthValue = mock(async () => await queueOperationValueAttoEth.promise)
		const { rerender, state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadOracleManagerQueueOperationEthValue, queueSecurityPoolLiquidation }), { environmentRefreshKey: 0 })

		await act(() => {
			state().openLiquidationModal(zeroAddress, zeroAddress, SECOND_WALLET_ADDRESS, 1n)
			state().setLiquidationTargetVault(SECOND_WALLET_ADDRESS)
			state().setLiquidationAmount('1')
			state().setLiquidationTimeoutMinutes('5')
		})
		const staleEnvironmentSubmission = state().queueLiquidation(zeroAddress, zeroAddress)
		await waitFor(() => {
			expect(loadOracleManagerQueueOperationEthValue).toHaveBeenCalledTimes(1)
		})

		await rerender({ environmentRefreshKey: 1 })
		queueOperationValueAttoEth.resolve(0n)
		await act(async () => {
			await staleEnvironmentSubmission
		})

		expect(queueSecurityPoolLiquidation).not.toHaveBeenCalled()
		expect(state().liquidationFundingPreview).toBeUndefined()
		expect(state().securityPoolLiquidationError).toContain('network changed')

		await act(async () => {
			await state().queueLiquidation(zeroAddress, zeroAddress)
		})
		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
	})

	describe('initial report funding preflight', () => {
		// Invalid oracle price, so queueing must first fund a 5 REP initial report with a 5 WETH shortfall.
		const renderUnderfundedHook = async (walletBalanceAttoEth: bigint, funding: Partial<CoordinatorFundingRequirement>) => {
			const queueSecurityPoolLiquidation = mockQueuedLiquidation('0x03')
			const hook = await renderHook(
				createSecurityPoolsOverviewDependencies({
					createConnectedReadClient: mock(() => ({ getBalance: async () => walletBalanceAttoEth })),
					loadCoordinatorInitialReportFundingRequirement: mock(async () =>
						createCoordinatorFundingRequirement({
							currentWethBalanceAttoEth: 0n,
							requiredRepAttoRep: 5n,
							maximumInitialAttoWeth: 10n,
							minimumToken1ReportAttoEth: 10n,
							reputationTokenAddress: REP_TOKEN_ADDRESS,
							wethShortfallAttoEth: 5n,
							...funding,
						}),
					),
					loadOracleManagerDetails: mock(async () => invalidPriceManagerDetails),
					loadOracleManagerQueueOperationEthValue: mock(async () => 1n),
					queueSecurityPoolLiquidation,
				}),
			)
			await fillLiquidationForm(hook.state)
			await act(async () => {
				await hook.state().queueLiquidation(zeroAddress, zeroAddress)
			})
			return { ...hook, queueSecurityPoolLiquidation }
		}

		test('blocks queued liquidations when the wallet cannot fund the initial report WETH wrap', async () => {
			const { queueSecurityPoolLiquidation, state } = await renderUnderfundedHook(1n, { currentRepBalanceAttoRep: 10n, initialReportAmount2: 5n })

			expect(queueSecurityPoolLiquidation).not.toHaveBeenCalled()
			await waitFor(() => {
				expect(state().securityPoolOverviewFeedback?.status.detail).toContain('fund the initial report and queue this liquidation')
			})
		})

		test.each([4n, 5n])('checks the actual REP deposit before queueing a liquidation with balance %s', async balance => {
			const { queueSecurityPoolLiquidation, state } = await renderUnderfundedHook(100n, { currentRepBalanceAttoRep: balance, initialReportAmount2: 10n })

			expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(balance === 5n ? 1 : 0)
			expect(state().liquidationFundingPreview?.initialReportRepRequiredAttoRep).toBe(5n)
		})
	})

	test('expands compact staged liquidation failure reasons in overview feedback', async () => {
		const presentedTransactions: GlobalTransactionPresentation[] = []
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
				loadSecurityPoolPage: unexpectedPageLoad(),
				queueSecurityPoolLiquidation: mock(async () => ({
					action: 'queueLiquidation' as const,
					hash: '0x03' as const,
					securityPoolAddress: zeroAddress,
					stagedExecution: { errorMessage: 'Target commitment', operation: 'liquidation' as const, operationId: 3n, success: false },
				})),
			}),
			{
				onTransactionPresented: presentation => {
					presentedTransactions.push(presentation)
				},
			},
		)
		await fillLiquidationForm(state)

		await act(async () => {
			await state().queueLiquidation(zeroAddress, zeroAddress)
		})
		expect(state().securityPoolOverviewFeedback?.status.tone).toBe('error')
		expect(state().securityPoolOverviewFeedback?.status.detail).toBe('The target vault would fall below the minimum commitment after liquidation.')
		expect(presentedTransactions).toHaveLength(1)
		expect(presentedTransactions[0]?.tone).toBe('error')
		expect(presentedTransactions[0]?.title).toBe('Liquidation failed')
		expect(presentedTransactions[0]?.detail).toBe('The target vault would fall below the minimum commitment after liquidation.')
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
		const { state } = await renderHook(
			createSecurityPoolsOverviewDependencies({
				loadLiquidationApproval: mock(async (_managerAddress, approvalId) => await (approvalId === firstApprovalId ? firstApproval.promise : secondApproval.promise)),
			}),
		)

		await act(() => {
			state().openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			state().setLiquidationApprovalId(firstApprovalId)
		})
		const firstLoad = state().loadLiquidationApproval()
		await act(() => {
			state().setLiquidationApprovalId(secondApprovalId)
		})
		const secondLoad = state().loadLiquidationApproval()
		secondApproval.resolve(createApproval(2n))
		await act(async () => {
			await secondLoad
		})
		firstApproval.resolve(createApproval(1n))
		await act(async () => {
			await firstLoad
		})

		expect(state().liquidationApprovalDetails?.params.nonce).toBe(2n)
	})

	test('loads delegated receiver vault state independently from the operator vault', async () => {
		const loadSecurityPoolVaultSummary = mock(async (_securityPoolAddress: Address, vaultAddress: Address) => ({
			openInterestAttoEth: 3n,
			disputeStakedAttoRep: 4n,
			vaultAttoRepBacking: 5n,
			underwritingLimitAttoEth: 6n,
			claimableFeesAttoEth: 7n,
			vaultAddress,
		}))
		const { state } = await renderHook(createSecurityPoolsOverviewDependencies({ loadSecurityPoolVaultSummary }))

		await act(() => {
			state().openLiquidationModal(zeroAddress, zeroAddress, WALLET_ADDRESS, 1n)
			state().setLiquidationReceiverVault(SECOND_WALLET_ADDRESS)
		})
		await act(async () => {
			await state().loadLiquidationReceiverVaultSummary()
		})

		expect(loadSecurityPoolVaultSummary).toHaveBeenCalledWith(zeroAddress, SECOND_WALLET_ADDRESS)
		expect(state().liquidationReceiverVaultSummaryResolved).toBe(true)
		expect(state().liquidationReceiverVaultSummary?.vaultAddress).toBe(SECOND_WALLET_ADDRESS)
		expect(state().liquidationReceiverVaultSummary?.underwritingLimitAttoEth).toBe(6n)
	})
})
