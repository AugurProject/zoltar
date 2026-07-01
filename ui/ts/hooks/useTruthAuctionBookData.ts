import { useEffect, useState } from 'preact/hooks'
import { type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { loadTruthAuctionActiveTickPage, loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage } from '../contracts.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { sortTruthAuctionBidsByPriority, sortTruthAuctionTickSummariesDescending } from '../lib/truthAuctionBook.js'
import type { ForkWorkflowSelectionStage } from '../lib/securityPoolWorkflow.js'
import type { ReadClient, TruthAuctionBidView, TruthAuctionTickSummary } from '../types/contracts.js'
import { useTruthAuctionPaginationState } from './useTruthAuctionPaginationState.js'

const TRUTH_AUCTION_TICK_PAGE_SIZE = 25
const TRUTH_AUCTION_BID_PAGE_SIZE = 25

type TruthAuctionBookData = {
	tickSummaries: TruthAuctionTickSummary[]
	tickCount: bigint
	viewerBids: TruthAuctionBidView[]
	viewerBidCount: bigint
}

type UseTruthAuctionBookDataParams = {
	accountAddress: Address | undefined
	enteredBidTick: bigint | undefined
	forkAuctionResultHash: string | undefined
	selectedStage: ForkWorkflowSelectionStage
	shouldShowTruthAuctionVisualization: boolean
	truthAuctionAddress: Address | undefined
	truthAuctionClearingTick: bigint | undefined
	truthAuctionReadClient: Pick<ReadClient, 'readContract'> | ReadClient | undefined
}

async function loadTruthAuctionActiveTickPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageCount: number) {
	const tickSummaries: TruthAuctionTickSummary[] = []
	let tickCount = 0n
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
		const page = await loadTruthAuctionActiveTickPage(client, truthAuctionAddress, pageIndex, TRUTH_AUCTION_TICK_PAGE_SIZE)
		tickCount = page.tickCount
		tickSummaries.push(...page.ticks)
		if (BigInt(tickSummaries.length) >= tickCount || page.ticks.length === 0) break
	}
	return {
		tickCount,
		tickSummaries,
	}
}

async function loadTruthAuctionTickBidPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint, pageCount: number) {
	const bids: TruthAuctionBidView[] = []
	let bidCount = 0n
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
		const page = await loadTruthAuctionTickBidPage(client, truthAuctionAddress, tick, pageIndex, TRUTH_AUCTION_BID_PAGE_SIZE)
		bidCount = page.bidCount
		bids.push(...page.bids)
		if (BigInt(bids.length) >= bidCount || page.bids.length === 0) break
	}
	return {
		bidCount,
		bids,
	}
}

async function loadTruthAuctionBidderBidPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, bidder: Address, pageCount: number) {
	const bids: TruthAuctionBidView[] = []
	let bidCount = 0n
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
		const page = await loadTruthAuctionBidderBidPage(client, truthAuctionAddress, bidder, pageIndex, TRUTH_AUCTION_BID_PAGE_SIZE)
		bidCount = page.bidCount
		bids.push(...page.bids)
		if (BigInt(bids.length) >= bidCount || page.bids.length === 0) break
	}
	return {
		bidCount,
		bids,
	}
}

async function loadAggregatedTruthAuctionBidPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tickSummaries: TruthAuctionTickSummary[], pageCount: number) {
	const uniqueTickSummaries = sortTruthAuctionTickSummariesDescending(Array.from(new Map(tickSummaries.map(tickSummary => [tickSummary.tick.toString(), tickSummary])).values()))
	const bidPages = await Promise.all(uniqueTickSummaries.map(async tickSummary => ({ bidData: await loadTruthAuctionTickBidPages(client, truthAuctionAddress, tickSummary.tick, pageCount), tickSummary })))
	const dedupedBids = new Map<string, TruthAuctionBidView>()
	for (const { bidData } of bidPages) {
		for (const bid of bidData.bids) {
			dedupedBids.set(`${bid.tick.toString()}:${bid.bidIndex.toString()}`, bid)
		}
	}
	return {
		bids: sortTruthAuctionBidsByPriority(Array.from(dedupedBids.values())),
		bidCountForLoadedTicks: uniqueTickSummaries.reduce((sum, tickSummary) => sum + tickSummary.submissionCount, 0n),
	}
}

export function useTruthAuctionBookData({ accountAddress, enteredBidTick, forkAuctionResultHash, selectedStage, shouldShowTruthAuctionVisualization, truthAuctionAddress, truthAuctionClearingTick, truthAuctionReadClient }: UseTruthAuctionBookDataParams) {
	const [truthAuctionBookData, setTruthAuctionBookData] = useState<TruthAuctionBookData>({
		tickSummaries: [],
		tickCount: 0n,
		viewerBids: [],
		viewerBidCount: 0n,
	})
	const [selectedBookTick, setSelectedBookTick] = useState<bigint | undefined>(undefined)
	const { loadedTickPageCount, loadedViewerBidPageCount, loadedAuctionBidPageCount, loadNextTickPage, loadNextViewerBidPage, loadNextAuctionBidPage } = useTruthAuctionPaginationState({
		accountAddress,
		truthAuctionAddress,
	})
	const [aggregatedAuctionBids, setAggregatedAuctionBids] = useState<TruthAuctionBidView[]>([])
	const [aggregatedAuctionBidCountForLoadedTicks, setAggregatedAuctionBidCountForLoadedTicks] = useState(0n)
	const [loadingTruthAuctionBook, setLoadingTruthAuctionBook] = useState(false)
	const [loadingAggregatedAuctionBids, setLoadingAggregatedAuctionBids] = useState(false)
	const [truthAuctionBookError, setTruthAuctionBookError] = useState<string | undefined>(undefined)
	const isTruthAuctionBookVisible = shouldShowTruthAuctionVisualization && truthAuctionAddress !== undefined && truthAuctionAddress !== zeroAddress && (selectedStage === 'auction' || selectedStage === 'settlement')
	const hasMoreTickSummaries = BigInt(truthAuctionBookData.tickSummaries.length) < truthAuctionBookData.tickCount
	const hasMoreViewerBids = BigInt(truthAuctionBookData.viewerBids.length) < truthAuctionBookData.viewerBidCount
	const hasMoreAggregatedAuctionBids = BigInt(aggregatedAuctionBids.length) < aggregatedAuctionBidCountForLoadedTicks
	const selectTruthAuctionTick = (tick: bigint) => {
		setSelectedBookTick(currentTick => (currentTick === tick ? currentTick : tick))
	}

	useEffect(() => {
		setSelectedBookTick(undefined)
	}, [accountAddress, truthAuctionAddress])

	useEffect(() => {
		if (!isTruthAuctionBookVisible || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress) {
			setTruthAuctionBookData({
				tickSummaries: [],
				tickCount: 0n,
				viewerBids: [],
				viewerBidCount: 0n,
			})
			setSelectedBookTick(undefined)
			setLoadingTruthAuctionBook(false)
			setAggregatedAuctionBids([])
			setAggregatedAuctionBidCountForLoadedTicks(0n)
			setLoadingAggregatedAuctionBids(false)
			setTruthAuctionBookError(undefined)
			return
		}

		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingTruthAuctionBook(true)
		setTruthAuctionBookError(undefined)
		void Promise.all([loadTruthAuctionActiveTickPages(client, truthAuctionAddress, loadedTickPageCount), accountAddress === undefined ? Promise.resolve({ bidCount: 0n, bids: [] }) : loadTruthAuctionBidderBidPages(client, truthAuctionAddress, accountAddress, loadedViewerBidPageCount)])
			.then(([tickPageData, viewerBidData]) => {
				if (cancelled) return
				const sortedTickSummaries = sortTruthAuctionTickSummariesDescending(tickPageData.tickSummaries)
				setTruthAuctionBookData({
					tickSummaries: sortedTickSummaries,
					tickCount: tickPageData.tickCount,
					viewerBids: viewerBidData.bids,
					viewerBidCount: viewerBidData.bidCount,
				})
				setSelectedBookTick(currentSelection => {
					if (currentSelection !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === currentSelection)) return currentSelection
					if (enteredBidTick !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === enteredBidTick)) return enteredBidTick
					if (truthAuctionClearingTick !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === truthAuctionClearingTick)) return truthAuctionClearingTick
					return sortedTickSummaries[0]?.tick
				})
			})
			.catch(error => {
				if (cancelled) return
				setTruthAuctionBookData({
					tickSummaries: [],
					tickCount: 0n,
					viewerBids: [],
					viewerBidCount: 0n,
				})
				setSelectedBookTick(undefined)
				setTruthAuctionBookError(getErrorMessage(error, 'Failed to load truth auction bidbook'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingTruthAuctionBook(false)
			})
		return () => {
			cancelled = true
		}
	}, [accountAddress, enteredBidTick, forkAuctionResultHash, isTruthAuctionBookVisible, loadedTickPageCount, loadedViewerBidPageCount, truthAuctionAddress, truthAuctionClearingTick, truthAuctionReadClient])

	useEffect(() => {
		if (!isTruthAuctionBookVisible || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress) {
			setAggregatedAuctionBids([])
			setAggregatedAuctionBidCountForLoadedTicks(0n)
			setLoadingAggregatedAuctionBids(false)
			return
		}

		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingAggregatedAuctionBids(true)
		void loadAggregatedTruthAuctionBidPages(client, truthAuctionAddress, truthAuctionBookData.tickSummaries, loadedAuctionBidPageCount)
			.then(({ bids, bidCountForLoadedTicks }) => {
				if (cancelled) return
				setAggregatedAuctionBids(bids)
				setAggregatedAuctionBidCountForLoadedTicks(bidCountForLoadedTicks)
			})
			.catch(error => {
				if (cancelled) return
				setAggregatedAuctionBids([])
				setAggregatedAuctionBidCountForLoadedTicks(0n)
				setTruthAuctionBookError(currentError => currentError ?? getErrorMessage(error, 'Failed to load truth auction bids across the visible price levels'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingAggregatedAuctionBids(false)
			})
		return () => {
			cancelled = true
		}
	}, [forkAuctionResultHash, isTruthAuctionBookVisible, loadedAuctionBidPageCount, truthAuctionAddress, truthAuctionBookData.tickSummaries, truthAuctionReadClient])

	return {
		aggregatedAuctionBidCountForLoadedTicks,
		aggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		hasMoreTickSummaries,
		hasMoreViewerBids,
		loadNextAuctionBidPage,
		loadNextTickPage,
		loadNextViewerBidPage,
		loadingAggregatedAuctionBids,
		loadingTruthAuctionBook,
		selectTruthAuctionTick,
		selectedBookTick,
		truthAuctionBookData,
		truthAuctionBookError,
	}
}
