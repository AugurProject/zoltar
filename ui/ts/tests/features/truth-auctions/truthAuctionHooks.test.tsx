/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/shared/ethereum'
import { useTruthAuctionPaginationState } from '../../../features/truth-auctions/hooks/useTruthAuctionPaginationState.js'
import { useTruthAuctionBookData } from '../../../features/truth-auctions/hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../../../features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js'
import type { TruthAuctionBidDisposition } from '../../../features/truth-auctions/lib/truthAuctionBook.js'
import { getTruthAuctionSettlementBidKey, type TruthAuctionSettlementBidRow } from '../../../features/truth-auctions/lib/truthAuctionSettlement.js'
import type { ForkAuctionActionResult, ReadClient, TruthAuctionBidView } from '../../../types/contracts.js'
import type { SettlementSelectedBid } from '../../../features/types.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { waitFor } from '../../testUtils/queries.js'

const walletAddress: Address = '0x0000000000000000000000000000000000000001'
const otherWalletAddress: Address = '0x0000000000000000000000000000000000000002'
const poolAddress: Address = '0x0000000000000000000000000000000000000100'
const truthAuctionAddress: Address = '0x0000000000000000000000000000000000000200'
const otherTruthAuctionAddress: Address = '0x0000000000000000000000000000000000000201'

type HarnessSetter<T> = (nextState: T | ((currentState: T) => T)) => void
type PaginationState = ReturnType<typeof useTruthAuctionPaginationState>
type PaginationProps = Parameters<typeof useTruthAuctionPaginationState>[0]
type SettlementState = ReturnType<typeof useTruthAuctionSettlementActionState>
type SettlementProps = Parameters<typeof useTruthAuctionSettlementActionState>[0]
type BookState = ReturnType<typeof useTruthAuctionBookData>
type BookProps = Parameters<typeof useTruthAuctionBookData>[0]

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

function requireHookState<T>(state: T | undefined) {
	if (state === undefined) throw new Error('Hook state is unavailable')
	return state
}

function requireHarnessSetter<T>(setter: HarnessSetter<T> | undefined) {
	if (setter === undefined) throw new Error('Harness setter is unavailable')
	return setter
}

function createBid({ bidIndex, tick }: { bidIndex: bigint; tick: bigint }): TruthAuctionBidView {
	return {
		activeCumulativeEthBeforeBid: 0n,
		bidIndex,
		bidder: walletAddress,
		claimed: false,
		cumulativeEth: 1n,
		ethAmount: 1n,
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

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

describe('truth auction hooks', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('increments pagination counts and resets them when auction context changes', async () => {
		let hookState: PaginationState | undefined
		let setHarnessProps: HarnessSetter<PaginationProps> | undefined
		const initialProps: PaginationProps = {
			accountAddress: walletAddress,
			truthAuctionAddress,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionPaginationState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		expect(requireHookState(hookState).loadedTickPageCount).toBe(1)
		expect(requireHookState(hookState).loadedViewerBidPageCount).toBe(1)
		expect(requireHookState(hookState).loadedAuctionBidPageCount).toBe(1)

		await act(() => {
			requireHookState(hookState).loadNextTickPage()
			requireHookState(hookState).loadNextViewerBidPage()
			requireHookState(hookState).loadNextAuctionBidPage()
		})

		expect(requireHookState(hookState).loadedTickPageCount).toBe(2)
		expect(requireHookState(hookState).loadedViewerBidPageCount).toBe(2)
		expect(requireHookState(hookState).loadedAuctionBidPageCount).toBe(2)

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				truthAuctionAddress: otherTruthAuctionAddress,
			}))
		})

		expect(requireHookState(hookState).loadedTickPageCount).toBe(1)
		expect(requireHookState(hookState).loadedViewerBidPageCount).toBe(1)
		expect(requireHookState(hookState).loadedAuctionBidPageCount).toBe(1)
	})

	test('hides bid-book data synchronously when the auction address changes', async () => {
		let hookState: BookState | undefined
		let setHarnessProps: HarnessSetter<BookProps> | undefined
		const nextTickCount = createDeferred<bigint>()
		const readClient: Pick<ReadClient, 'readContract'> = {
			readContract: (async request => {
				if (request.functionName === 'activeTickCount') {
					if (request.address === otherTruthAuctionAddress) return await nextTickCount.promise
					return 1n
				}
				if (request.functionName === 'getActiveTickPage') return [{ active: true, currentTotalEth: 2n, price: 3n, submissionCount: 0n, tick: 4n }]
				if (request.functionName === 'getBidderBidCount') return 1n
				if (request.functionName === 'getBidderBidPage') return [createBid({ bidIndex: 0n, tick: 4n })]
				if (request.functionName === 'getBidCountAtTick') return 0n
				if (request.functionName === 'getBidPageAtTick') return []
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}
		const initialProps: BookProps = {
			accountAddress: walletAddress,
			enteredBidTick: undefined,
			forkAuctionResultHash: undefined,
			selectedStage: 'auction',
			shouldShowTruthAuctionVisualization: true,
			truthAuctionAddress,
			truthAuctionClearingTick: undefined,
			truthAuctionReadClient: readClient,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionBookData(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		await waitFor(() => {
			expect(requireHookState(hookState).truthAuctionBookData.tickSummaries).toHaveLength(1)
			expect(requireHookState(hookState).truthAuctionBookData.viewerBids).toHaveLength(1)
		})

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				truthAuctionAddress: otherTruthAuctionAddress,
			}))
		})

		expect(requireHookState(hookState).truthAuctionBookData.tickSummaries).toEqual([])
		expect(requireHookState(hookState).truthAuctionBookData.viewerBids).toEqual([])
		expect(requireHookState(hookState).aggregatedAuctionBids).toEqual([])
		nextTickCount.resolve(0n)
	})

	test('isolates wallet bid errors from public auction levels', async () => {
		let hookState: BookState | undefined
		let activeTickCountCalls = 0
		let bidderBidCountCalls = 0
		const viewerRetryResult = createDeferred<bigint>()
		const readClient: Pick<ReadClient, 'readContract'> = {
			readContract: (async request => {
				if (request.functionName === 'activeTickCount') {
					activeTickCountCalls += 1
					return 0n
				}
				if (request.functionName === 'getActiveTickPage') return []
				if (request.functionName === 'getBidderBidCount') {
					bidderBidCountCalls += 1
					if (bidderBidCountCalls === 1) throw new Error('Wallet bid RPC unavailable')
					return await viewerRetryResult.promise
				}
				if (request.functionName === 'getBidderBidPage') return []
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}

		function Harness() {
			hookState = useTruthAuctionBookData({
				accountAddress: walletAddress,
				enteredBidTick: undefined,
				forkAuctionResultHash: undefined,
				selectedStage: 'auction',
				shouldShowTruthAuctionVisualization: true,
				truthAuctionAddress,
				truthAuctionClearingTick: undefined,
				truthAuctionReadClient: readClient,
			})
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		await waitFor(() => {
			expect(requireHookState(hookState).viewerTruthAuctionBidsError).toBe('Failed to load your truth auction bids. Reason: Wallet bid RPC unavailable')
		})
		expect(requireHookState(hookState).truthAuctionBookError).toBeUndefined()
		expect(requireHookState(hookState).hasLoadedTruthAuctionBook).toBe(true)
		await act(() => {
			requireHookState(hookState).retryViewerTruthAuctionBids()
		})
		await waitFor(() => {
			expect(bidderBidCountCalls).toBe(2)
		})
		expect(activeTickCountCalls).toBe(1)
		expect(requireHookState(hookState).loadingTruthAuctionBook).toBe(false)
		expect(requireHookState(hookState).loadingViewerTruthAuctionBids).toBe(true)
		expect(requireHookState(hookState).retryingViewerTruthAuctionBids).toBe(true)
	})

	test('isolates public bid aggregation errors from wallet bids', async () => {
		let hookState: BookState | undefined
		let activeTickCountCalls = 0
		let bidCountAtTickCalls = 0
		let bidderBidCountCalls = 0
		const publicRetryResult = createDeferred<bigint>()
		const readClient: Pick<ReadClient, 'readContract'> = {
			readContract: (async request => {
				if (request.functionName === 'activeTickCount') {
					activeTickCountCalls += 1
					return 1n
				}
				if (request.functionName === 'getActiveTickPage') return [{ active: true, currentTotalEth: 2n, price: 3n, submissionCount: 1n, tick: 4n }]
				if (request.functionName === 'getBidderBidCount') {
					bidderBidCountCalls += 1
					return 0n
				}
				if (request.functionName === 'getBidderBidPage') return []
				if (request.functionName === 'getBidCountAtTick') {
					bidCountAtTickCalls += 1
					if (bidCountAtTickCalls === 1) throw new Error('Public bids RPC unavailable')
					return await publicRetryResult.promise
				}
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}

		function Harness() {
			hookState = useTruthAuctionBookData({
				accountAddress: walletAddress,
				enteredBidTick: undefined,
				forkAuctionResultHash: undefined,
				selectedStage: 'auction',
				shouldShowTruthAuctionVisualization: true,
				truthAuctionAddress,
				truthAuctionClearingTick: undefined,
				truthAuctionReadClient: readClient,
			})
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		await waitFor(() => {
			expect(requireHookState(hookState).truthAuctionBookError).toBe('Failed to load truth auction bids across the visible price levels. Reason: Public bids RPC unavailable')
		})
		expect(requireHookState(hookState).viewerTruthAuctionBidsError).toBeUndefined()
		expect(requireHookState(hookState).hasLoadedViewerTruthAuctionBids).toBe(true)
		await act(() => {
			requireHookState(hookState).retryPublicTruthAuctionBook()
		})
		await waitFor(() => {
			expect(bidCountAtTickCalls).toBe(2)
		})
		expect(activeTickCountCalls).toBe(1)
		expect(bidderBidCountCalls).toBe(1)
		expect(requireHookState(hookState).loadingTruthAuctionBook).toBe(false)
		expect(requireHookState(hookState).loadingAggregatedAuctionBids).toBe(true)
		expect(requireHookState(hookState).loadingViewerTruthAuctionBids).toBe(false)
		expect(requireHookState(hookState).retryingPublicTruthAuctionBook).toBe(true)
	})

	test('clears a public bid-book error after retry succeeds', async () => {
		let hookState: BookState | undefined
		let activeTickCountCalls = 0
		const retryResult = createDeferred<bigint>()
		const readClient: Pick<ReadClient, 'readContract'> = {
			readContract: (async request => {
				if (request.functionName === 'activeTickCount') {
					activeTickCountCalls += 1
					if (activeTickCountCalls === 1) throw new Error('RPC unavailable')
					return await retryResult.promise
				}
				if (request.functionName === 'getActiveTickPage') return []
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}

		function Harness() {
			hookState = useTruthAuctionBookData({
				accountAddress: undefined,
				enteredBidTick: undefined,
				forkAuctionResultHash: undefined,
				selectedStage: 'auction',
				shouldShowTruthAuctionVisualization: true,
				truthAuctionAddress,
				truthAuctionClearingTick: undefined,
				truthAuctionReadClient: readClient,
			})
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		await waitFor(() => {
			expect(requireHookState(hookState).truthAuctionBookError).toBe('Failed to load truth auction price levels. Reason: RPC unavailable')
		})
		await act(() => {
			requireHookState(hookState).retryPublicTruthAuctionBook()
		})
		await waitFor(() => {
			expect(activeTickCountCalls).toBe(2)
		})
		await act(async () => {
			retryResult.resolve(0n)
			await retryResult.promise
		})
		await waitFor(() => {
			expect(requireHookState(hookState).truthAuctionBookError).toBeUndefined()
		})
	})

	test('preserves public recovery and hides the previous viewer error when the account changes', async () => {
		let hookState: BookState | undefined
		let setHarnessProps: HarnessSetter<BookProps> | undefined
		let activeTickCountCalls = 0
		const nextViewerResult = createDeferred<bigint>()
		const readClient: Pick<ReadClient, 'readContract'> = {
			readContract: (async request => {
				if (request.functionName === 'activeTickCount') {
					activeTickCountCalls += 1
					throw new Error('Public RPC unavailable')
				}
				if (request.functionName === 'getBidderBidCount') {
					if (request.args?.[0] === walletAddress) throw new Error('Old wallet RPC unavailable')
					return await nextViewerResult.promise
				}
				if (request.functionName === 'getBidderBidPage') return []
				throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}) as ReadClient['readContract'],
		}
		const initialProps: BookProps = {
			accountAddress: walletAddress,
			enteredBidTick: undefined,
			forkAuctionResultHash: undefined,
			selectedStage: 'auction',
			shouldShowTruthAuctionVisualization: true,
			truthAuctionAddress,
			truthAuctionClearingTick: undefined,
			truthAuctionReadClient: readClient,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionBookData(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup
		await waitFor(() => {
			expect(requireHookState(hookState).truthAuctionBookError).toBe('Failed to load truth auction price levels. Reason: Public RPC unavailable')
			expect(requireHookState(hookState).viewerTruthAuctionBidsError).toBe('Failed to load your truth auction bids. Reason: Old wallet RPC unavailable')
		})

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				accountAddress: otherWalletAddress,
			}))
		})

		expect(activeTickCountCalls).toBe(1)
		expect(requireHookState(hookState).truthAuctionBookError).toBe('Failed to load truth auction price levels. Reason: Public RPC unavailable')
		expect(requireHookState(hookState).viewerTruthAuctionBidsError).toBeUndefined()
		expect(requireHookState(hookState).loadingViewerTruthAuctionBids).toBe(true)
	})

	test('routes refund-only settlement through refund action and reconciles the result', async () => {
		const refundRow = createSettlementRow({ bidIndex: 2n, disposition: refundDisposition, tick: 8n })
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const claimCalls: Array<{ bids: readonly SettlementSelectedBid[] | undefined; pool: Address | undefined }> = []
		const refundCalls: Array<{ bids: readonly SettlementSelectedBid[] | undefined; pool: Address | undefined }> = []
		let hookState: SettlementState | undefined
		let setHarnessProps: HarnessSetter<SettlementProps> | undefined
		const initialProps: SettlementProps = {
			accountAddress: walletAddress,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			onClaimAuctionProceeds: (pool, claimBids) => {
				claimCalls.push({ bids: claimBids, pool })
			},
			onRefundLosingBids: (pool, bids) => {
				refundCalls.push({ bids, pool })
			},
			selectedAuctionPoolAddress: poolAddress,
			selectedStage: 'settlement',
			settlementBidRows: [refundRow],
			truthAuctionFinalized: false,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionSettlementActionState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireHookState(hookState).setSelectedSettlementBidKeys([refundKey])
		})
		await act(() => {
			requireHookState(hookState).submitSelectedSettlementBids()
		})

		expect(claimCalls).toHaveLength(0)
		expect(refundCalls).toEqual([{ bids: [{ bidIndex: 2n, tick: 8n }], pool: poolAddress }])
		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(true)

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				forkAuctionResult: createForkAuctionResult('refundLosingBids', '0xbbbb'),
			}))
		})

		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(false)
		expect(requireHookState(hookState).selectedSettlementBidKeys).toEqual([])
		expect(requireHookState(hookState).settlementBidResultByKey[refundKey]).toBe('refunded')
		expect(requireHookState(hookState).settlementBidResultRefreshToken).toBe(1)
	})

	test('settles mixed claim and refund selections through the combined claim action', async () => {
		const claimRow = createSettlementRow({ bidIndex: 1n, disposition: claimDisposition, tick: 11n })
		const refundRow = createSettlementRow({ bidIndex: 2n, disposition: refundDisposition, tick: 8n })
		const claimKey = getTruthAuctionSettlementBidKey(claimRow.bid)
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const claimCalls: Array<{ claimBids: readonly SettlementSelectedBid[] | undefined; pool: Address | undefined; refundBids: readonly SettlementSelectedBid[] | undefined }> = []
		let hookState: SettlementState | undefined
		let setHarnessProps: HarnessSetter<SettlementProps> | undefined
		const initialProps: SettlementProps = {
			accountAddress: walletAddress,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			onClaimAuctionProceeds: (pool, claimBids, refundBids) => {
				claimCalls.push({ claimBids, pool, refundBids })
			},
			onRefundLosingBids: () => undefined,
			selectedAuctionPoolAddress: poolAddress,
			selectedStage: 'settlement',
			settlementBidRows: [claimRow, refundRow],
			truthAuctionFinalized: true,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionSettlementActionState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireHookState(hookState).setSelectedSettlementBidKeys([claimKey, refundKey])
		})
		await act(() => {
			requireHookState(hookState).submitSelectedSettlementBids()
		})

		expect(claimCalls).toEqual([
			{
				claimBids: [{ bidIndex: 1n, tick: 11n }],
				pool: poolAddress,
				refundBids: [{ bidIndex: 2n, tick: 8n }],
			},
		])

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xcccc'),
			}))
		})

		expect(requireHookState(hookState).settlementBidResultByKey[claimKey]).toBe('claimed')
		expect(requireHookState(hookState).settlementBidResultByKey[refundKey]).toBe('refunded')
		expect(requireHookState(hookState).settlementBidResultRefreshToken).toBe(1)
	})

	test('ignores a stale matching transaction result when a new settlement is submitted', async () => {
		const claimRow = createSettlementRow({ bidIndex: 1n, disposition: claimDisposition, tick: 11n })
		const claimKey = getTruthAuctionSettlementBidKey(claimRow.bid)
		let hookState: SettlementState | undefined
		let setHarnessProps: HarnessSetter<SettlementProps> | undefined
		const initialProps: SettlementProps = {
			accountAddress: walletAddress,
			forkAuctionError: undefined,
			forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xdddd'),
			onClaimAuctionProceeds: () => undefined,
			onRefundLosingBids: () => undefined,
			selectedAuctionPoolAddress: poolAddress,
			selectedStage: 'settlement',
			settlementBidRows: [claimRow],
			truthAuctionFinalized: true,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionSettlementActionState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireHookState(hookState).setSelectedSettlementBidKeys([claimKey])
		})
		await act(() => {
			requireHookState(hookState).submitSelectedSettlementBids()
		})

		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(true)
		expect(requireHookState(hookState).settlementBidResultByKey[claimKey]).toBeUndefined()

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xeeee'),
			}))
		})

		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(false)
		expect(requireHookState(hookState).settlementBidResultByKey[claimKey]).toBe('claimed')
	})

	test('prunes settlement selections when available rows or workflow stage changes', async () => {
		const claimRow = createSettlementRow({ bidIndex: 1n, disposition: claimDisposition, tick: 11n })
		const refundRow = createSettlementRow({ bidIndex: 2n, disposition: refundDisposition, tick: 8n })
		const claimKey = getTruthAuctionSettlementBidKey(claimRow.bid)
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		let hookState: SettlementState | undefined
		let setHarnessProps: HarnessSetter<SettlementProps> | undefined
		const initialProps: SettlementProps = {
			accountAddress: walletAddress,
			forkAuctionError: undefined,
			forkAuctionResult: undefined,
			onClaimAuctionProceeds: () => undefined,
			onRefundLosingBids: () => undefined,
			selectedAuctionPoolAddress: poolAddress,
			selectedStage: 'settlement',
			settlementBidRows: [claimRow, refundRow],
			truthAuctionFinalized: true,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionSettlementActionState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireHookState(hookState).setSelectedSettlementBidKeys([claimKey, refundKey])
		})
		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				settlementBidRows: [claimRow],
			}))
		})

		expect(requireHookState(hookState).selectedSettlementBidKeys).toEqual([claimKey])

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				selectedStage: 'migration',
			}))
		})

		expect(requireHookState(hookState).selectedSettlementBidKeys).toEqual([])
	})

	test('routes finalized refund-only settlement through the finalized settlement action and reconciles the result', async () => {
		const refundRow = createSettlementRow({ bidIndex: 4n, disposition: refundDisposition, tick: 7n })
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const claimCalls: Array<{
			claimBids: readonly SettlementSelectedBid[] | undefined
			pool: Address | undefined
			refundBids: readonly SettlementSelectedBid[] | undefined
		}> = []
		const refundCalls: Array<{ bids: readonly SettlementSelectedBid[] | undefined; pool: Address | undefined }> = []
		let hookState: SettlementState | undefined
		let setHarnessProps: HarnessSetter<SettlementProps> | undefined
		const initialProps: SettlementProps = {
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
			settlementBidRows: [refundRow],
			truthAuctionFinalized: true,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionSettlementActionState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireHookState(hookState).setSelectedSettlementBidKeys([refundKey])
		})
		await act(() => {
			requireHookState(hookState).submitSelectedSettlementBids()
		})

		expect(claimCalls).toEqual([
			{
				claimBids: [],
				pool: poolAddress,
				refundBids: [{ bidIndex: 4n, tick: 7n }],
			},
		])
		expect(refundCalls).toHaveLength(0)
		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(true)

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0xffff'),
			}))
		})

		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(false)
		expect(requireHookState(hookState).selectedSettlementBidKeys).toEqual([])
		expect(requireHookState(hookState).settlementBidResultByKey[refundKey]).toBe('refunded')
		expect(requireHookState(hookState).settlementBidResultRefreshToken).toBe(1)
	})

	test('routes finalized refund helper submissions through the finalized settlement action', async () => {
		const refundRow = createSettlementRow({ bidIndex: 5n, disposition: refundDisposition, tick: 6n })
		const refundKey = getTruthAuctionSettlementBidKey(refundRow.bid)
		const claimCalls: Array<{
			claimBids: readonly SettlementSelectedBid[] | undefined
			pool: Address | undefined
			refundBids: readonly SettlementSelectedBid[] | undefined
		}> = []
		const refundCalls: Array<{ bids: readonly SettlementSelectedBid[] | undefined; pool: Address | undefined }> = []
		let hookState: SettlementState | undefined
		let setHarnessProps: HarnessSetter<SettlementProps> | undefined
		const initialProps: SettlementProps = {
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
			settlementBidRows: [refundRow],
			truthAuctionFinalized: true,
		}

		function Harness() {
			const [props, setProps] = useState(initialProps)
			setHarnessProps = setProps
			hookState = useTruthAuctionSettlementActionState(props)
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = rendered.cleanup

		await act(() => {
			requireHookState(hookState).submitRefundBidsByKeys([refundKey])
		})

		expect(claimCalls).toEqual([
			{
				claimBids: [],
				pool: poolAddress,
				refundBids: [{ bidIndex: 5n, tick: 6n }],
			},
		])
		expect(refundCalls).toHaveLength(0)
		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(true)

		await act(() => {
			requireHarnessSetter(setHarnessProps)(currentProps => ({
				...currentProps,
				forkAuctionResult: createForkAuctionResult('claimAuctionProceeds', '0x1111'),
			}))
		})

		expect(requireHookState(hookState).isSettleSelectedBidsInProgress).toBe(false)
		expect(requireHookState(hookState).settlementBidResultByKey[refundKey]).toBe('refunded')
		expect(requireHookState(hookState).settlementBidResultRefreshToken).toBe(1)
	})
})
