import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { withTransactionReviews } from '@zoltar/ui-statoblast-shared/protocol/reviewedBackend.js'
import { createWalletClient, custom, publicActions, encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { asWriteClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { prepareForkClaimCheckpoint as submitPreparation, prepareAndSettleForkClaim as submitCombined, withdrawForkedEscalationDeposits as submitSettlement } from '@zoltar/ui-statoblast-shared/protocol/reportingCarryState.js'
import { transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { registerTransactionReviewScope } from '@zoltar/ui-core-shared/transactions/transactionReviewScope.js'
import { useForkAuctionInteractionState } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionInteractionState.js'
import { useTruthAuctionSettlementActionState } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js'
import { ForkAuctionWorkflowShell } from '@zoltar/ui-statoblast-shared/features/truth-auctions/components/ForkAuctionWorkflowShell.js'
import { getTruthAuctionSettlementBidRows } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionSettlement.js'
import { TransactionStatusCard } from '@zoltar/ui-core-shared/components/TransactionStatusCard.js'
import { transactionErrorMessages } from '@zoltar/ui-core-shared/lib/errors.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types='bun-types' />

import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { parseTruthAuctionAmountInput, parseTruthAuctionPriceInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionRequested, markTransactionSubmitted } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import type { AuthenticatedForkClaim, CarriedDepositProof, ForkAuctionActionResult, ForkAuctionDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useForkAuctionOperations, type UseForkAuctionOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionOperations.js'
import { getTruthAuctionTickAtPrice } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionBook.js'
import type { SettlementSelectedBid, TransactionIntent } from '@zoltar/ui-zoltar-shared/features/types.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createTruthAuctionMetrics } from '../security-pools/workflow/builders.js'

type UseForkAuctionOperationsState = ReturnType<typeof useForkAuctionOperations>
type TestForkAuctionWriteClient = { kind: 'injected-write-client' }

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const SECURITY_POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const TRUTH_AUCTION_ADDRESS = getAddress('0x00000000000000000000000000000000000000c3')

function createAuthenticatedClaim(): AuthenticatedForkClaim {
	return { escalationGame: TRUTH_AUCTION_ADDRESS, outcome: 'yes', snapshotRoot: zeroHash, snapshotLeafCount: 2n, amountAttoRep: 10n, cumulativeAmountAttoRep: 20n, depositor: WALLET_ADDRESS, parentDepositIndex: 9n, leafIndex: 1n }
}

function createClaimProof(identity = createAuthenticatedClaim()): CarriedDepositProof {
	return {
		depositor: identity.depositor,
		amountAttoRep: identity.amountAttoRep,
		cumulativeAmountAttoRep: identity.cumulativeAmountAttoRep,
		parentDepositIndex: identity.parentDepositIndex,
		leafIndex: identity.leafIndex,
		sourceNodeId: 2n,
		merkleMountainRangePeakIndex: 0n,
		merkleMountainRangeSiblings: [],
		nullifierSiblings: [],
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedUnderwritingLimitAttoEth: 0n,
		claimingAvailable: true,
		settlementCollateralAttoEth: 1n,
		currentTime: 250n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: true,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 1n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		auctionableAttoRepAtFork: 20n,
		securityPoolAddress: SECURITY_POOL_ADDRESS,
		systemState: 'forkTruthAuction',
		truthAuction: undefined,
		truthAuctionAddress: TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 100n,
		universeId: 1n,
		...overrides,
	}
}

function createForkAuctionResult(action: ForkAuctionActionResult['action']): ForkAuctionActionResult {
	return {
		action,
		hash: zeroHash,
		securityPoolAddress: SECURITY_POOL_ADDRESS,
		universeId: 1n,
	}
}

function getTransactionRowValueProp(state: ReturnType<typeof createInitialTransactionTrayState>, label: string, propName: 'address') {
	const value = state.active?.rows?.find(row => row.label === label)?.value
	if (typeof value !== 'object' || value === null || !('props' in value)) throw new Error(`${label} transaction row is not a component`)
	const props = value.props
	if (typeof props !== 'object' || props === null || !(propName in props)) throw new Error(`${label} transaction row does not expose ${propName}`)
	return props[propName]
}

function createForkAuctionOperationsDependencies(overrides: Partial<UseForkAuctionOperationsDependencies<TestForkAuctionWriteClient>> = {}): UseForkAuctionOperationsDependencies<TestForkAuctionWriteClient> {
	return {
		buildForkCarriedEscalationProofs: async () => [],
		initializeChildDisputeHistory: async () => {
			throw new Error('Unexpected initialization')
		},
		prepareAndSettleForkClaim: async () => {
			throw new Error('Unexpected combined claim')
		},
		prepareForkClaimCheckpoint: async () => {
			throw new Error('Unexpected claim checkpoint')
		},
		prepareChildPool: async () => {
			throw new Error('prepareChildPool should not be called in this test')
		},
		createChildUniverseFromSecurityPool: async () => {
			throw new Error('createChildUniverseFromSecurityPool should not be called in this test')
		},
		createConnectedReadClient: mock(() => ({
			getBalance: async () => 0n,
		})),
		createWalletWriteClient: mock(() => ({ kind: 'injected-write-client' as const })),
		finalizeSecurityPoolTruthAuction: async () => {
			throw new Error('finalizeSecurityPoolTruthAuction should not be called in this test')
		},
		forkUniverseDirectly: async () => {
			throw new Error('forkUniverseDirectly should not be called in this test')
		},
		forkZoltarWithOwnEscalation: async () => {
			throw new Error('forkZoltarWithOwnEscalation should not be called in this test')
		},
		initiateSecurityPoolFork: async () => {
			throw new Error('initiateSecurityPoolFork should not be called in this test')
		},
		loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
		claimParentEscalationDeposits: async () => {
			throw new Error('claimParentEscalationDeposits should not be called in this test')
		},
		migrateRepToZoltarFromSecurityPool: async () => {
			throw new Error('migrateRepToZoltarFromSecurityPool should not be called in this test')
		},
		migrateSecurityVault: async () => {
			throw new Error('migrateSecurityVault should not be called in this test')
		},
		migrateVaultWithUnresolvedEscalation: async () => {
			throw new Error('migrateVaultWithUnresolvedEscalation should not be called in this test')
		},
		refundTruthAuctionBid: async () => {
			throw new Error('refundTruthAuctionBid should not be called in this test')
		},
		settleTruthAuctionBids: async () => {
			throw new Error('settleTruthAuctionBids should not be called in this test')
		},
		startTruthAuctionForSecurityPool: async () => {
			throw new Error('startTruthAuctionForSecurityPool should not be called in this test')
		},
		submitTruthAuctionBid: async () => {
			throw new Error('submitTruthAuctionBid should not be called in this test')
		},
		withdrawForkedEscalationDeposits: async () => {
			throw new Error('withdrawForkedEscalationDeposits should not be called in this test')
		},
		withdrawTruthAuctionRefund: async () => {
			throw new Error('withdrawTruthAuctionRefund should not be called in this test')
		},
		...overrides,
	}
}

function createHarness(
	dependencies: UseForkAuctionOperationsDependencies<TestForkAuctionWriteClient>,
	onRender: (state: UseForkAuctionOperationsState) => void,
	onTransactionFailed: (message: string) => void,
	selectedPool: () => Address = () => SECURITY_POOL_ADDRESS,
	refreshState: () => Promise<void> = async () => undefined,
) {
	return function ForkAuctionOperationsHarness({ poolAddress = selectedPool() }: { poolAddress?: Address }) {
		const state = useForkAuctionOperations(
			{
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState,
				selectedSecurityPoolAddress: poolAddress,
			},
			dependencies,
		)
		onRender(state)
		return <div />
	}
}

describe('useForkAuctionOperations', () => {
	const { trackCleanup, replaceEnvironment } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	test('bounded initialization stays available after migration closes and rejects a duplicate pending submission', async () => {
		const completion = createDeferred<void>()
		const initializeChildDisputeHistory = mock(async () => {
			await completion.promise
			return createForkAuctionResult('initializeChildHistory')
		})
		const onTransactionFailed = mock(() => undefined)
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			createForkAuctionOperationsDependencies({ initializeChildDisputeHistory }),
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
		await act(async () => {
			const first = requireHookState(hookState).initializeChildHistory()
			const duplicate = requireHookState(hookState).initializeChildHistory()
			await waitFor(() => expect(initializeChildDisputeHistory.mock.calls.length).toBeGreaterThan(0))
			completion.resolve()
			await Promise.all([first, duplicate])
		})
		expect(initializeChildDisputeHistory).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('keeps the authenticated claim identity while preparation sends one transaction without rebuilding proofs', async () => {
		const completion = createDeferred<void>()
		const identity = createAuthenticatedClaim()
		const buildForkCarriedEscalationProofs = mock(async () => [])
		const prepareForkClaimCheckpoint = mock(async () => {
			await completion.promise
			throw new Error('Wallet rejected preparation')
		})
		const dependencies = createForkAuctionOperationsDependencies({ buildForkCarriedEscalationProofs, prepareForkClaimCheckpoint })
		const onTransactionFailed = mock(() => undefined)
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
		let first: Promise<void> | undefined
		let duplicate: Promise<void> | undefined
		await act(async () => {
			first = requireHookState(hookState).prepareForkClaim(identity)
			duplicate = requireHookState(hookState).prepareForkClaim({ ...identity, outcome: 'no', parentDepositIndex: 10n })
			await waitFor(() => expect(prepareForkClaimCheckpoint).toHaveBeenCalledTimes(1))
		})
		expect(requireHookState(hookState).forkClaimPreparation).toEqual({ outcome: 'yes', parentDepositIndex: 9n })
		expect(buildForkCarriedEscalationProofs).not.toHaveBeenCalled()
		expect(prepareForkClaimCheckpoint).toHaveBeenCalledWith({ kind: 'injected-write-client' }, SECURITY_POOL_ADDRESS, identity)
		await act(async () => {
			completion.resolve()
			await Promise.all([first, duplicate])
		})
		expect(requireHookState(hookState).forkClaimPreparation).toBeUndefined()
		expect(dependencies.createWalletWriteClient).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).toHaveBeenCalledTimes(1)
	})

	for (const fails of [false, true])
		test(`combined claim builds one fresh proof, blocks duplicates and never switches transaction type (failure=${fails})`, async () => {
			const completion = createDeferred<void>()
			const identity = createAuthenticatedClaim()
			const proof = createClaimProof(identity)
			const buildForkCarriedEscalationProofs = mock(async () => [proof])
			const prepareForkClaimCheckpoint = mock(async () => createForkAuctionResult('prepareForkClaim'))
			const withdrawForkedEscalationDeposits = mock(async () => createForkAuctionResult('settleForkedEscalation'))
			const prepareAndSettleForkClaim = mock(async () => {
				await completion.promise
				if (fails) throw new Error('Atomic settlement reverted')
				return createForkAuctionResult('settleForkedEscalation')
			})
			const dependencies = createForkAuctionOperationsDependencies({ buildForkCarriedEscalationProofs, prepareAndSettleForkClaim, prepareForkClaimCheckpoint, withdrawForkedEscalationDeposits })
			const onTransactionFailed = mock(() => undefined)
			let hookState: UseForkAuctionOperationsState | undefined
			const Harness = createHarness(
				dependencies,
				state => {
					hookState = state
				},
				onTransactionFailed,
			)
			trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
			let first: Promise<void> | undefined
			let duplicate: Promise<void> | undefined
			await act(async () => {
				first = requireHookState(hookState).prepareAndSettleForkDeposit(identity)
				duplicate = requireHookState(hookState).prepareAndSettleForkDeposit(identity)
				await waitFor(() => expect(prepareAndSettleForkClaim).toHaveBeenCalledTimes(1))
			})
			expect(requireHookState(hookState).forkClaimPreparation).toEqual({ outcome: 'yes', parentDepositIndex: 9n })
			expect(buildForkCarriedEscalationProofs).toHaveBeenCalledWith(SECURITY_POOL_ADDRESS, 'yes', [9n])
			expect(buildForkCarriedEscalationProofs).toHaveBeenCalledTimes(1)
			expect(prepareAndSettleForkClaim).toHaveBeenCalledWith({ kind: 'injected-write-client' }, SECURITY_POOL_ADDRESS, identity, proof, expect.any(Function))
			await act(async () => {
				completion.resolve()
				await Promise.all([first, duplicate])
			})
			expect(dependencies.createWalletWriteClient).toHaveBeenCalledTimes(1)
			expect(prepareForkClaimCheckpoint).not.toHaveBeenCalled()
			expect(withdrawForkedEscalationDeposits).not.toHaveBeenCalled()
			expect(requireHookState(hookState).forkClaimPreparation).toBeUndefined()
			expect(onTransactionFailed).toHaveBeenCalledTimes(fails ? 1 : 0)
		})

	test('changing pools while the final withdrawal proof loads cancels before creating a writer', async () => {
		const proofReady = createDeferred<void>()
		const identity = createAuthenticatedClaim()
		const buildForkCarriedEscalationProofs = mock(async () => {
			await proofReady.promise
			return [createClaimProof(identity)]
		})
		const prepareAndSettleForkClaim = mock(async () => createForkAuctionResult('settleForkedEscalation'))
		const dependencies = createForkAuctionOperationsDependencies({ buildForkCarriedEscalationProofs, prepareAndSettleForkClaim })
		const onTransactionFailed = mock(() => undefined)
		let selectedPool = SECURITY_POOL_ADDRESS
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
			() => selectedPool,
		)
		const rendered = await renderIntoDocument(h(Harness, {}))
		trackCleanup(rendered.cleanup)
		let pending: Promise<void> | undefined
		await act(async () => {
			pending = requireHookState(hookState).prepareAndSettleForkDeposit(identity)
			await waitFor(() => expect(buildForkCarriedEscalationProofs).toHaveBeenCalledTimes(1))
		})
		await act(async () => {
			selectedPool = getAddress('0x00000000000000000000000000000000000000b3')
			render(h(Harness, { poolAddress: selectedPool }), rendered.container)
		})
		await act(async () => {
			proofReady.resolve()
			await pending
		})
		expect(prepareAndSettleForkClaim).not.toHaveBeenCalled()
		expect(dependencies.createWalletWriteClient).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkClaimPreparation).toBeUndefined()
	})

	for (const status of ['ready', 'consumed', 'unrelated'] as const)
		test(`claim state refreshes after another actor changes it (${status})`, async () => {
			const identity = createAuthenticatedClaim()
			const message = status === 'ready' ? 'Claim preparation is complete. Settle the claim separately.' : 'Parent deposit #9 is already settled.'
			const prepareAndSettleForkClaim = mock(async () => {
				if (status === 'unrelated') throw new Error('RPC disconnected')
				throw Object.assign(new Error(message), { claimStateChanged: true })
			})
			const loadForkAuctionDetails = mock(async () => createForkAuctionDetails())
			const refresh = mock(async () => undefined)
			const dependencies = createForkAuctionOperationsDependencies({ buildForkCarriedEscalationProofs: async () => [createClaimProof(identity)], prepareAndSettleForkClaim, loadForkAuctionDetails })
			const failed = mock(() => undefined)
			let state: UseForkAuctionOperationsState | undefined
			const Harness = createHarness(
				dependencies,
				value => {
					state = value
				},
				failed,
				() => SECURITY_POOL_ADDRESS,
				refresh,
			)
			trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
			await act(async () => {
				await requireHookState(state).prepareAndSettleForkDeposit(identity)
			})
			expect(refresh).toHaveBeenCalledTimes(status === 'unrelated' ? 0 : 1)
			expect(loadForkAuctionDetails).toHaveBeenCalledTimes(status === 'unrelated' ? 1 : 2)
			expect(failed).toHaveBeenCalledTimes(1)
			expect(requireHookState(state).forkAuctionFeedback?.status.detail).toContain(status === 'unrelated' ? 'RPC disconnected' : message)
		})

	for (const cancel of ['wallet', 'review'] as const)
		test(`canceling during proof reconstruction stops before writer creation (${cancel})`, async () => {
			const ready = createDeferred<void>()
			const identity = createAuthenticatedClaim()
			let account = WALLET_ADDRESS
			replaceEnvironment({ ...createFakeBackend({ accountAddress: account }), getAccounts: async () => [account] })
			const scope = new AbortController()
			const release = registerTransactionReviewScope(scope.signal)
			const buildForkCarriedEscalationProofs = mock(async () => {
				await ready.promise
				return [createClaimProof(identity)]
			})
			const prepareAndSettleForkClaim = mock(async () => createForkAuctionResult('settleForkedEscalation'))
			const dependencies = createForkAuctionOperationsDependencies({ buildForkCarriedEscalationProofs, prepareAndSettleForkClaim })
			let state: UseForkAuctionOperationsState | undefined
			const Harness = createHarness(
				dependencies,
				value => {
					state = value
				},
				() => undefined,
			)
			trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
			let pending: Promise<void> | undefined
			try {
				await act(async () => {
					pending = requireHookState(state).prepareAndSettleForkDeposit(identity)
					await waitFor(() => expect(buildForkCarriedEscalationProofs).toHaveBeenCalledTimes(1))
				})
				await act(async () => {
					if (cancel === 'wallet') account = SECURITY_POOL_ADDRESS
					else scope.abort()
					ready.resolve()
					await pending
				})
				expect(dependencies.createWalletWriteClient).not.toHaveBeenCalled()
				expect(prepareAndSettleForkClaim).not.toHaveBeenCalled()
			} finally {
				release()
			}
		})

	for (const phase of ['combined simulation', 'combined retry', 'combined estimate', 'combined review', 'preparation reads', 'preparation review', 'settlement review', 'injected accounts', 'injected chain'] as const)
		test(`changing pools after proof loading cancels at the wallet boundary (${phase})`, async () => {
			const identity = createAuthenticatedClaim()
			const proof = createClaimProof(identity)
			const reached = createDeferred<void>()
			const resume = createDeferred<void>()
			const sent = mock(() => undefined)
			const failed = mock(() => undefined)
			let simulations = 0
			let selectedPool = SECURITY_POOL_ADDRESS
			let state: UseForkAuctionOperationsState | undefined
			let writer: ReturnType<typeof createReviewedClient> | undefined
			const transform = { repBeforeAttoRep: 20n, repRemainingAttoRep: 15n, consumedBeforeAttoRep: 1n }
			const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1, 10n, 20n, 1n]))
			const commitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [identity.escalationGame, claimId, zeroHash, 20n, 15n, 1n]))
			const requireWriter = () => {
				if (writer === undefined) throw new Error('Missing claim writer')
				if (phase.endsWith('review')) writer.onTransactionPlan?.([{ functionName: phase.startsWith('preparation') ? 'processClaimCheckpoint' : 'aggregate3', contractAddress: phase.startsWith('preparation') ? identity.escalationGame : getMulticall3Address(), requireReview: true }])
				if (phase === 'settlement review') writer.onTransactionPlan?.([{ functionName: 'withdrawForkedEscalationDeposits', contractAddress: SECURITY_POOL_ADDRESS, requireReview: true }])
				return writer
			}
			const dependencies = createForkAuctionOperationsDependencies({
				buildForkCarriedEscalationProofs: async () => [proof],
				createWalletWriteClient: (_wallet, callbacks) => {
					const base = createWalletClient({
						account: WALLET_ADDRESS,
						chain: MAINNET_NETWORK_PROFILE.chain,
						transport: custom({
							request: async () => {
								throw new Error('Unexpected RPC')
							},
						}),
					}).extend(publicActions)
					const client = Object.assign(
						base,
						asWriteClient(
							createMockWriteClient(sent, async request => {
								if (request.functionName === 'universeId') return 1n
								if (request.functionName === 'escalationGame') return identity.escalationGame
								if (request.functionName === 'getOutcomeState') {
									if (phase === 'preparation reads') {
										reached.resolve()
										await resume.promise
									}
									return { snapshotLeafCount: 2n, snapshotPeaks: Array.from({ length: 64 }, () => zeroHash) }
								}
								if (request.functionName === 'getClaimCheckpointProgress') return [zeroAddress, 1n, false, false]
								if (request.functionName === 'getClaimCheckpointState') return [true, commitment, zeroAddress, { startAttoRep: 10n, endAttoRep: 20n, rewardStartAttoRep: 10n, rewardEndAttoRep: 20n }]
								if (request.functionName === 'getClaimCheckpointWitnessSegment') return [SECURITY_POOL_ADDRESS, zeroHash, 0n, 1n]
								if (request.functionName === 'getClaimIntervalTransform') return [zeroAddress, transform]
								throw new Error(`Unexpected ${request.functionName}`)
							}),
						),
						{
							getBlockNumber: async () => 1n,
							getBlock: async () => ({ number: 1n, hash: commitment, timestamp: 1n, transactions: [] }),
							simulateContract: async () => {
								simulations++
								if (phase === 'combined retry' && simulations === 1) throw new Error('execution reverted: Bad nullifier proof')
								if (phase === 'combined simulation' || phase === 'combined retry') {
									reached.resolve()
									await resume.promise
								}
								return { result: [] }
							},
							estimateGas: async () => {
								if (phase === 'combined estimate') {
									reached.resolve()
									await resume.promise
								}
								return 500_000n
							},
							call: async () => ({ data: '0x' as const }),
							onTransactionPrepared: callbacks?.onTransactionPrepared,
						},
					)
					if (phase === 'injected accounts' || phase === 'injected chain') {
						let prepared = false
						const backend = withTransactionReviews(
							createInjectedBackend({
								profile: SEPOLIA_NETWORK_PROFILE,
								provider: {
									request: async ({ method }) => {
										if (prepared && method === (phase === 'injected accounts' ? 'eth_accounts' : 'eth_chainId')) {
											reached.resolve()
											await resume.promise
										}
										if (method === 'eth_accounts') return [WALLET_ADDRESS]
										if (method === 'eth_chainId') return SEPOLIA_NETWORK_PROFILE.chainIdHex
										if (method === 'eth_sendTransaction') {
											sent()
											return commitment
										}
										throw new Error(`Unexpected injected request: ${method}`)
									},
								},
							}),
						)
						writer = Object.assign(
							backend.createWriteClient(WALLET_ADDRESS, {
								...callbacks,
								onTransactionPrepared: preview => {
									callbacks?.onTransactionPrepared?.(preview)
									prepared = true
								},
							}),
							{ readContract: client.readContract, getBlock: client.getBlock, getBlockNumber: client.getBlockNumber, simulateContract: client.simulateContract, estimateGas: client.estimateGas, call: client.call, waitForTransactionReceipt: client.waitForTransactionReceipt },
						)
					} else writer = createReviewedClient(client, async () => undefined, callbacks?.reviewSignal)
					return { kind: 'injected-write-client' }
				},
				prepareForkClaimCheckpoint: async (_client, pool, claim) => await submitPreparation(requireWriter(), pool, claim),
				prepareAndSettleForkClaim: async (_client, pool, claim, initialProof, rebuild) => await submitCombined(requireWriter(), pool, claim, initialProof, rebuild),
				withdrawForkedEscalationDeposits: async (_client, pool, outcome, proofs) => await submitSettlement(requireWriter(), pool, outcome, proofs),
			})
			const Harness = createHarness(
				dependencies,
				value => {
					state = value
				},
				failed,
				() => selectedPool,
			)
			const rendered = await renderIntoDocument(h(Harness, {}))
			trackCleanup(rendered.cleanup)
			let pending: Promise<void> | undefined
			try {
				await act(async () => {
					if (phase.startsWith('preparation')) pending = requireHookState(state).prepareForkClaim(identity)
					else if (phase === 'settlement review') pending = requireHookState(state).settleForkedEscalation('yes', [identity.parentDepositIndex])
					else pending = requireHookState(state).prepareAndSettleForkDeposit(identity)
					if (phase.endsWith('review')) await waitFor(() => expect(transactionSteps.value?.steps[0]?.phase).toBe('review'))
					else await reached.promise
				})
				await act(async () => {
					selectedPool = getAddress('0x00000000000000000000000000000000000000b3')
					render(h(Harness, { poolAddress: selectedPool }), rendered.container)
				})
				await act(async () => {
					if (phase.endsWith('review')) transactionSteps.value?.confirmStep(0)
					resume.resolve()
					await pending
				})
				expect(sent).not.toHaveBeenCalled()
				expect(failed).not.toHaveBeenCalled()
			} finally {
				resume.resolve()
				transactionSteps.value?.cancel()
				await pending
			}
		})

	for (const remaining of [0n, 1n, 60n, 61n]) {
		test(`unresolved migration rechecks the loaded deadline before calling the writer (${remaining})`, async () => {
			const onTransactionFailed = mock(() => undefined)
			const migrateVaultWithUnresolvedEscalation = mock(async () => createForkAuctionResult('migrateUnresolvedEscalation'))
			const dependencies = createForkAuctionOperationsDependencies({ loadForkAuctionDetails: async () => createForkAuctionDetails({ currentTime: 1000n, migrationEndsAt: 1000n + remaining }), migrateVaultWithUnresolvedEscalation })
			let hookState: UseForkAuctionOperationsState | undefined
			const Harness = createHarness(
				dependencies,
				state => {
					hookState = state
				},
				onTransactionFailed,
			)
			const rendered = await renderIntoDocument(h(Harness, {}))
			trackCleanup(rendered.cleanup)
			await act(async () => {
				await requireHookState(hookState).migrateUnresolvedEscalation('yes')
			})
			expect(migrateVaultWithUnresolvedEscalation).toHaveBeenCalledTimes(remaining > 60n ? 1 : 0)
			expect(onTransactionFailed).toHaveBeenCalledTimes(remaining > 60n ? 0 : 1)
		})
	}

	for (const action of ['startTruthAuction', 'claimAuctionProceeds'] as const)
		for (const outcome of ['failure', 'cancel'] as const) {
			test(`${action} returns to idle after ${outcome} without duplicate errors`, async () => {
				const completion = createDeferred<void>()
				const fail = async () => {
					await completion.promise
					throw new Error(outcome === 'cancel' ? transactionErrorMessages.reviewCanceled : 'Wallet rejected transaction')
				}
				const dependencies = createForkAuctionOperationsDependencies({ startTruthAuctionForSecurityPool: fail, settleTruthAuctionBids: fail })
				let hookState: UseForkAuctionOperationsState | undefined
				function Harness() {
					const state = useForkAuctionOperations(
						{
							accountAddress: WALLET_ADDRESS,
							onTransactionFailed: () => undefined,
							onTransactionFinished: () => undefined,
							onTransactionPresented: () => undefined,
							onTransactionPrepared: () => undefined,
							onTransactionRequested: () => undefined,
							onTransactionSubmitted: () => undefined,
							refreshState: async () => undefined,
							selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS,
						},
						dependencies,
					)
					hookState = state
					const interaction = useForkAuctionInteractionState({ ...state, accountAddress: WALLET_ADDRESS, connectedWalletDisputeStakedAttoRep: undefined, hasStartedTruthAuction: false, reportingDetails: undefined, securityPoolAddress: SECURITY_POOL_ADDRESS, startTruthAuctionSecurityPoolAddress: SECURITY_POOL_ADDRESS })
					const rows = getTruthAuctionSettlementBidRows({
						accountAddress: WALLET_ADDRESS,
						truthAuction: createTruthAuctionMetrics({ finalized: true, hitCap: true, clearingTick: 0n, clearingPrice: 10n ** 18n }),
						viewerBids: [{ activeCumulativeBidBeforeAttoEth: 0n, bidIndex: 0n, bidder: WALLET_ADDRESS, claimed: false, cumulativeBidAttoEth: 1n, bidAmountAttoEth: 1n, refunded: false, tick: 1n }],
					})
					const settlement = useTruthAuctionSettlementActionState({
						...state,
						accountAddress: WALLET_ADDRESS,
						onClaimAuctionProceeds: (...args) => void state.claimAuctionProceeds(...args),
						onRefundLosingBids: (...args) => void state.refundLosingBids(...args),
						selectedAuctionPoolAddress: SECURITY_POOL_ADDRESS,
						selectedAuctionUniverseId: 1n,
						selectedStage: 'settlement',
						settlementBidRows: rows,
						truthAuctionFinalized: true,
					})
					const pending = action === 'startTruthAuction' ? interaction.isStartTruthAuctionInProgressState : settlement.isSettleSelectedBidsInProgress
					return (
						<ForkAuctionWorkflowShell
							embedInCard
							forkAuctionDetailsAvailable
							forkAuctionError={state.forkAuctionError}
							loadingForkAuctionDetails={false}
							loadingReportingDetails={false}
							onLoadForkAuction={() => undefined}
							onLoadReporting={undefined}
							reportingError={undefined}
							securityPoolAddress={SECURITY_POOL_ADDRESS}
							showHeader={false}
						>
							<button
								disabled={pending}
								onClick={() => {
									if (action === 'startTruthAuction') {
										interaction.beginStartTruthAuctionProgress()
										void state.startTruthAuction()
									} else settlement.submitClaimBidsByKeys(['1:0'])
								}}
							>
								{pending ? 'Pending' : 'Submit'}
							</button>
							{state.forkAuctionFeedback?.status.tone === 'error' ? <TransactionStatusCard {...state.forkAuctionFeedback.status} /> : undefined}
						</ForkAuctionWorkflowShell>
					)
				}
				const rendered = await renderIntoDocument(<Harness />)
				trackCleanup(rendered.cleanup)
				const button = document.querySelector('button')
				if (!(button instanceof HTMLButtonElement)) throw new Error('Missing submit button')
				await act(() => button.click())
				await waitFor(() => expect(button.disabled).toBe(true))
				await act(async () => {
					completion.resolve()
					await Bun.sleep(10)
				})
				await waitFor(() => expect(button.disabled).toBe(false))
				expect(requireHookState(hookState).forkAuctionActiveAction).toBeUndefined()
				expect(requireHookState(hookState).forkAuctionError).toBeUndefined()
				expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
				expect(document.querySelectorAll('.transaction-status-card')).toHaveLength(outcome === 'failure' ? 1 : 0)
			})
		}

	test('refundLosingBids preserves negative settlement ticks from the selection list', async () => {
		const selectedBids: readonly SettlementSelectedBid[] = [{ bidIndex: 4n, tick: -3n }]
		const onTransactionFailed = mock(() => undefined)
		const refundTruthAuctionBid = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, batch: readonly SettlementSelectedBid[] = []) => {
			expect(securityPoolAddress).toBe(SECURITY_POOL_ADDRESS)
			expect(universeId).toBe(1n)
			expect(truthAuctionAddress).toBe(TRUTH_AUCTION_ADDRESS)
			expect(tick).toBe(-3n)
			expect(bidIndex).toBe(4n)
			expect(batch).toEqual([{ bidIndex: 4n, tick: -3n }])
			return createForkAuctionResult('refundLosingBids')
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			refundTruthAuctionBid,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).refundLosingBids(undefined, selectedBids)
		})

		expect(refundTruthAuctionBid).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('refundLosingBids')
	})

	test('withdrawAuctionRefund pulls the connected wallet credit from the selected truth auction', async () => {
		const onTransactionFailed = mock(() => undefined)
		const withdrawTruthAuctionRefund = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address) => {
			expect(securityPoolAddress).toBe(SECURITY_POOL_ADDRESS)
			expect(universeId).toBe(1n)
			expect(truthAuctionAddress).toBe(TRUTH_AUCTION_ADDRESS)
			return createForkAuctionResult('withdrawAuctionRefund')
		})
		const dependencies = createForkAuctionOperationsDependencies({ withdrawTruthAuctionRefund })
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).withdrawAuctionRefund()
		})

		expect(withdrawTruthAuctionRefund).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('withdrawAuctionRefund')
	})

	test('claimAuctionProceeds preserves negative winning and refund ticks from settlement selections', async () => {
		const selectedClaimBids: readonly SettlementSelectedBid[] = [{ bidIndex: 1n, tick: -9n }]
		const selectedRefundBids: readonly SettlementSelectedBid[] = [{ bidIndex: 3n, tick: -2n }]
		const onTransactionFailed = mock(() => undefined)
		const settleTruthAuctionBids = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, bidderAddress: Address, claimBids: readonly SettlementSelectedBid[], refundBids: readonly SettlementSelectedBid[]) => {
			expect(securityPoolAddress).toBe(SECURITY_POOL_ADDRESS)
			expect(universeId).toBe(1n)
			expect(bidderAddress).toBe(WALLET_ADDRESS)
			expect(claimBids).toEqual([{ bidIndex: 1n, tick: -9n }])
			expect(refundBids).toEqual([{ bidIndex: 3n, tick: -2n }])
			return createForkAuctionResult('claimAuctionProceeds')
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			settleTruthAuctionBids,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).claimAuctionProceeds(undefined, selectedClaimBids, selectedRefundBids)
		})

		expect(settleTruthAuctionBids).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('claimAuctionProceeds')
	})

	test('refundLosingBids rejects placeholder-only settlement selections after filtering negative bid indexes', async () => {
		const selectedBids: readonly SettlementSelectedBid[] = [
			{ bidIndex: -1n, tick: 3n },
			{ bidIndex: -2n, tick: 4n },
		]
		const onTransactionFailed = mock(() => undefined)
		const refundTruthAuctionBid = mock(async () => {
			throw new Error('refundTruthAuctionBid should not run for placeholder-only selections')
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			refundTruthAuctionBid,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).refundLosingBids(undefined, selectedBids)
		})

		expect(refundTruthAuctionBid).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).forkAuctionFeedback?.status.detail).toContain('Select one or more bids to refund first')
	})

	test('claimAuctionProceeds rejects placeholder-only settlement selections after filtering negative bid indexes', async () => {
		const selectedClaimBids: readonly SettlementSelectedBid[] = [{ bidIndex: -1n, tick: 3n }]
		const selectedRefundBids: readonly SettlementSelectedBid[] = [{ bidIndex: -2n, tick: 4n }]
		const onTransactionFailed = mock(() => undefined)
		const settleTruthAuctionBids = mock(async () => {
			throw new Error('settleTruthAuctionBids should not run for placeholder-only selections')
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			settleTruthAuctionBids,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).claimAuctionProceeds(undefined, selectedClaimBids, selectedRefundBids)
		})

		expect(settleTruthAuctionBids).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).forkAuctionFeedback?.status.detail).toContain('Select one or more bids to settle first')
	})

	test('loadForkAuction ignores stale results when overlapping requests resolve out of order', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000e5')
		const deferredLoads: { deferred: ReturnType<typeof createDeferred<ForkAuctionDetails>>; securityPoolAddress: Address }[] = []
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async (securityPoolAddress: Address) => {
			const deferred = createDeferred<ForkAuctionDetails>()
			deferredLoads.push({ deferred, securityPoolAddress })
			return await deferred.promise
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: firstPoolAddress,
			}))
		})

		let firstLoadPromise = Promise.resolve()
		await act(() => {
			firstLoadPromise = requireHookState(hookState).loadForkAuction()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(1)
		})

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: secondPoolAddress,
			}))
		})

		let secondLoadPromise = Promise.resolve()
		await act(() => {
			secondLoadPromise = requireHookState(hookState).loadForkAuction()
		})
		await waitFor(() => {
			expect(deferredLoads).toHaveLength(2)
		})

		expect(loadForkAuctionDetails).toHaveBeenCalledTimes(2)
		expect(deferredLoads.map(load => load.securityPoolAddress)).toEqual([firstPoolAddress, secondPoolAddress])

		await act(async () => {
			deferredLoads[0]?.deferred.resolve(createForkAuctionDetails({ securityPoolAddress: firstPoolAddress }))
			await firstLoadPromise
		})

		expect(requireHookState(hookState).forkAuctionDetails).toBeUndefined()
		expect(requireHookState(hookState).loadingForkAuctionDetails).toBe(true)

		await act(async () => {
			deferredLoads[1]?.deferred.resolve(createForkAuctionDetails({ securityPoolAddress: secondPoolAddress }))
			await secondLoadPromise
		})

		expect(requireHookState(hookState).forkAuctionError).toBeUndefined()
		expect(requireHookState(hookState).loadingForkAuctionDetails).toBe(false)
		expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('initiateFork ignores a stale post-success refresh after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000f4')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000f5')
		const staleRefresh = createDeferred<ForkAuctionDetails>()
		let firstPoolLoadCount = 0
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async (securityPoolAddress: Address) => {
			if (securityPoolAddress === firstPoolAddress) {
				firstPoolLoadCount += 1
				if (firstPoolLoadCount === 1) return createForkAuctionDetails({ securityPoolAddress: firstPoolAddress })
				return await staleRefresh.promise
			}
			if (securityPoolAddress === secondPoolAddress) return createForkAuctionDetails({ securityPoolAddress: secondPoolAddress })
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const initiateSecurityPoolFork = mock(async () => ({
			action: 'initiateFork' as const,
			hash: zeroHash,
			securityPoolAddress: firstPoolAddress,
			universeId: 1n,
		}))
		const dependencies = createForkAuctionOperationsDependencies({
			initiateSecurityPoolFork,
			loadForkAuctionDetails,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: firstPoolAddress,
			}))
		})

		let initiateForkPromise = Promise.resolve()
		await act(() => {
			initiateForkPromise = requireHookState(hookState).initiateFork()
		})

		await waitFor(() => {
			expect(loadForkAuctionDetails).toHaveBeenCalledTimes(2)
		})

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: secondPoolAddress,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadForkAuction()
		})

		await waitFor(() => expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress))

		await act(async () => {
			staleRefresh.resolve(createForkAuctionDetails({ securityPoolAddress: firstPoolAddress }))
			await initiateForkPromise
		})

		expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('initiateFork')
		expect(initiateSecurityPoolFork).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('submitBid ignores a stale preflight balance refresh after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000f6')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000f7')
		const staleBalance = createDeferred<bigint>()
		const detailsA = createForkAuctionDetails({
			securityPoolAddress: firstPoolAddress,
			truthAuction: createTruthAuctionMetrics(),
		})
		const detailsB = createForkAuctionDetails({
			securityPoolAddress: secondPoolAddress,
			truthAuction: createTruthAuctionMetrics(),
		})
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async (securityPoolAddress: Address) => {
			if (securityPoolAddress === firstPoolAddress) return detailsA
			if (securityPoolAddress === secondPoolAddress) return detailsB
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const submitTruthAuctionBid = mock(async () => ({
			action: 'submitBid' as const,
			hash: zeroHash,
			securityPoolAddress: firstPoolAddress,
			universeId: 1n,
		}))
		const readClient = {
			getBalance: mock(async () => await staleBalance.promise),
		}
		let transactionState = createInitialTransactionTrayState()
		const dependencies = createForkAuctionOperationsDependencies({
			createConnectedReadClient: mock(() => readClient),
			loadForkAuctionDetails,
			submitTruthAuctionBid,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionCanceled: () => {
						transactionState = markTransactionCanceled(transactionState)
					},
					onTransactionFailed,
					onTransactionFinished: () => {
						transactionState = markTransactionFinished(transactionState)
					},
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: (intent: TransactionIntent) => {
						transactionState = markTransactionRequested(transactionState, intent)
					},
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: firstPoolAddress,
				submitBidAmount: '1',
				submitBidPrice: '1',
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadForkAuction()
		})

		await waitFor(() => expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(firstPoolAddress))

		let submitBidPromise = Promise.resolve()
		await act(() => {
			submitBidPromise = requireHookState(hookState).submitBid()
		})

		await waitFor(() => expect(readClient.getBalance).toHaveBeenCalledTimes(1))
		expect(requireHookState(hookState).forkAuctionFeedback?.status.tone).toBe('pending')
		expect(transactionState.entries[0]?.intent.action).toBe('submitBid')
		expect(transactionState.active?.tone).toBe('awaiting-wallet')

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: secondPoolAddress,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadForkAuction()
		})

		await waitFor(() => expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress))

		await act(async () => {
			staleBalance.resolve(2n * 10n ** 18n)
			await submitBidPromise
		})

		expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(requireHookState(hookState).forkAuctionFeedback).toBeUndefined()
		expect(submitTruthAuctionBid).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.entries).toEqual([])
		expect(transactionState.entries.length).toBe(0)
	})

	for (const nearDeadline of [false, true]) {
		test(`submitBid ${nearDeadline ? 'blocks refreshed deadline before sending' : 'snapshots the submitted form values before the balance preflight resolves'}`, async () => {
			const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000fa')
			const walletBalance = createDeferred<bigint>()
			const initialBidAmount = '1'
			const initialBidPrice = '1'
			const editedBidAmount = '3'
			const editedBidPrice = '2'
			const expectedBidTick = getTruthAuctionTickAtPrice(parseTruthAuctionPriceInput(initialBidPrice, 'Bid price'))
			if (expectedBidTick === undefined) throw new Error('Expected initial bid price to map to a valid truth auction tick')
			const expectedBidAmount = parseTruthAuctionAmountInput(initialBidAmount, 'Bid amount')
			const details = createForkAuctionDetails({
				securityPoolAddress: firstPoolAddress,
				truthAuction: createTruthAuctionMetrics(),
			})
			const onTransactionFailed = mock(() => undefined)
			const loadForkAuctionDetails = mock(async () => (loadForkAuctionDetails.mock.calls.length > 1 && nearDeadline ? { ...details, currentTime: 399n } : details))
			const submitTruthAuctionBid = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) => {
				expect(securityPoolAddress).toBe(firstPoolAddress)
				expect(universeId).toBe(1n)
				expect(truthAuctionAddress).toBe(TRUTH_AUCTION_ADDRESS)
				expect(tick).toBe(expectedBidTick)
				expect(amount).toBe(expectedBidAmount)
				return createForkAuctionResult('submitBid')
			})
			const readClient = {
				getBalance: mock(async () => await walletBalance.promise),
			}
			const dependencies = createForkAuctionOperationsDependencies({
				createConnectedReadClient: mock(() => readClient),
				loadForkAuctionDetails,
				submitTruthAuctionBid,
			})

			let hookState: UseForkAuctionOperationsState | undefined
			function Harness() {
				const state = useForkAuctionOperations(
					{
						accountAddress: WALLET_ADDRESS,
						onTransactionFailed,
						onTransactionFinished: () => undefined,
						onTransactionPresented: () => undefined,
						onTransactionPrepared: () => undefined,
						onTransactionRequested: () => undefined,
						onTransactionSubmitted: () => undefined,
						refreshState: async () => undefined,
					},
					dependencies,
				)
				hookState = state
				return <div />
			}

			const renderedComponent = await renderIntoDocument(h(Harness, {}))
			trackCleanup(renderedComponent.cleanup)

			await act(async () => {
				requireHookState(hookState).setForkAuctionForm(current => ({
					...current,
					securityPoolAddress: firstPoolAddress,
					submitBidAmount: initialBidAmount,
					submitBidPrice: initialBidPrice,
				}))
			})

			await act(async () => {
				await requireHookState(hookState).loadForkAuction()
			})

			await waitFor(() => expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(firstPoolAddress))

			let submitBidPromise = Promise.resolve()
			await act(() => {
				submitBidPromise = requireHookState(hookState).submitBid()
			})

			await waitFor(() => expect(readClient.getBalance).toHaveBeenCalledTimes(1))

			await act(async () => {
				requireHookState(hookState).setForkAuctionForm(current => ({
					...current,
					submitBidAmount: editedBidAmount,
					submitBidPrice: editedBidPrice,
				}))
			})

			await act(async () => {
				walletBalance.resolve(2n * 10n ** 18n)
				await submitBidPromise
			})

			if (nearDeadline) {
				expect(submitTruthAuctionBid).not.toHaveBeenCalled()
				expect(onTransactionFailed).toHaveBeenCalledTimes(1)
				expect(requireHookState(hookState).forkAuctionFeedback?.status.detail).toContain('Truth auction ends too soon to submit a bid')
				// A failed bid keeps the form so the user can retry.
				expect(requireHookState(hookState).forkAuctionForm.submitBidAmount).toBe(editedBidAmount)
			} else {
				expect(submitTruthAuctionBid).toHaveBeenCalledTimes(1)
				expect(requireHookState(hookState).forkAuctionResult?.action).toBe('submitBid')
				expect(onTransactionFailed).not.toHaveBeenCalled()
				// A successful bid clears its amount so a second click cannot repeat it; the price stays for the next bid.
				expect(requireHookState(hookState).forkAuctionForm.submitBidAmount).toBe('')
				expect(requireHookState(hookState).forkAuctionForm.submitBidPrice).toBe(editedBidPrice)
			}
		})
	}

	test('claimParentEscalation snapshots the submitted form values before details reload resolves', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000fb')
		const initialVaultAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const editedVaultAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const detailsReload = createDeferred<ForkAuctionDetails>()
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async () => await detailsReload.promise)
		const claimParentEscalationDeposits = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: string, depositIndexes: bigint[]) => {
			expect(securityPoolAddress).toBe(firstPoolAddress)
			expect(universeId).toBe(1n)
			expect(vaultAddress).toBe(initialVaultAddress)
			expect(outcome).toBe('yes')
			expect(depositIndexes).toEqual([1n, 3n])
			return createForkAuctionResult('claimParentEscalationDeposits')
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails,
			claimParentEscalationDeposits,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				depositIndexes: '1,3',
				securityPoolAddress: firstPoolAddress,
				selectedOutcome: 'yes',
				vaultAddress: initialVaultAddress,
			}))
		})

		let claimPromise = Promise.resolve()
		await act(() => {
			claimPromise = requireHookState(hookState).claimParentEscalation()
		})

		await waitFor(() => expect(loadForkAuctionDetails).toHaveBeenCalledTimes(1))

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				depositIndexes: '2',
				selectedOutcome: 'no',
				vaultAddress: editedVaultAddress,
			}))
		})

		await act(async () => {
			detailsReload.resolve(createForkAuctionDetails({ securityPoolAddress: firstPoolAddress }))
			await claimPromise
		})

		expect(claimParentEscalationDeposits).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('claimParentEscalationDeposits')
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('migrateVault snapshots the submitted outcome before details reload resolves', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000fc')
		const detailsReload = createDeferred<ForkAuctionDetails>()
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async () => await detailsReload.promise)
		const migrateSecurityVault = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, outcome: string) => {
			expect(securityPoolAddress).toBe(firstPoolAddress)
			expect(universeId).toBe(1n)
			expect(outcome).toBe('yes')
			return createForkAuctionResult('migrateVault')
		})
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails,
			migrateSecurityVault,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: firstPoolAddress,
				selectedOutcome: 'yes',
			}))
		})

		let migratePromise = Promise.resolve()
		await act(() => {
			migratePromise = requireHookState(hookState).migrateVault()
		})

		await waitFor(() => expect(loadForkAuctionDetails).toHaveBeenCalledTimes(1))

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				selectedOutcome: 'no',
			}))
		})

		await act(async () => {
			detailsReload.resolve(createForkAuctionDetails({ securityPoolAddress: firstPoolAddress }))
			await migratePromise
		})

		expect(migrateSecurityVault).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('migrateVault')
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test.each([
		{ ownFork: false, expectedAmount: 20n },
		{ ownFork: true, expectedAmount: 7n },
	])('migration reviews receive the REP amounts the UI already loaded (own fork: $ownFork)', async ({ ownFork, expectedAmount }) => {
		const details = createForkAuctionDetails({ ...(ownFork ? { ownForkRepBuckets: { vaultRepAtForkAttoRep: 7n, escalationChildRepPerSelectedOutcomeAttoRep: 3n, escrowSourceRepAtForkAttoRep: 2n } } : {}) })
		const migrateRepToZoltarFromSecurityPool = mock(async (..._args: Parameters<UseForkAuctionOperationsDependencies<TestForkAuctionWriteClient>['migrateRepToZoltarFromSecurityPool']>) => createForkAuctionResult('migrateRepToZoltar'))
		const migrateSecurityVault = mock(async (..._args: Parameters<UseForkAuctionOperationsDependencies<TestForkAuctionWriteClient>['migrateSecurityVault']>) => createForkAuctionResult('migrateVault'))
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails: mock(async () => details),
			migrateRepToZoltarFromSecurityPool,
			migrateSecurityVault,
		})
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			hookState = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed: () => undefined,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)
		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({ ...current, securityPoolAddress: SECURITY_POOL_ADDRESS, selectedOutcome: 'no' }))
		})
		await act(async () => {
			await requireHookState(hookState).migrateRepToZoltar(['yes'])
		})
		await act(async () => {
			await requireHookState(hookState).migrateVault({ repAttoRep: 5n, underwritingLimitAttoEth: 4n })
		})
		expect(migrateRepToZoltarFromSecurityPool.mock.calls[0]?.slice(1)).toEqual([SECURITY_POOL_ADDRESS, 1n, ['yes'], expectedAmount])
		expect(migrateSecurityVault.mock.calls[0]?.slice(1)).toEqual([SECURITY_POOL_ADDRESS, 1n, 'no', { repAttoRep: 5n, underwritingLimitAttoEth: 4n }])
	})

	test('startTruthAuction override ignores a stale post-success refresh after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000f8')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000f9')
		const staleRefresh = createDeferred<ForkAuctionDetails>()
		let firstPoolLoadCount = 0
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async (securityPoolAddress: Address) => {
			if (securityPoolAddress === firstPoolAddress) {
				firstPoolLoadCount += 1
				if (firstPoolLoadCount === 1) return createForkAuctionDetails({ securityPoolAddress: firstPoolAddress })
				return await staleRefresh.promise
			}
			if (securityPoolAddress === secondPoolAddress) return createForkAuctionDetails({ securityPoolAddress: secondPoolAddress })
			throw new Error(`Unexpected security pool ${securityPoolAddress}`)
		})
		const startTruthAuctionForSecurityPool = mock(async () => ({
			action: 'startTruthAuction' as const,
			hash: zeroHash,
			securityPoolAddress: firstPoolAddress,
			universeId: 1n,
		}))
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails,
			startTruthAuctionForSecurityPool,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: firstPoolAddress,
			}))
		})

		let startTruthAuctionPromise = Promise.resolve()
		await act(() => {
			startTruthAuctionPromise = requireHookState(hookState).startTruthAuction(firstPoolAddress)
		})

		await waitFor(() => {
			expect(loadForkAuctionDetails).toHaveBeenCalledTimes(2)
		})

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				securityPoolAddress: secondPoolAddress,
			}))
		})

		await act(async () => {
			await requireHookState(hookState).loadForkAuction()
		})

		await waitFor(() => expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress))

		await act(async () => {
			staleRefresh.resolve(createForkAuctionDetails({ securityPoolAddress: firstPoolAddress }))
			await startTruthAuctionPromise
		})

		expect(requireHookState(hookState).forkAuctionDetails?.securityPoolAddress).toBe(secondPoolAddress)
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('startTruthAuction')
		expect(startTruthAuctionForSecurityPool).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('startTruthAuction override preserves the child pool and universe throughout transaction states', async () => {
		const parentPoolAddress = getAddress('0x0000000000000000000000000000000000000011')
		const childPoolAddress = getAddress('0x0000000000000000000000000000000000000022')
		const childUniverseId = 22n
		let transactionState = createInitialTransactionTrayState()
		const startTruthAuctionForSecurityPool = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint) => ({
			action: 'startTruthAuction' as const,
			hash: zeroHash,
			securityPoolAddress,
			universeId,
		}))
		const dependencies = createForkAuctionOperationsDependencies({
			loadForkAuctionDetails: mock(async securityPoolAddress => createForkAuctionDetails({ securityPoolAddress, universeId: childUniverseId })),
			startTruthAuctionForSecurityPool,
		})

		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations(
				{
					accountAddress: WALLET_ADDRESS,
					onTransactionFailed: message => {
						transactionState = markTransactionFailed(transactionState, { kind: 'error', message })
					},
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionPrepared: () => undefined,
					onTransactionRequested: intent => {
						transactionState = markTransactionRequested(transactionState, intent)
					},
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					selectedSecurityPoolAddress: parentPoolAddress,
				},
				dependencies,
			)
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).startTruthAuction(childPoolAddress, childUniverseId)
		})

		expect(startTruthAuctionForSecurityPool).toHaveBeenCalledTimes(1)
		const requested = transactionState
		const prepared = markTransactionPrepared(requested, {
			account: WALLET_ADDRESS,
			args: [childPoolAddress, childUniverseId],
			chainName: 'Ethereum',
			contractAddress: childPoolAddress,
			functionName: 'startTruthAuction',
			value: 0n,
		})
		const submitted = markTransactionSubmitted(prepared, zeroHash)
		const failed = markTransactionFailed(submitted, { kind: 'reverted', message: 'Transaction reverted' })

		for (const state of [requested, prepared, submitted, failed]) {
			expect(getTransactionRowValueProp(state, 'Pool', 'address')).toBe(childPoolAddress)
			expect(state.active?.rows?.map(row => row.label)).not.toContain('Universe')
			expect(getTransactionRowValueProp(state, 'Pool', 'address')).not.toBe(parentPoolAddress)
		}
		expect(prepared.active?.technicalRows?.map(row => row.label)).toContain('Function')
		expect(submitted.active?.technicalRows?.map(row => row.label)).toContain('Function')
		expect(failed.active?.technicalRows?.map(row => row.label)).toContain('Function')
	})
})
