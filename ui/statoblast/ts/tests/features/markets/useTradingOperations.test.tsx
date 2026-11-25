import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { capitalClient } from '../security-pools/capitalClient.js'
import { capitalSnapshot, securityPool, token } from '../security-pools/capitalFixture.js'
/// <reference types='bun-types' />

import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import { getActiveBackend, installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import type { DeploymentStatus, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TradingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useTradingOperations, type UseTradingOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { getTradingMigrateSharesGuardMessage } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

type UseTradingOperationsParameters = Parameters<typeof useTradingOperations>[0]
type MintCapacity = Awaited<ReturnType<UseTradingOperationsDependencies['loadQuestionLedgerMintCapacity']>>
// An explicit `accountAddress: undefined` renders without a connected wallet.
type HarnessProps = { accountAddress?: Address | undefined; enabled?: boolean; selectedQuestionLedgerAddress?: Address }

const ATTO_ETH_PER_ETH = 10n ** 18n
const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const QUESTION_LEDGER_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const WALLET_ACCOUNT_CHANGED = 'Wallet account changed. Review the action with the connected account and try again.'
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
		shareTokenAddress: zeroAddress,
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
		settlementCollateralAttoEth: ATTO_ETH_PER_ETH,
		feeEligibleUnderwritingLimitAttoEth: 2n * ATTO_ETH_PER_ETH,
		mintingCapacityAttoEth: 2n * ATTO_ETH_PER_ETH,
		shareTokenSupplyAttoShares: ATTO_ETH_PER_ETH,
		totalPoolHeldAttoRep: 20n * ATTO_ETH_PER_ETH,
		totalUnderwritingLimitAttoEth: 2n * ATTO_ETH_PER_ETH,
		...overrides,
	}
}

function createTradingOperationsDependencies(overrides: Partial<UseTradingOperationsDependencies>): UseTradingOperationsDependencies {
	const unexpected = (name: string) => async () => {
		throw new Error(`${name} should not be called in this test`)
	}
	return {
		createCompleteSetInQuestionLedger: unexpected('createCompleteSetInQuestionLedger'),
		getWalletEthBalance: unexpected('getWalletEthBalance'),
		loadQuestionLedgerMintCapacity: unexpected('loadQuestionLedgerMintCapacity'),
		// Every loaded child universe has a question ledger and holds nothing migrated unless a test says otherwise.
		loadShareMigrationTargets: async (_source, childUniverses) => childUniverses.map(child => ({ outcomeIndex: child.outcomeIndex, canonicalPool: QUESTION_LEDGER_ADDRESS, migratedAttoShares: { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n } })),
		loadTradingDetails: unexpected('loadTradingDetails'),
		loadZoltarUniverseSummary: unexpected('loadZoltarUniverseSummary'),
		migrateSharesFromUniverse: unexpected('migrateSharesFromUniverse'),
		redeemCompleteSetInQuestionLedger: unexpected('redeemCompleteSetInQuestionLedger'),
		redeemSharesInQuestionLedger: unexpected('redeemSharesInQuestionLedger'),
		...overrides,
	}
}

/** Mint-ready dependencies: a funded wallet, default pool capacity, and single-universe pool reads. */
function createMintDependencies(overrides: Partial<UseTradingOperationsDependencies>): UseTradingOperationsDependencies {
	return createTradingOperationsDependencies({
		getWalletEthBalance: mock(async () => 2n * ATTO_ETH_PER_ETH),
		loadQuestionLedgerMintCapacity: mock(async () => createMintCapacity()),
		loadTradingDetails: mock(async () => createTradingDetails()),
		loadZoltarUniverseSummary: mock(async () => createUniverseSummary()),
		...overrides,
	})
}

/** Two pools on different universes, so a test can switch the selected pool and tell whose data is displayed. */
function createTwoPoolReads(pools: { address: Address; details: TradingDetails; universe: ZoltarUniverseSummary }[]) {
	return {
		loadTradingDetails: mock(async (questionLedgerAddress: Address) => {
			const pool = pools.find(candidate => candidate.address === questionLedgerAddress)
			if (pool === undefined) throw new Error(`Unexpected question ledger ${questionLedgerAddress}`)
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

	async function renderTradingHook(dependencies: UseTradingOperationsDependencies, parameters: Partial<UseTradingOperationsParameters> = {}, initialProps: HarnessProps = {}, collateralAvailable = true, collateralDecimals = 18) {
		if (collateralAvailable) {
			const source = capitalClient(capitalSnapshot({ collateralToken: collateralDecimals === 6 ? MAINNET_NETWORK_PROFILE.usdcAddress : MAINNET_NETWORK_PROFILE.wethAddress, walletCollateral: 100n * ATTO_ETH_PER_ETH, collateralAllowance: 100n * ATTO_ETH_PER_ETH }))
			source.setRead('securityPoolFactory', token)
			source.setRead('securityPoolOf', securityPool)
			source.setRead('questionId', zeroHash)
			source.setRead('purchaseQuote', [0n])
			source.setRead('quoteMintRecoveryRep', 0n)
			source.setRead('attoEthToAttoShares', 10n ** BigInt(collateralDecimals))
			source.setRead('availableMintCapacity', 10_000_000n * 10n ** BigInt(collateralDecimals))
			replaceEnvironment({ ...getActiveBackend(), createReadClient: () => source.client })
		}
		const onTransactionFailed = mock((_message: string, _details?: unknown) => undefined)
		let hookState: ReturnType<typeof useTradingOperations> | undefined
		function TradingOperationsHarness(props: HarnessProps) {
			const { enabled = true, selectedQuestionLedgerAddress = QUESTION_LEDGER_ADDRESS } = props
			hookState = useTradingOperations(
				{
					accountAddress: 'accountAddress' in props ? props.accountAddress : WALLET_ADDRESS,
					deploymentStatuses: [PROXY_DEPLOYER_STEP],
					enabled,
					onTransactionCanceled: () => undefined,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					selectedQuestionLedgerAddress,
					...parameters,
				},
				dependencies,
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<TradingOperationsHarness {...initialProps} />)
		trackCleanup(rendered.cleanup)
		const state = () => requireHookState(hookState)
		if (collateralAvailable && initialProps.enabled !== false) await waitFor(() => expect(state().collateralFunding.collateral).toBeDefined())
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

	for (const action of ['createCompleteSet', 'redeemCompleteSet'] as const)
		test(`${action} refuses to guess decimals before collateral loads`, async () => {
			const write = mock(async () => {
				throw new Error('Unexpected write')
			})
			const hook = await renderTradingHook(createMintDependencies({ createCompleteSetInQuestionLedger: write, redeemCompleteSetInQuestionLedger: write }), {}, {}, false)
			await hook.setForm({ completeSetAmount: '5', redeemAmount: '5' })
			await act(() => hook.state()[action]())
			expect(hook.onTransactionFailed).toHaveBeenCalledWith('Collateral metadata is not loaded. Wait for funding details and try again.', expect.objectContaining({ kind: 'error' }))
			expect(write).not.toHaveBeenCalled()
		})

	test('USDC mint and redeem submit six-decimal raw amounts', async () => {
		const minted: bigint[] = []
		const redeemed: bigint[] = []
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInQuestionLedger: async (_wallet, _callbacks, questionLedgerAddress, amount) => {
					minted.push(amount)
					return { action: 'createCompleteSet', hash: zeroHash, questionLedgerAddress, universeId: 1n }
				},
				redeemCompleteSetInQuestionLedger: async (_wallet, _callbacks, questionLedgerAddress, amount) => {
					redeemed.push(amount)
					return { action: 'redeemCompleteSet', hash: zeroHash, questionLedgerAddress, universeId: 1n }
				},
				loadTradingDetails: async () => createTradingDetails({ shareBalances: { invalidAttoShares: 10_000_000n, yesAttoShares: 10_000_000n, noAttoShares: 10_000_000n } }),
			}),
			{},
			{},
			true,
			6,
		)
		await hook.setForm({ completeSetAmount: '5', redeemAmount: '5' })
		await act(() => hook.state().createCompleteSet())
		await act(() => hook.state().redeemCompleteSet())
		expect(minted).toEqual([5_000_000n])
		expect(redeemed).toEqual([5_000_000n])
	})

	test('mint uses shown defaults or edited limits in collateral decimals and blocks out-of-range edits', async () => {
		const createMint = mock(async (_account: Address, _callbacks: unknown, questionLedgerAddress: Address, _amount: bigint, _limits?: Parameters<UseTradingOperationsDependencies['createCompleteSetInQuestionLedger']>[4]) => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			questionLedgerAddress,
			universeId: 1n,
		}))
		const hook = await renderTradingHook(createMintDependencies({ createCompleteSetInQuestionLedger: createMint }), {}, {}, true, 6)
		await hook.setForm({ completeSetAmount: '1', mintMaximumFee: '0.0000001' })
		await waitFor(() => expect(hook.state().mintLimits.reason).toBe('Enter a valid maximum fee.'))
		await act(() => hook.state().createCompleteSet())
		expect(createMint).not.toHaveBeenCalled()
		await hook.setForm({ mintMaximumFee: '0.042', mintMinimumShares: '1.000001' })
		await waitFor(() => expect(hook.state().mintLimits.reason).toBe('The quote is below your minimum complete sets.'))
		await hook.setForm({ mintMinimumShares: '' })
		expect(hook.state().mintLimits).toEqual({ maximumFee: 42_000n, minimumShares: 990_000n, reason: undefined })
		await act(() => hook.state().createCompleteSet())
		expect(createMint.mock.calls[0]?.[4]).toEqual({ maximumFee: 42_000n, minimumShares: 990_000n })
	})

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
			expectedMessage: 'Minting is unavailable because this question has complete-set shares but no collateral.',
			name: 'latest pool capacity has no collateral exchange rate',
		},
		{
			capacity: createMintCapacity({ settlementCollateralAttoEth: 0n, feeEligibleUnderwritingLimitAttoEth: 0n, mintingCapacityAttoEth: 0n, shareTokenSupplyAttoShares: 0n }),
			expectedMessage: 'No mint capacity. No position has an active commitment.',
			name: 'total underwriting commitments exists but none is fee eligible',
		},
		{
			capacity: createMintCapacity({ escalationGameActive: true, mintingCapacityAttoEth: 0n }),
			expectedMessage: 'Minting is closed for this question once reporting starts.',
			name: 'an escalation game has started',
		},
	])('blocks complete-set mint writes when $name', async ({ capacity, expectedMessage }) => {
		const createCompleteSetInQuestionLedger = mock(async () => {
			throw new Error('createCompleteSetInQuestionLedger should not be called when minting is blocked')
		})
		const hook = await renderTradingHook(createMintDependencies({ createCompleteSetInQuestionLedger, loadQuestionLedgerMintCapacity: mock(async () => capacity) }))

		await hook.setForm({ completeSetAmount: '1' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})

		expect(hook.onTransactionFailed).toHaveBeenCalledWith(expectedMessage, expect.objectContaining({ kind: 'error' }))
		expect(createCompleteSetInQuestionLedger).not.toHaveBeenCalled()
	})

	test('allows the checkpoint-adjusted maximum mint amount through submit-time validation', async () => {
		const createCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address, amount: bigint) => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			questionLedgerAddress,
			universeId: 1n,
			amount,
		}))
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInQuestionLedger,
				// The wallet covers the amount plus the gas reserve, so only pool capacity limits this mint.
				getWalletEthBalance: mock(async () => 3n * ATTO_ETH_PER_ETH),
				loadQuestionLedgerMintCapacity: mock(async () =>
					createMintCapacity({
						linearFee: { rateAttoEthPerSecond: ATTO_ETH_PER_ETH, endTime: 100n },
						currentTimestamp: 2n,
						feeEligibleUnderwritingLimitAttoEth: 3n * ATTO_ETH_PER_ETH,
						feeEndTimestamp: 100n,
						lastFeeCheckpointNativeTime: 1n,
						mintingCapacityAttoEth: 3n * ATTO_ETH_PER_ETH,
						settlementCollateralAttoEth: 2n * ATTO_ETH_PER_ETH,
						shareTokenSupplyAttoShares: 2n * ATTO_ETH_PER_ETH,
						totalUnderwritingLimitAttoEth: 3n * ATTO_ETH_PER_ETH,
					}),
				),
			}),
		)

		await hook.setForm({ completeSetAmount: '1.999999999999999999' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(createCompleteSetInQuestionLedger).toHaveBeenCalledTimes(1)
		expect(createCompleteSetInQuestionLedger.mock.calls[0]?.[3]).toBe(2n * ATTO_ETH_PER_ETH - 1n)
	})

	test('submits complete-set inputs in fixed share units', async () => {
		const firstMintShareAmount = ATTO_ETH_PER_ETH
		let submittedRedeemAmount: bigint | undefined
		const redeemCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address, amount: bigint) => {
			submittedRedeemAmount = amount
			return {
				action: 'redeemCompleteSet' as const,
				hash: zeroHash,
				questionLedgerAddress,
				universeId: 1n,
			}
		})
		const hook = await renderTradingHook(
			createMintDependencies({
				loadQuestionLedgerMintCapacity: mock(async () => createMintCapacity({ shareTokenSupplyAttoShares: firstMintShareAmount })),
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
				redeemCompleteSetInQuestionLedger,
			}),
		)

		await hook.setForm({ redeemAmount: '1' })
		await act(async () => {
			await hook.state().redeemCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(redeemCompleteSetInQuestionLedger).toHaveBeenCalled()
		expect(submittedRedeemAmount).toBe(firstMintShareAmount)
	})

	test('submits the amounts the mint and redeem guards accept, including a leading decimal point and digit grouping spaces', async () => {
		const halfShare = ATTO_ETH_PER_ETH / 2n
		const createCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address, _amount: bigint) => ({ action: 'createCompleteSet' as const, hash: zeroHash, questionLedgerAddress, universeId: 1n }))
		const redeemCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address, _amount: bigint) => ({ action: 'redeemCompleteSet' as const, hash: zeroHash, questionLedgerAddress, universeId: 1n }))
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInQuestionLedger,
				loadQuestionLedgerMintCapacity: mock(async () => createMintCapacity({ shareTokenSupplyAttoShares: ATTO_ETH_PER_ETH })),
				loadTradingDetails: mock(async () => createTradingDetails({ maxRedeemableCompleteSetsAttoShares: ATTO_ETH_PER_ETH, shareBalances: { invalidAttoShares: ATTO_ETH_PER_ETH, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH } })),
				redeemCompleteSetInQuestionLedger,
			}),
		)

		await hook.setForm({ completeSetAmount: '.5', redeemAmount: '0 .5' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})
		await act(async () => {
			await hook.state().redeemCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(createCompleteSetInQuestionLedger.mock.calls[0]?.[3]).toBe(halfShare)
		expect(redeemCompleteSetInQuestionLedger.mock.calls[0]?.[3]).toBe(halfShare)
	})

	test('redeems the exact share amount even when its ETH backing is zero', async () => {
		let submittedRedeemAmount: bigint | undefined
		const redeemCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address, amount: bigint) => {
			submittedRedeemAmount = amount
			return { action: 'redeemCompleteSet' as const, hash: zeroHash, questionLedgerAddress, universeId: 1n }
		})
		const hook = await renderTradingHook(
			createMintDependencies({
				loadQuestionLedgerMintCapacity: mock(async () => createMintCapacity({ settlementCollateralAttoEth: 0n, shareTokenSupplyAttoShares: 100n })),
				loadTradingDetails: mock(async () => createTradingDetails({ maxRedeemableCompleteSetsAttoShares: 99n, shareBalances: { invalidAttoShares: 99n, noAttoShares: 99n, yesAttoShares: 99n } })),
				redeemCompleteSetInQuestionLedger,
			}),
		)

		// Input represents the shares to burn, independently of cash backing.
		await hook.setForm({ redeemAmount: '0.000000000000000099' })
		await act(async () => {
			await hook.state().redeemCompleteSet()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(submittedRedeemAmount).toBe(99n)
	})

	test('starts with empty amounts and clears the submitted amount after a successful write', async () => {
		const createCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address) => ({ action: 'createCompleteSet' as const, hash: zeroHash, questionLedgerAddress, universeId: 1n }))
		const redeemCompleteSetInQuestionLedger = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address) => ({ action: 'redeemCompleteSet' as const, hash: zeroHash, questionLedgerAddress, universeId: 1n }))
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInQuestionLedger,
				loadTradingDetails: mock(async () => createTradingDetails({ maxRedeemableCompleteSetsAttoShares: ATTO_ETH_PER_ETH, shareBalances: { invalidAttoShares: ATTO_ETH_PER_ETH, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH } })),
				redeemCompleteSetInQuestionLedger,
			}),
		)
		expect(hook.state().tradingForm.completeSetAmount).toBe('')
		expect(hook.state().tradingForm.redeemAmount).toBe('')

		await hook.setForm({ completeSetAmount: '0.5', redeemAmount: '0.25' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})
		expect(createCompleteSetInQuestionLedger).toHaveBeenCalledTimes(1)
		expect(hook.state().tradingForm.completeSetAmount).toBe('')
		expect(hook.state().tradingForm.redeemAmount).toBe('0.25')

		await act(async () => {
			await hook.state().redeemCompleteSet()
		})
		expect(redeemCompleteSetInQuestionLedger).toHaveBeenCalledTimes(1)
		expect(hook.state().tradingForm.redeemAmount).toBe('')
	})

	test('passes the migrated outcome balance to the share-migration review', async () => {
		const migrateSharesFromUniverse = mock(async (_accountAddress: Address, _callbacks: unknown, questionLedgerAddress: Address, shareOutcome: 'invalid' | 'yes' | 'no', targetOutcomeIndexes: bigint[], _migratedAttoShares?: bigint) => ({
			action: 'migrateShares' as const,
			hash: zeroHash,
			questionLedgerAddress,
			shareOutcome,
			targetOutcomeIndexes,
			universeId: 1n,
		}))
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				loadTradingDetails: mock(async () => createTradingDetails({ shareBalances: { invalidAttoShares: 0n, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: 3n * ATTO_ETH_PER_ETH } })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses: [createChildUniverse(1n, 0n, 'Invalid', 2n)], forkQuestionDetails: createMarketDetails(), hasForked: true })),
				migrateSharesFromUniverse,
			}),
		)

		await hook.setForm({ selectedShareOutcome: 'yes', targetOutcomeIndexes: '0' })
		await act(async () => {
			await hook.state().migrateShares()
		})

		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(migrateSharesFromUniverse.mock.calls[0]?.[5]).toBe(3n * ATTO_ETH_PER_ETH)
	})

	test('does not request a multi-target share migration while a selected child universe has no question ledger', async () => {
		const migrateSharesFromUniverse = mock(async () => {
			throw new Error('migrateSharesFromUniverse should not be called while a selected child universe has no question ledger')
		})
		const noMigratedShares = { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n }
		const loadShareMigrationTargets = mock(async () => [
			{ outcomeIndex: 0n, canonicalPool: QUESTION_LEDGER_ADDRESS, migratedAttoShares: noMigratedShares },
			{ outcomeIndex: 1n, canonicalPool: undefined, migratedAttoShares: noMigratedShares },
			{ outcomeIndex: 2n, canonicalPool: undefined, migratedAttoShares: noMigratedShares },
		])
		const childUniverses = [createChildUniverse(1n, 0n, 'Invalid', 2n), createChildUniverse(1n, 1n, 'Yes', 3n), createChildUniverse(1n, 2n, 'No', 4n)]
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				loadShareMigrationTargets,
				loadTradingDetails: mock(async () => createTradingDetails({ shareBalances: { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: ATTO_ETH_PER_ETH } })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses, forkQuestionDetails: createMarketDetails(), forkTime: 5n, hasForked: true })),
				migrateSharesFromUniverse,
			}),
		)

		await waitFor(() => expect(hook.state().tradingDetails?.shareMigrationTargets).toHaveLength(3))
		await hook.setForm({ selectedShareOutcome: 'yes', targetOutcomeIndexes: '0, 1, 2' })
		await act(async () => {
			await hook.state().migrateShares()
		})

		expect(migrateSharesFromUniverse.mock.calls).toEqual([])
		expect(hook.state().tradingFeedback?.status.detail).toBe('This selection includes a child universe where this question is not registered yet. Migrate into each such child universe separately.')
	})

	function getMigrateGuardMessage(state: ReturnType<typeof useTradingOperations>) {
		return getTradingMigrateSharesGuardMessage({
			accountAddress: WALLET_ADDRESS,
			hasSelectedPool: true,
			isOnActiveAppChain: true,
			loadingTradingDetails: state.loadingTradingDetails,
			loadingTradingForkUniverse: state.loadingTradingForkUniverse,
			selectedShareOutcome: state.tradingForm.selectedShareOutcome,
			shareBalances: state.tradingDetails?.shareBalances,
			shareMigrationTargets: state.tradingDetails?.shareMigrationTargets,
			targetOutcomeIndexesInput: state.tradingForm.targetOutcomeIndexes,
			tradingForkUniverse: state.tradingForkUniverse,
		})
	}

	test('defaults a fresh fork migration to the child universes it can migrate into in one transaction', async () => {
		const noMigratedShares = { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n }
		const childUniverses = [createChildUniverse(1n, 0n, 'Invalid', 2n), createChildUniverse(1n, 1n, 'Yes', 3n), createChildUniverse(1n, 2n, 'No', 4n)]
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				// Only the forking pool's own child has a canonical pool right after the fork.
				loadShareMigrationTargets: mock(async () => [
					{ outcomeIndex: 0n, canonicalPool: getAddress('0x00000000000000000000000000000000000000b1'), migratedAttoShares: noMigratedShares },
					{ outcomeIndex: 1n, canonicalPool: undefined, migratedAttoShares: noMigratedShares },
					{ outcomeIndex: 2n, canonicalPool: undefined, migratedAttoShares: noMigratedShares },
				]),
				loadTradingDetails: mock(async () => createTradingDetails({ shareBalances: { invalidAttoShares: ATTO_ETH_PER_ETH, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH } })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses, forkQuestionDetails: createMarketDetails(), forkTime: 5n, hasForked: true })),
			}),
		)

		await waitFor(() => expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('0'))
		expect(getMigrateGuardMessage(hook.state())).toBeUndefined()
	})

	test('keeps trading details usable when the child universe question ledgers cannot be read, and retries them on refresh', async () => {
		const childUniverses = [createChildUniverse(1n, 0n, 'Invalid', 2n), createChildUniverse(1n, 1n, 'Yes', 3n)]
		const shareBalances = { invalidAttoShares: ATTO_ETH_PER_ETH, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH }
		let failTargetsRead = true
		const loadShareMigrationTargets = mock(async (_source: Pick<TradingDetails, 'shareTokenAddress' | 'universeId'>, children: ZoltarUniverseSummary['childUniverses']) => {
			if (failTargetsRead) throw new Error('multicall failed')
			return children.map(child => ({ outcomeIndex: child.outcomeIndex, canonicalPool: QUESTION_LEDGER_ADDRESS, migratedAttoShares: { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n } }))
		})
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				loadShareMigrationTargets,
				loadTradingDetails: mock(async () => createTradingDetails({ maxRedeemableCompleteSetsAttoShares: ATTO_ETH_PER_ETH, shareBalances })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses, forkQuestionDetails: createMarketDetails(), forkTime: 5n, hasForked: true })),
			}),
		)

		await waitFor(() => expect(hook.state().tradingDetails?.shareMigrationTargets).toEqual({ unavailableReason: 'This question is unavailable in child universes. Refresh to retry. Reason: multicall failed.' }))
		expect(hook.state().tradingError).toBeUndefined()
		expect(hook.state().tradingDetails?.shareBalances).toEqual(shareBalances)
		expect(hook.state().tradingDetails?.maxRedeemableCompleteSetsAttoShares).toBe(ATTO_ETH_PER_ETH)
		expect(getMigrateGuardMessage(hook.state())).toBe('This question is unavailable in child universes. Refresh to retry. Reason: multicall failed.')

		failTargetsRead = false
		await act(() => invalidateAppData())
		await waitFor(() => expect(hook.state().tradingDetails?.shareMigrationTargets).toHaveLength(2))
		expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('0, 1')
		expect(getMigrateGuardMessage(hook.state())).toBeUndefined()
	})

	test('recomputes the default migration targets when a wallet connects after the fork details load', async () => {
		const noMigratedShares = { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n }
		const yesShares = { ...noMigratedShares, yesAttoShares: ATTO_ETH_PER_ETH }
		const childUniverses = [createChildUniverse(1n, 0n, 'Invalid', 2n), createChildUniverse(1n, 1n, 'Yes', 3n)]
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				// The wallet's Yes balance is already migrated into the pooled child 0; child 1 has no pool yet.
				loadShareMigrationTargets: mock(async (_source: Pick<TradingDetails, 'shareTokenAddress' | 'universeId'>, _children: ZoltarUniverseSummary['childUniverses'], walletAddress: Address | undefined) => [
					{ outcomeIndex: 0n, canonicalPool: QUESTION_LEDGER_ADDRESS, migratedAttoShares: walletAddress === undefined ? noMigratedShares : yesShares },
					{ outcomeIndex: 1n, canonicalPool: undefined, migratedAttoShares: noMigratedShares },
				]),
				loadTradingDetails: mock(async (_questionLedgerAddress: Address, walletAddress: Address | undefined) => createTradingDetails({ shareBalances: walletAddress === undefined ? undefined : yesShares })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses, forkQuestionDetails: createMarketDetails(), forkTime: 5n, hasForked: true })),
			}),
			{},
			{ accountAddress: undefined },
			false,
		)

		await waitFor(() => expect(hook.state().tradingDetails?.shareMigrationTargets).toHaveLength(2))
		expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('0')

		await hook.rerender({ accountAddress: WALLET_ADDRESS })
		await waitFor(() => expect(hook.state().tradingDetails?.shareBalances).toEqual(yesShares))
		await waitFor(() => expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('1'))
		expect(getMigrateGuardMessage(hook.state())).toBeUndefined()
	})

	test('keeps a manual migration target selection through a failed and recovered child universe read', async () => {
		const childUniverses = [createChildUniverse(1n, 0n, 'Invalid', 2n), createChildUniverse(1n, 1n, 'Yes', 3n)]
		const shareBalances = { invalidAttoShares: ATTO_ETH_PER_ETH, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH }
		let failTargetsRead = false
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				loadShareMigrationTargets: mock(async (_source: Pick<TradingDetails, 'shareTokenAddress' | 'universeId'>, children: ZoltarUniverseSummary['childUniverses']) => {
					if (failTargetsRead) throw new Error('multicall failed')
					return children.map(child => ({ outcomeIndex: child.outcomeIndex, canonicalPool: QUESTION_LEDGER_ADDRESS, migratedAttoShares: { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n } }))
				}),
				loadTradingDetails: mock(async () => createTradingDetails({ shareBalances })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses, forkQuestionDetails: createMarketDetails(), forkTime: 5n, hasForked: true })),
			}),
			{},
			{},
			false,
		)

		await waitFor(() => expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('0, 1'))
		await hook.setForm({ targetOutcomeIndexes: '1' })

		// A wallet switch reloads the details, and this time the child universe read fails.
		failTargetsRead = true
		await hook.rerender({ accountAddress: NEXT_WALLET_ADDRESS })
		await waitFor(() => expect(hook.state().tradingDetails?.shareMigrationTargets).toEqual({ unavailableReason: 'This question is unavailable in child universes. Refresh to retry. Reason: multicall failed.' }))
		expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('1')

		failTargetsRead = false
		await act(() => invalidateAppData())
		await waitFor(() => expect(hook.state().tradingDetails?.shareMigrationTargets).toHaveLength(2))
		expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('1')
	})

	test('recomputes the default migration targets for a newly selected share outcome until the user edits them', async () => {
		const noMigratedShares = { invalidAttoShares: 0n, noAttoShares: 0n, yesAttoShares: 0n }
		const childUniverses = [createChildUniverse(1n, 0n, 'Invalid', 2n), createChildUniverse(1n, 1n, 'Yes', 3n), createChildUniverse(1n, 2n, 'No', 4n)]
		const hook = await renderTradingHook(
			createTradingOperationsDependencies({
				// Only the Yes balance is already migrated, and only into child 0.
				loadShareMigrationTargets: mock(async (_source: Pick<TradingDetails, 'shareTokenAddress' | 'universeId'>, children: ZoltarUniverseSummary['childUniverses']) =>
					children.map(child => ({ outcomeIndex: child.outcomeIndex, canonicalPool: QUESTION_LEDGER_ADDRESS, migratedAttoShares: child.outcomeIndex === 0n ? { ...noMigratedShares, yesAttoShares: ATTO_ETH_PER_ETH } : noMigratedShares })),
				),
				loadTradingDetails: mock(async () => createTradingDetails({ shareBalances: { invalidAttoShares: 0n, noAttoShares: ATTO_ETH_PER_ETH, yesAttoShares: ATTO_ETH_PER_ETH } })),
				loadZoltarUniverseSummary: mock(async () => createUniverseSummary({ childUniverses, forkQuestionDetails: createMarketDetails(), forkTime: 5n, hasForked: true })),
			}),
			{},
			{},
			false,
		)

		await waitFor(() => expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('1, 2'))
		await hook.setForm({ selectedShareOutcome: 'no' })
		expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('0, 1, 2')

		await hook.setForm({ targetOutcomeIndexes: '2' })
		await hook.setForm({ selectedShareOutcome: 'yes' })
		expect(hook.state().tradingForm.targetOutcomeIndexes).toBe('2')
	})

	test('createCompleteSet ignores a stale post-success refresh after the selected pool changes', async () => {
		const poolA = getAddress('0x00000000000000000000000000000000000000c1')
		const poolB = getAddress('0x00000000000000000000000000000000000000d1')
		const pendingResult = createDeferred<{ action: 'createCompleteSet'; hash: typeof zeroHash; questionLedgerAddress: Address; universeId: bigint }>()
		const detailsA = createTradingDetails({ shareBalances: { invalidAttoShares: 1n, noAttoShares: 2n, yesAttoShares: 3n }, universeId: 1n })
		const detailsB = createTradingDetails({ shareBalances: { invalidAttoShares: 4n, noAttoShares: 5n, yesAttoShares: 6n }, universeId: 2n })
		const universeA = createUniverseSummary({ childUniverses: [createChildUniverse(1n, 0n, 'Invalid', 11n)], hasForked: true, universeId: 1n })
		const universeB = createUniverseSummary({ childUniverses: [createChildUniverse(2n, 1n, 'Yes', 22n)], hasForked: true, universeId: 2n })
		const createCompleteSetInQuestionLedger = mock(async () => await pendingResult.promise)
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInQuestionLedger,
				...createTwoPoolReads([
					{ address: poolA, details: detailsA, universe: universeA },
					{ address: poolB, details: detailsB, universe: universeB },
				]),
			}),
			{},
			{ selectedQuestionLedgerAddress: poolA },
		)

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeA.universeId))
		await waitFor(() => expect(hook.state().tradingForkUniverse?.universeId).toBe(universeA.universeId))

		await hook.setForm({ completeSetAmount: '1' })
		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = hook.state().createCompleteSet()
		})

		await waitFor(() => expect(createCompleteSetInQuestionLedger).toHaveBeenCalledTimes(1))

		await hook.rerender({ selectedQuestionLedgerAddress: poolB })

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId))
		await waitFor(() => expect(hook.state().tradingForkUniverse?.universeId).toBe(universeB.universeId))
		expect(hook.state().tradingDetails?.shareBalances).toEqual(detailsB.shareBalances)

		await act(async () => {
			pendingResult.resolve({
				action: 'createCompleteSet',
				hash: zeroHash,
				questionLedgerAddress: poolA,
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
		const createCompleteSetInQuestionLedger = mock(async () => ({
			action: 'createCompleteSet' as const,
			hash: zeroHash,
			questionLedgerAddress: poolA,
			universeId: universeA.universeId,
		}))
		const poolReads = createTwoPoolReads([
			{ address: poolA, details: createTradingDetails({ universeId: 1n }), universe: universeA },
			{ address: poolB, details: createTradingDetails({ universeId: 2n }), universe: universeB },
		])
		let transactionState = createInitialTransactionTrayState()
		const hook = await renderTradingHook(
			createMintDependencies({
				createCompleteSetInQuestionLedger,
				loadQuestionLedgerMintCapacity: mock(async () => await deferredMintCapacity.promise),
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
			{ selectedQuestionLedgerAddress: poolA },
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

		await hook.rerender({ selectedQuestionLedgerAddress: poolB })

		await waitFor(() => expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId))

		await act(async () => {
			deferredMintCapacity.resolve(createMintCapacity())
			await createPromise
		})

		expect(hook.state().tradingDetails?.universeId).toBe(universeB.universeId)
		expect(hook.state().tradingFeedback).toBeUndefined()
		expect(createCompleteSetInQuestionLedger).not.toHaveBeenCalled()
		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.entries).toEqual([])
	})

	/** The changed wallet account stopped the action before any read, request, or `write`, and was reported as feedback rather than as a failed transaction. */
	function expectWalletAccountChangeStoppedBeforeReads(hook: Awaited<ReturnType<typeof renderTradingHook>>, onTransactionRequested: unknown, reads: readonly unknown[], write: unknown) {
		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(hook.onTransactionFailed.mock.calls).toEqual([])
		expect(hook.state().tradingFeedback?.status.detail).toBe(WALLET_ACCOUNT_CHANGED)
		for (const read of reads) expect(read).not.toHaveBeenCalled()
		expect(write).not.toHaveBeenCalled()
	}

	test('does not request a mint transaction when the active wallet account changed', async () => {
		replaceEnvironment(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))

		const createCompleteSetInQuestionLedger = mock(async () => {
			throw new Error('createCompleteSetInQuestionLedger should not be called when the active wallet account changed')
		})
		const getWalletEthBalance = mock(async () => 2n * ATTO_ETH_PER_ETH)
		const onTransactionRequested = mock(() => undefined)
		const loadQuestionLedgerMintCapacity = mock(async () => createMintCapacity())
		const loadTradingDetails = mock(async () => createTradingDetails())
		const loadZoltarUniverseSummary = mock(async () => createUniverseSummary())
		const hook = await renderTradingHook(createTradingOperationsDependencies({ createCompleteSetInQuestionLedger, getWalletEthBalance, loadQuestionLedgerMintCapacity, loadTradingDetails, loadZoltarUniverseSummary }), { onTransactionRequested })
		const reads = [getWalletEthBalance, loadTradingDetails, loadZoltarUniverseSummary, loadQuestionLedgerMintCapacity]
		for (const read of reads) read.mockClear()

		await hook.setForm({ completeSetAmount: '1' })
		await act(async () => {
			await hook.state().createCompleteSet()
		})

		expectWalletAccountChangeStoppedBeforeReads(hook, onTransactionRequested, reads, createCompleteSetInQuestionLedger)
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

		expectWalletAccountChangeStoppedBeforeReads(hook, onTransactionRequested, reads, migrateSharesFromUniverse)
	})
})
