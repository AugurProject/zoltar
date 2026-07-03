/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash, type Address } from 'viem'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '../lib/transactionTray.js'
import { parseTruthAuctionAmountInput, parseTruthAuctionPriceInput } from '../lib/marketForm.js'
import { getTruthAuctionTickAtPrice } from '../lib/truthAuctionBook.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { waitFor } from './testUtils/queries'
import type { ForkAuctionActionResult, ForkAuctionDetails, MarketDetails } from '../types/contracts.js'
import type { SettlementSelectedBid, TransactionIntent } from '../types/components.js'
import type { TruthAuctionMetrics } from '../types/contracts.js'

type UseForkAuctionOperations = typeof import('../hooks/useForkAuctionOperations.js')['useForkAuctionOperations']
type UseForkAuctionOperationsState = ReturnType<UseForkAuctionOperations>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const SECURITY_POOL_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const TRUTH_AUCTION_ADDRESS = getAddress('0x00000000000000000000000000000000000000c3')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createMarketDetails(): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 0n,
		claimingAvailable: true,
		completeSetCollateralAmount: 1n,
		currentTime: 250n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: true,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		auctionableRepAtFork: 20n,
		securityPoolAddress: SECURITY_POOL_ADDRESS,
		systemState: 'forkTruthAuction',
		truthAuction: undefined,
		truthAuctionAddress: TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 100n,
		universeId: 1n,
		...overrides,
	}
}

function createTruthAuctionMetrics(overrides: Partial<TruthAuctionMetrics> = {}): TruthAuctionMetrics {
	return {
		accumulatedEth: 1n * 10n ** 18n,
		auctionEndsAt: 300n,
		clearingPrice: undefined,
		clearingTick: undefined,
		ethAtClearingTick: 0n,
		ethRaiseCap: 100n * 10n ** 18n,
		ethRaised: 1n * 10n ** 18n,
		finalized: false,
		hitCap: false,
		maxRepBeingSold: 100n * 10n ** 18n,
		minBidSize: 1n * 10n ** 18n,
		repPurchasableAtBid: 1n * 10n ** 18n,
		timeRemaining: 50n,
		totalRepPurchased: 0n,
		underfunded: false,
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

function requireHookState(state: UseForkAuctionOperationsState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

function createHarness(useForkAuctionOperations: UseForkAuctionOperations, onRender: (state: UseForkAuctionOperationsState) => void, onTransactionFailed: (message: string) => void) {
	return function ForkAuctionOperationsHarness() {
		const state = useForkAuctionOperations({
			accountAddress: WALLET_ADDRESS,
			onTransactionFailed,
			onTransactionFinished: () => undefined,
			onTransactionPresented: () => undefined,
			onTransactionPrepared: () => undefined,
			onTransactionRequested: () => undefined,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
			selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS,
		})
		onRender(state)
		return <div />
	}
}

describe('useForkAuctionOperations', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let resetEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
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

	test('refundLosingBids preserves negative settlement ticks from the selection list', async () => {
		const selectedBids: readonly SettlementSelectedBid[] = [{ bidIndex: 4n, tick: -3n }]
		const onTransactionFailed = mock(() => undefined)
		const refundTruthAuctionBid = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, batch: readonly SettlementSelectedBid[]) => {
			expect(securityPoolAddress).toBe(SECURITY_POOL_ADDRESS)
			expect(universeId).toBe(1n)
			expect(truthAuctionAddress).toBe(TRUTH_AUCTION_ADDRESS)
			expect(tick).toBe(-3n)
			expect(bidIndex).toBe(4n)
			expect(batch).toEqual([{ bidIndex: 4n, tick: -3n }])
			return createForkAuctionResult('refundLosingBids')
		})
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			refundTruthAuctionBid,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			useForkAuctionOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).refundLosingBids(undefined, selectedBids)
		})

		expect(refundTruthAuctionBid).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('refundLosingBids')
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
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			settleTruthAuctionBids,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			useForkAuctionOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			refundTruthAuctionBid,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			useForkAuctionOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).refundLosingBids(undefined, selectedBids)
		})

		expect(refundTruthAuctionBid).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).forkAuctionFeedback?.status.detail).toContain('Pick one or more bids to refund first')
	})

	test('claimAuctionProceeds rejects placeholder-only settlement selections after filtering negative bid indexes', async () => {
		const selectedClaimBids: readonly SettlementSelectedBid[] = [{ bidIndex: -1n, tick: 3n }]
		const selectedRefundBids: readonly SettlementSelectedBid[] = [{ bidIndex: -2n, tick: 4n }]
		const onTransactionFailed = mock(() => undefined)
		const settleTruthAuctionBids = mock(async () => {
			throw new Error('settleTruthAuctionBids should not run for placeholder-only selections')
		})
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails: mock(async () => createForkAuctionDetails()),
			settleTruthAuctionBids,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		const Harness = createHarness(
			useForkAuctionOperations,
			state => {
				hookState = state
			},
			onTransactionFailed,
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).claimAuctionProceeds(undefined, selectedClaimBids, selectedRefundBids)
		})

		expect(settleTruthAuctionBids).not.toHaveBeenCalled()
		expect(requireHookState(hookState).forkAuctionFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).forkAuctionFeedback?.status.detail).toContain('Pick one or more bids to settle first')
	})

	test('loadForkAuction ignores stale results when overlapping requests resolve out of order', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000d4')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000e5')
		const deferredLoads: { deferred: ReturnType<typeof createDeferred<ForkAuctionDetails>>; securityPoolAddress: Address }[] = []
		const onTransactionFailed = mock(() => undefined)
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')
		const loadForkAuctionDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
			const deferred = createDeferred<ForkAuctionDetails>()
			deferredLoads.push({ deferred, securityPoolAddress })
			return await deferred.promise
		})

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')
		const loadForkAuctionDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
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

		mock.module('../contracts.js', () => ({
			...actualContracts,
			initiateSecurityPoolFork,
			loadForkAuctionDetails,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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
		const loadForkAuctionDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
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
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')
		const readClient = {
			getBalance: mock(async () => await staleBalance.promise),
		}
		let transactionState = createInitialTransactionTrayState()

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails,
			submitTruthAuctionBid,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
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
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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
		expect(transactionState.pendingIntent?.action).toBe('submitBid')
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
		expect(transactionState.pendingIntent).toBeUndefined()
		expect(transactionState.inFlightCount).toBe(0)
	})

	test('submitBid snapshots the submitted form values before the balance preflight resolves', async () => {
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
		const loadForkAuctionDetails = mock(async () => details)
		const submitTruthAuctionBid = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) => {
			expect(securityPoolAddress).toBe(firstPoolAddress)
			expect(universeId).toBe(1n)
			expect(truthAuctionAddress).toBe(TRUTH_AUCTION_ADDRESS)
			expect(tick).toBe(expectedBidTick)
			expect(amount).toBe(expectedBidAmount)
			return createForkAuctionResult('submitBid')
		})
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')
		const readClient = {
			getBalance: mock(async () => await walletBalance.promise),
		}

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails,
			submitTruthAuctionBid,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => readClient),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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

		expect(submitTruthAuctionBid).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('submitBid')
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('migrateEscalation snapshots the submitted form values before details reload resolves', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000fb')
		const initialVaultAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const editedVaultAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const detailsReload = createDeferred<ForkAuctionDetails>()
		const onTransactionFailed = mock(() => undefined)
		const loadForkAuctionDetails = mock(async () => await detailsReload.promise)
		const migrateEscalationDeposits = mock(async (_client: unknown, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: string, depositIndexes: bigint[]) => {
			expect(securityPoolAddress).toBe(firstPoolAddress)
			expect(universeId).toBe(1n)
			expect(vaultAddress).toBe(initialVaultAddress)
			expect(outcome).toBe('yes')
			expect(depositIndexes).toEqual([1n, 3n])
			return createForkAuctionResult('migrateEscalationDeposits')
		})
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails,
			migrateEscalationDeposits,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setForkAuctionForm(current => ({
				...current,
				depositIndexes: '1,3',
				securityPoolAddress: firstPoolAddress,
				selectedOutcome: 'yes',
				vaultAddress: initialVaultAddress,
			}))
		})

		let migratePromise = Promise.resolve()
		await act(() => {
			migratePromise = requireHookState(hookState).migrateEscalation()
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
			await migratePromise
		})

		expect(migrateEscalationDeposits).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).forkAuctionResult?.action).toBe('migrateEscalationDeposits')
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
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails,
			migrateSecurityVault,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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

	test('startTruthAuction override ignores a stale post-success refresh after the selected pool changes', async () => {
		const firstPoolAddress = getAddress('0x00000000000000000000000000000000000000f8')
		const secondPoolAddress = getAddress('0x00000000000000000000000000000000000000f9')
		const staleRefresh = createDeferred<ForkAuctionDetails>()
		let firstPoolLoadCount = 0
		const onTransactionFailed = mock(() => undefined)
		const actualContracts = await import('../contracts.js')
		const actualClients = await import('../lib/clients.js')
		const loadForkAuctionDetails = mock(async (_client: unknown, securityPoolAddress: Address) => {
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

		mock.module('../contracts.js', () => ({
			...actualContracts,
			loadForkAuctionDetails,
			startTruthAuctionForSecurityPool,
		}))
		mock.module('../lib/clients.js', () => ({
			...actualClients,
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useForkAuctionOperations } = await import(`../hooks/useForkAuctionOperations.js?case=${crypto.randomUUID()}`)
		let hookState: UseForkAuctionOperationsState | undefined
		function Harness() {
			const state = useForkAuctionOperations({
				accountAddress: WALLET_ADDRESS,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				selectedSecurityPoolAddress: undefined,
			})
			hookState = state
			return <div />
		}

		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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
})
