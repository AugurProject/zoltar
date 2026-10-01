/// <reference types="bun-types" />

import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionActionResult, TruthAuctionBidView } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useTruthAuctionBookData } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionBookData.js'
import { useTruthAuctionPaginationState } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionPaginationState.js'
import { useTruthAuctionSettlementActionState } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js'
import type { TruthAuctionBidDisposition } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionBook.js'
import { getTruthAuctionSettlementBidKey, type TruthAuctionSettlementBidRow } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionSettlement.js'
import type { SettlementSelectedBid } from '@zoltar/ui-zoltar-shared/features/types.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { renderHookWithProps } from '../../support/renderHook.js'

const walletAddress: Address = '0x0000000000000000000000000000000000000001'
const otherWalletAddress: Address = '0x0000000000000000000000000000000000000002'
const poolAddress: Address = '0x0000000000000000000000000000000000000100'
const truthAuctionAddress: Address = '0x0000000000000000000000000000000000000200'
const otherTruthAuctionAddress: Address = '0x0000000000000000000000000000000000000201'

type SettlementProps = Parameters<typeof useTruthAuctionSettlementActionState>[0]
type SettlementState = ReturnType<typeof useTruthAuctionSettlementActionState>
type BookProps = Parameters<typeof useTruthAuctionBookData>[0]
type ReadContractRequest = Parameters<ReadClient['readContract']>[0]
type SelectedBids = readonly SettlementSelectedBid[] | undefined
type ClaimCall = { claimBids: SelectedBids; pool: Address | undefined; refundBids: SelectedBids }
type RefundCall = { bids: SelectedBids; pool: Address | undefined }
type RefundRoutingCase = {
	expectedClaimCalls: ClaimCall[]
	expectedRefundCalls: RefundCall[]
	finalized: boolean
	name: string
	resultAction: ForkAuctionActionResult['action']
	submit: (state: SettlementState, refundKey: string) => void
	submitSelection: boolean
}

const claimDisposition: TruthAuctionBidDisposition = {
	canPrefillRefund: false,
	canPrefillSettle: true,
	label: 'Winning',
	settlementKind: 'repClaim',
	summaryKind: 'winning',
	tone: 'success',
}

const refundDisposition: TruthAuctionBidDisposition = {
	canPrefillRefund: true,
	canPrefillSettle: false,
	label: 'Refundable',
	settlementKind: 'ethRefund',
	summaryKind: 'refundable',
	tone: 'danger',
}

function createBid({ bidIndex, tick }: { bidIndex: bigint; tick: bigint }): TruthAuctionBidView {
	return {
		activeCumulativeBidBeforeAttoEth: 0n,
		bidIndex,
		bidder: walletAddress,
		claimed: false,
		cumulativeBidAttoEth: 1n,
		bidAmountAttoEth: 1n,
		refunded: false,
		tick,
	}
}

function createSettlementRow({ bidIndex, disposition, tick }: { bidIndex: bigint; disposition: TruthAuctionBidDisposition; tick: bigint }): TruthAuctionSettlementBidRow {
	return {
		bid: createBid({ bidIndex, tick }),
		disposition,
	}
}

function createForkAuctionResult(action: ForkAuctionActionResult['action'], hash: ForkAuctionActionResult['hash']): ForkAuctionActionResult {
	return {
		action,
		hash,
		securityPoolAddress: poolAddress,
		universeId: 1n,
	}
}

/** A bid-book read client whose `readContract` dispatches on the function name; unknown reads fail the test. */
function createBookReadClient(handlers: Record<string, (request: ReadContractRequest) => unknown>): Pick<ReadClient, 'readContract'> {
	return {
		readContract: (async (request: ReadContractRequest) => {
			const handler = handlers[String(request.functionName)]
			if (handler === undefined) throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			return await handler(request)
		}) as ReadClient['readContract'],
	}
}

function createBookProps(truthAuctionReadClient: Pick<ReadClient, 'readContract'>, overrides: Partial<BookProps> = {}): BookProps {
	return {
		accountAddress: walletAddress,
		enteredBidTick: undefined,
		forkAuctionResultHash: undefined,
		selectedStage: 'auction',
		shouldShowTruthAuctionVisualization: true,
		truthAuctionAddress,
		truthAuctionClearingTick: undefined,
		truthAuctionReadClient,
		...overrides,
	}
}

describe('truth auction hooks', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	async function renderHook<Props extends object, State>(useHook: (props: Props) => State, initialProps: Props) {
		const hook = await renderHookWithProps(useHook, initialProps)
		cleanupRenderedComponent = hook.cleanup
		return hook
	}

	async function renderSettlementHook(overrides: Partial<SettlementProps>) {
		const claimCalls: ClaimCall[] = []
		const refundCalls: RefundCall[] = []
		const hook = await renderHook(useTruthAuctionSettlementActionState, {
			forkAuctionActiveAction: 'claimAuctionProceeds',
			accountAddress: walletAddress,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			onClaimAuctionProceeds: (pool, claimBids, refundBids) => {
				claimCalls.push({ claimBids, pool, refundBids })
			},
			onRefundLosingBids: (pool, bids) => {
				refundCalls.push({ bids, pool })
			},
			selectedAuctionPoolAddress: poolAddress,
			selectedStage: 'settlement',
			settlementBidRows: [],
			truthAuctionFinalized: true,
			...overrides,
		})
		return { ...hook, claimCalls, refundCalls }
	}

	test('increments pagination counts and resets them when auction context changes', async () => {
		const hook = await renderHook(useTruthAuctionPaginationState, { accountAddress: walletAddress, truthAuctionAddress })
		const pageCounts = () => [hook.state().loadedTickPageCount, hook.state().loadedViewerBidPageCount, hook.state().loadedAuctionBidPageCount]

		expect(pageCounts()).toEqual([1, 1, 1])

		await act(() => {
			hook.state().loadNextTickPage()
			hook.state().loadNextViewerBidPage()
			hook.state().loadNextAuctionBidPage()
		})

		expect(pageCounts()).toEqual([2, 2, 2])

		await hook.setProps({ truthAuctionAddress: otherTruthAuctionAddress })

		expect(pageCounts()).toEqual([1, 1, 1])
	})

	test('hides bid-book data synchronously when the auction address changes', async () => {
		let reads = 0
		const nextTickCount = createDeferred<bigint>()
		const countRead = (handler: (request: ReadContractRequest) => unknown) => (request: ReadContractRequest) => {
			reads++
			return handler(request)
		}
		const readClient = createBookReadClient({
			activeTickCount: countRead(async request => (request.address === otherTruthAuctionAddress ? await nextTickCount.promise : 1n)),
			getActiveTickPage: countRead(() => [{ active: true, currentTotalBidAttoEth: 2n, price: 3n, submissionCount: 0n, tick: 4n }]),
			getBidderBidCount: countRead(() => 1n),
			getBidderBidPage: countRead(() => [createBid({ bidIndex: 0n, tick: 4n })]),
			getBidCountAtTick: countRead(() => 0n),
			getBidPageAtTick: countRead(() => []),
		})
		const hook = await renderHook(useTruthAuctionBookData, createBookProps(readClient))
		await waitFor(() => {
			expect(hook.state().truthAuctionBookData.tickSummaries).toHaveLength(1)
			expect(hook.state().truthAuctionBookData.viewerBids).toHaveLength(1)
		})

		await act(async () => {
			await Bun.sleep(20)
		})
		const loadedReads = reads
		for (const enteredBidTick of [4n, 5n, 6n]) {
			await act(async () => {
				hook.renderProps({ enteredBidTick })
				await Bun.sleep(20)
			})
		}
		expect(reads).toBe(loadedReads)

		await hook.setProps({ truthAuctionAddress: otherTruthAuctionAddress })

		expect(hook.state().truthAuctionBookData.tickSummaries).toEqual([])
		expect(hook.state().truthAuctionBookData.viewerBids).toEqual([])
		expect(hook.state().aggregatedAuctionBids).toEqual([])
		nextTickCount.resolve(0n)
	})

	test('isolates wallet bid errors from public auction levels', async () => {
		let activeTickCountCalls = 0
		let bidderBidCountCalls = 0
		const viewerRetryResult = createDeferred<bigint>()
		const readClient = createBookReadClient({
			activeTickCount: () => {
				activeTickCountCalls += 1
				return 0n
			},
			getActiveTickPage: () => [],
			getBidderBidCount: async () => {
				bidderBidCountCalls += 1
				if (bidderBidCountCalls === 1) throw new Error('Wallet bid RPC unavailable')
				return await viewerRetryResult.promise
			},
			getBidderBidPage: () => [],
		})
		const hook = await renderHook(useTruthAuctionBookData, createBookProps(readClient))
		await waitFor(() => {
			expect(hook.state().viewerTruthAuctionBidsError).toBe('Failed to load your truth auction bids. Reason: Wallet bid RPC unavailable')
		})
		expect(hook.state().truthAuctionBookError).toBeUndefined()
		expect(hook.state().hasLoadedTruthAuctionBook).toBe(true)
		await act(() => {
			hook.state().retryViewerTruthAuctionBids()
		})
		await waitFor(() => {
			expect(bidderBidCountCalls).toBe(2)
		})
		expect(activeTickCountCalls).toBe(1)
		expect(hook.state().loadingTruthAuctionBook).toBe(false)
		expect(hook.state().loadingViewerTruthAuctionBids).toBe(true)
		expect(hook.state().retryingViewerTruthAuctionBids).toBe(true)
	})

	test('isolates public bid aggregation errors from wallet bids', async () => {
		let activeTickCountCalls = 0
		let bidCountAtTickCalls = 0
		let bidderBidCountCalls = 0
		const publicRetryResult = createDeferred<bigint>()
		const readClient = createBookReadClient({
			activeTickCount: () => {
				activeTickCountCalls += 1
				return 1n
			},
			getActiveTickPage: () => [{ active: true, currentTotalBidAttoEth: 2n, price: 3n, submissionCount: 1n, tick: 4n }],
			getBidderBidCount: () => {
				bidderBidCountCalls += 1
				return 0n
			},
			getBidderBidPage: () => [],
			getBidCountAtTick: async () => {
				bidCountAtTickCalls += 1
				if (bidCountAtTickCalls === 1) throw new Error('Public bids RPC unavailable')
				return await publicRetryResult.promise
			},
		})
		const hook = await renderHook(useTruthAuctionBookData, createBookProps(readClient))
		await waitFor(() => {
			expect(hook.state().truthAuctionBookError).toBe('Failed to load truth auction bids across the visible price levels. Reason: Public bids RPC unavailable')
		})
		expect(hook.state().viewerTruthAuctionBidsError).toBeUndefined()
		expect(hook.state().hasLoadedViewerTruthAuctionBids).toBe(true)
		await act(() => {
			hook.state().retryPublicTruthAuctionBook()
		})
		await waitFor(() => {
			expect(bidCountAtTickCalls).toBe(2)
		})
		expect(activeTickCountCalls).toBe(1)
		expect(bidderBidCountCalls).toBe(1)
		expect(hook.state().loadingTruthAuctionBook).toBe(false)
		expect(hook.state().loadingAggregatedAuctionBids).toBe(true)
		expect(hook.state().loadingViewerTruthAuctionBids).toBe(false)
		expect(hook.state().retryingPublicTruthAuctionBook).toBe(true)
	})

	test('clears a public bid-book error after retry succeeds', async () => {
		let activeTickCountCalls = 0
		const retryResult = createDeferred<bigint>()
		const readClient = createBookReadClient({
			activeTickCount: async () => {
				activeTickCountCalls += 1
				if (activeTickCountCalls === 1) throw new Error('RPC unavailable')
				return await retryResult.promise
			},
			getActiveTickPage: () => [],
		})
		const hook = await renderHook(useTruthAuctionBookData, createBookProps(readClient, { accountAddress: undefined }))
		await waitFor(() => {
			expect(hook.state().truthAuctionBookError).toBe('Failed to load truth auction price levels. Reason: RPC unavailable')
		})
		await act(() => {
			hook.state().retryPublicTruthAuctionBook()
		})
		await waitFor(() => {
			expect(activeTickCountCalls).toBe(2)
		})
		await act(async () => {
			retryResult.resolve(0n)
			await retryResult.promise
		})
		await waitFor(() => {
			expect(hook.state().truthAuctionBookError).toBeUndefined()
		})
	})

	test('preserves public recovery and hides the previous viewer error when the account changes', async () => {
		let activeTickCountCalls = 0
		const nextViewerResult = createDeferred<bigint>()
		const readClient = createBookReadClient({
			activeTickCount: () => {
				activeTickCountCalls += 1
				throw new Error('Public RPC unavailable')
			},
			getBidderBidCount: async request => {
				if (request.args?.[0] === walletAddress) throw new Error('Old wallet RPC unavailable')
				return await nextViewerResult.promise
			},
			getBidderBidPage: () => [],
		})
		const hook = await renderHook(useTruthAuctionBookData, createBookProps(readClient))
		await waitFor(() => {
			expect(hook.state().truthAuctionBookError).toBe('Failed to load truth auction price levels. Reason: Public RPC unavailable')
			expect(hook.state().viewerTruthAuctionBidsError).toBe('Failed to load your truth auction bids. Reason: Old wallet RPC unavailable')
		})

		await hook.setProps({ accountAddress: otherWalletAddress })

		expect(activeTickCountCalls).toBe(1)
		expect(hook.state().truthAuctionBookError).toBe('Failed to load truth auction price levels. Reason: Public RPC unavailable')
		expect(hook.state().viewerTruthAuctionBidsError).toBeUndefined()
		expect(hook.state().loadingViewerTruthAuctionBids).toBe(true)
	})

	test.each<RefundRoutingCase>([
		{
			expectedClaimCalls: [],
			expectedRefundCalls: [{ bids: [{ bidIndex: 2n, tick: 8n }], pool: poolAddress }],
			finalized: false,
			name: 'routes refund-only settlement through refund action',
			resultAction: 'refundLosingBids',
			submit: (state, refundKey) => {
				state.setSelectedSettlementBidKeys([refundKey])
			},
			submitSelection: true,
		},
		{
			expectedClaimCalls: [{ claimBids: [], pool: poolAddress, refundBids: [{ bidIndex: 2n, tick: 8n }] }],
			expectedRefundCalls: [],
			finalized: true,
			name: 'routes finalized refund-only settlement through the finalized settlement action',
			resultAction: 'claimAuctionProceeds',
			submit: (state, refundKey) => {
				state.setSelectedSettlementBidKeys([refundKey])
			},
			submitSelection: true,
		},
		{
			expectedClaimCalls: [{ claimBids: [], pool: poolAddress, refundBids: [{ bidIndex: 2n, tick: 8n }] }],
			expectedRefundCalls: [],
			finalized: true,
			name: 'routes finalized refund helper submissions through the finalized settlement action',
			resultAction: 'claimAuctionProceeds',
			submit: (state, refundKey) => {
				state.submitRefundBidsByKeys([refundKey])
			},
			submitSelection: false,
		},
	])('$name and reconciles the result', async ({ expectedClaimCalls, expectedRefundCalls, finalized, resultAction, submit, submitSelection }) => {
		const refundRow = createSettlementRow({ bidIndex: 2n, disposition: refundDisposition, tick: 8n })
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const hook = await renderSettlementHook({ settlementBidRows: [refundRow], truthAuctionFinalized: finalized })

		await act(() => {
			submit(hook.state(), refundKey)
		})
		if (submitSelection) {
			await act(() => {
				hook.state().submitSelectedSettlementBids()
			})
		}

		expect(hook.claimCalls).toEqual(expectedClaimCalls)
		expect(hook.refundCalls).toEqual(expectedRefundCalls)
		expect(hook.state().isSettleSelectedBidsInProgress).toBe(true)

		await hook.setProps({ forkAuctionResult: createForkAuctionResult(resultAction, '0xbbbb') })

		expect(hook.state().isSettleSelectedBidsInProgress).toBe(false)
		expect(hook.state().selectedSettlementBidKeys).toEqual([])
		expect(hook.state().settlementBidResultByKey[refundKey]).toBe('refunded')
		expect(hook.state().settlementBidResultRefreshToken).toBe(1)
	})

	test('settles mixed claim and refund selections through the combined claim action', async () => {
		const claimRow = createSettlementRow({ bidIndex: 1n, disposition: claimDisposition, tick: 11n })
		const refundRow = createSettlementRow({ bidIndex: 2n, disposition: refundDisposition, tick: 8n })
		const claimKey = getTruthAuctionSettlementBidKey(claimRow.bid)
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const hook = await renderSettlementHook({ settlementBidRows: [claimRow, refundRow] })

		await act(() => {
			hook.state().setSelectedSettlementBidKeys([claimKey, refundKey])
		})
		await act(() => {
			hook.state().submitSelectedSettlementBids()
		})

		expect(hook.claimCalls).toEqual([
			{
				claimBids: [{ bidIndex: 1n, tick: 11n }],
				pool: poolAddress,
				refundBids: [{ bidIndex: 2n, tick: 8n }],
			},
		])

		await hook.setProps({ forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xcccc') })

		expect(hook.state().settlementBidResultByKey[claimKey]).toBe('claimed')
		expect(hook.state().settlementBidResultByKey[refundKey]).toBe('refunded')
		expect(hook.state().settlementBidResultRefreshToken).toBe(1)
	})

	test('ignores a stale matching transaction result when a new settlement is submitted', async () => {
		const claimRow = createSettlementRow({ bidIndex: 1n, disposition: claimDisposition, tick: 11n })
		const claimKey = getTruthAuctionSettlementBidKey(claimRow.bid)
		const hook = await renderSettlementHook({
			forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xdddd'),
			settlementBidRows: [claimRow],
		})

		await act(() => {
			hook.state().setSelectedSettlementBidKeys([claimKey])
		})
		await act(() => {
			hook.state().submitSelectedSettlementBids()
		})

		expect(hook.state().isSettleSelectedBidsInProgress).toBe(true)
		expect(hook.state().settlementBidResultByKey[claimKey]).toBeUndefined()

		await hook.setProps({ forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xeeee') })

		expect(hook.state().isSettleSelectedBidsInProgress).toBe(false)
		expect(hook.state().settlementBidResultByKey[claimKey]).toBe('claimed')
	})

	test('prunes settlement selections when available rows or workflow stage changes', async () => {
		const claimRow = createSettlementRow({ bidIndex: 1n, disposition: claimDisposition, tick: 11n })
		const refundRow = createSettlementRow({ bidIndex: 2n, disposition: refundDisposition, tick: 8n })
		const claimKey = getTruthAuctionSettlementBidKey(claimRow.bid)
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const hook = await renderSettlementHook({ settlementBidRows: [claimRow, refundRow] })

		await act(() => {
			hook.state().setSelectedSettlementBidKeys([claimKey, refundKey])
		})
		await hook.setProps({ settlementBidRows: [claimRow] })

		expect(hook.state().selectedSettlementBidKeys).toEqual([claimKey])

		await hook.setProps({ selectedStage: 'migration' })

		expect(hook.state().selectedSettlementBidKeys).toEqual([])
	})
})
