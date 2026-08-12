import { useEffect, useState } from 'preact/hooks'
import { type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { loadTruthAuctionActiveTickPage, loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage } from '../../../protocol/index.js'
import { createConnectedReadClient } from '../../../lib/clients.js'
import { getErrorMessage } from '../../../lib/errors.js'
import { sortTruthAuctionBidsByPriority, sortTruthAuctionTickSummariesDescending } from '../lib/truthAuctionBook.js'
import type { ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js'
import type { ReadClient, TruthAuctionBidView, TruthAuctionTickSummary } from '../../../types/contracts.js'
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
	const [tickDataKey, setTickDataKey] = useState<string | undefined>(undefined)
	const [viewerDataKey, setViewerDataKey] = useState<string | undefined>(undefined)
	const [aggregatedDataKey, setAggregatedDataKey] = useState<string | undefined>(undefined)
	const [loadingTruthAuctionLevels, setLoadingTruthAuctionLevels] = useState(false)
	const [loadingViewerTruthAuctionBids, setLoadingViewerTruthAuctionBids] = useState(false)
	const [loadingAggregatedAuctionBids, setLoadingAggregatedAuctionBids] = useState(false)
	const [truthAuctionLevelsError, setTruthAuctionLevelsError] = useState<string | undefined>(undefined)
	const [truthAuctionLevelsErrorKey, setTruthAuctionLevelsErrorKey] = useState<string | undefined>(undefined)
	const [viewerTruthAuctionBidsError, setViewerTruthAuctionBidsError] = useState<string | undefined>(undefined)
	const [viewerTruthAuctionBidsErrorKey, setViewerTruthAuctionBidsErrorKey] = useState<string | undefined>(undefined)
	const [aggregatedAuctionBidsError, setAggregatedAuctionBidsError] = useState<string | undefined>(undefined)
	const [aggregatedAuctionBidsErrorKey, setAggregatedAuctionBidsErrorKey] = useState<string | undefined>(undefined)
	const [levelRetryRequestNonce, setLevelRetryRequestNonce] = useState(0)
	const [aggregateRetryRequestNonce, setAggregateRetryRequestNonce] = useState(0)
	const [viewerRetryRequestNonce, setViewerRetryRequestNonce] = useState(0)
	const truthAuctionKey = truthAuctionAddress?.toLowerCase()
	const viewerBookKey = truthAuctionKey === undefined ? undefined : `${truthAuctionKey}:${accountAddress?.toLowerCase() ?? 'no-account'}`
	const isTruthAuctionBookVisible = shouldShowTruthAuctionVisualization && truthAuctionAddress !== undefined && truthAuctionAddress !== zeroAddress && (selectedStage === 'auction' || selectedStage === 'settlement')
	const scopedTruthAuctionBookData: TruthAuctionBookData = {
		tickSummaries: tickDataKey === truthAuctionKey ? truthAuctionBookData.tickSummaries : [],
		tickCount: tickDataKey === truthAuctionKey ? truthAuctionBookData.tickCount : 0n,
		viewerBids: viewerDataKey === viewerBookKey ? truthAuctionBookData.viewerBids : [],
		viewerBidCount: viewerDataKey === viewerBookKey ? truthAuctionBookData.viewerBidCount : 0n,
	}
	const scopedAggregatedAuctionBids = aggregatedDataKey === truthAuctionKey ? aggregatedAuctionBids : []
	const scopedAggregatedAuctionBidCountForLoadedTicks = aggregatedDataKey === truthAuctionKey ? aggregatedAuctionBidCountForLoadedTicks : 0n
	const hasLoadedTruthAuctionBook = isTruthAuctionBookVisible && tickDataKey === truthAuctionKey
	const hasLoadedViewerTruthAuctionBids = isTruthAuctionBookVisible && viewerDataKey === viewerBookKey
	const hasLoadedAggregatedAuctionBids = isTruthAuctionBookVisible && aggregatedDataKey === truthAuctionKey
	const scopedTruthAuctionLevelsError = truthAuctionLevelsErrorKey === truthAuctionKey ? truthAuctionLevelsError : undefined
	const scopedViewerTruthAuctionBidsError = viewerTruthAuctionBidsErrorKey === viewerBookKey ? viewerTruthAuctionBidsError : undefined
	const scopedAggregatedAuctionBidsError = aggregatedAuctionBidsErrorKey === truthAuctionKey ? aggregatedAuctionBidsError : undefined
	const truthAuctionBookError = scopedTruthAuctionLevelsError ?? scopedAggregatedAuctionBidsError
	const isLoadingTruthAuctionBook = loadingTruthAuctionLevels || (isTruthAuctionBookVisible && !hasLoadedTruthAuctionBook && scopedTruthAuctionLevelsError === undefined)
	const isLoadingViewerTruthAuctionBids = loadingViewerTruthAuctionBids || (isTruthAuctionBookVisible && accountAddress !== undefined && !hasLoadedViewerTruthAuctionBids && scopedViewerTruthAuctionBidsError === undefined)
	const isLoadingAggregatedAuctionBids = loadingAggregatedAuctionBids || (isTruthAuctionBookVisible && hasLoadedTruthAuctionBook && !hasLoadedAggregatedAuctionBids && scopedAggregatedAuctionBidsError === undefined)
	const hasMoreTickSummaries = BigInt(scopedTruthAuctionBookData.tickSummaries.length) < scopedTruthAuctionBookData.tickCount
	const hasMoreViewerBids = BigInt(scopedTruthAuctionBookData.viewerBids.length) < scopedTruthAuctionBookData.viewerBidCount
	const hasMoreAggregatedAuctionBids = BigInt(scopedAggregatedAuctionBids.length) < scopedAggregatedAuctionBidCountForLoadedTicks
	const selectTruthAuctionTick = (tick: bigint) => {
		setSelectedBookTick(currentTick => (currentTick === tick ? currentTick : tick))
	}
	const retryPublicTruthAuctionBook = () => {
		if (scopedTruthAuctionLevelsError !== undefined) {
			setLoadingTruthAuctionLevels(true)
			setLevelRetryRequestNonce(currentNonce => currentNonce + 1)
			return
		}
		setLoadingAggregatedAuctionBids(true)
		setAggregateRetryRequestNonce(currentNonce => currentNonce + 1)
	}
	const retryViewerTruthAuctionBids = () => {
		setLoadingViewerTruthAuctionBids(true)
		setViewerRetryRequestNonce(currentNonce => currentNonce + 1)
	}

	useEffect(() => {
		setSelectedBookTick(undefined)
		setTruthAuctionLevelsError(undefined)
		setTruthAuctionLevelsErrorKey(undefined)
		setAggregatedAuctionBidsError(undefined)
		setAggregatedAuctionBidsErrorKey(undefined)
	}, [truthAuctionAddress])

	useEffect(() => {
		setViewerTruthAuctionBidsError(undefined)
		setViewerTruthAuctionBidsErrorKey(undefined)
	}, [accountAddress, truthAuctionAddress])

	useEffect(() => {
		if (!isTruthAuctionBookVisible || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress) {
			setTruthAuctionBookData({
				tickSummaries: [],
				tickCount: 0n,
				viewerBids: [],
				viewerBidCount: 0n,
			})
			setTickDataKey(undefined)
			setViewerDataKey(undefined)
			setSelectedBookTick(undefined)
			setLoadingTruthAuctionLevels(false)
			setTruthAuctionLevelsError(undefined)
			setTruthAuctionLevelsErrorKey(undefined)
			return
		}

		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingTruthAuctionLevels(true)
		void loadTruthAuctionActiveTickPages(client, truthAuctionAddress, loadedTickPageCount)
			.then(tickPageData => {
				if (cancelled) return
				setTruthAuctionLevelsError(undefined)
				setTruthAuctionLevelsErrorKey(undefined)
				const sortedTickSummaries = sortTruthAuctionTickSummariesDescending(tickPageData.tickSummaries)
				setTruthAuctionBookData(currentData => ({
					...currentData,
					tickSummaries: sortedTickSummaries,
					tickCount: tickPageData.tickCount,
				}))
				setTickDataKey(truthAuctionKey)
				setSelectedBookTick(currentSelection => {
					if (currentSelection !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === currentSelection)) return currentSelection
					if (enteredBidTick !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === enteredBidTick)) return enteredBidTick
					if (truthAuctionClearingTick !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === truthAuctionClearingTick)) return truthAuctionClearingTick
					return sortedTickSummaries[0]?.tick
				})
			})
			.catch(error => {
				if (cancelled) return
				setTruthAuctionLevelsError(getErrorMessage(error, 'Failed to load truth auction price levels'))
				setTruthAuctionLevelsErrorKey(truthAuctionKey)
			})
			.finally(() => {
				if (cancelled) return
				setLoadingTruthAuctionLevels(false)
			})
		return () => {
			cancelled = true
		}
	}, [enteredBidTick, forkAuctionResultHash, isTruthAuctionBookVisible, levelRetryRequestNonce, loadedTickPageCount, truthAuctionAddress, truthAuctionClearingTick, truthAuctionKey, truthAuctionReadClient])

	useEffect(() => {
		if (!isTruthAuctionBookVisible || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress) {
			setViewerDataKey(undefined)
			setLoadingViewerTruthAuctionBids(false)
			setViewerTruthAuctionBidsError(undefined)
			setViewerTruthAuctionBidsErrorKey(undefined)
			return
		}

		if (accountAddress === undefined) {
			setTruthAuctionBookData(currentData => ({
				...currentData,
				viewerBids: [],
				viewerBidCount: 0n,
			}))
			setViewerDataKey(viewerBookKey)
			setLoadingViewerTruthAuctionBids(false)
			setViewerTruthAuctionBidsError(undefined)
			setViewerTruthAuctionBidsErrorKey(undefined)
			return
		}

		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingViewerTruthAuctionBids(true)
		void loadTruthAuctionBidderBidPages(client, truthAuctionAddress, accountAddress, loadedViewerBidPageCount)
			.then(viewerBidData => {
				if (cancelled) return
				setViewerTruthAuctionBidsError(undefined)
				setViewerTruthAuctionBidsErrorKey(undefined)
				setTruthAuctionBookData(currentData => ({
					...currentData,
					viewerBids: viewerBidData.bids,
					viewerBidCount: viewerBidData.bidCount,
				}))
				setViewerDataKey(viewerBookKey)
			})
			.catch(error => {
				if (cancelled) return
				setViewerTruthAuctionBidsError(getErrorMessage(error, 'Failed to load your truth auction bids'))
				setViewerTruthAuctionBidsErrorKey(viewerBookKey)
			})
			.finally(() => {
				if (cancelled) return
				setLoadingViewerTruthAuctionBids(false)
			})
		return () => {
			cancelled = true
		}
	}, [accountAddress, forkAuctionResultHash, isTruthAuctionBookVisible, loadedViewerBidPageCount, truthAuctionAddress, truthAuctionReadClient, viewerBookKey, viewerRetryRequestNonce])

	useEffect(() => {
		if (!isTruthAuctionBookVisible || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress || tickDataKey !== truthAuctionKey) {
			setAggregatedAuctionBids([])
			setAggregatedAuctionBidCountForLoadedTicks(0n)
			setAggregatedDataKey(undefined)
			setLoadingAggregatedAuctionBids(false)
			setAggregatedAuctionBidsError(undefined)
			setAggregatedAuctionBidsErrorKey(undefined)
			return
		}

		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingAggregatedAuctionBids(true)
		void loadAggregatedTruthAuctionBidPages(client, truthAuctionAddress, truthAuctionBookData.tickSummaries, loadedAuctionBidPageCount)
			.then(({ bids, bidCountForLoadedTicks }) => {
				if (cancelled) return
				setAggregatedAuctionBidsError(undefined)
				setAggregatedAuctionBidsErrorKey(undefined)
				setAggregatedAuctionBids(bids)
				setAggregatedAuctionBidCountForLoadedTicks(bidCountForLoadedTicks)
				setAggregatedDataKey(truthAuctionKey)
			})
			.catch(error => {
				if (cancelled) return
				setAggregatedAuctionBidsError(getErrorMessage(error, 'Failed to load truth auction bids across the visible price levels'))
				setAggregatedAuctionBidsErrorKey(truthAuctionKey)
			})
			.finally(() => {
				if (cancelled) return
				setLoadingAggregatedAuctionBids(false)
			})
		return () => {
			cancelled = true
		}
	}, [aggregateRetryRequestNonce, isTruthAuctionBookVisible, loadedAuctionBidPageCount, tickDataKey, truthAuctionAddress, truthAuctionBookData.tickSummaries, truthAuctionKey, truthAuctionReadClient])

	return {
		aggregatedAuctionBidCountForLoadedTicks: scopedAggregatedAuctionBidCountForLoadedTicks,
		aggregatedAuctionBids: scopedAggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		hasMoreTickSummaries,
		hasMoreViewerBids,
		hasLoadedAggregatedAuctionBids,
		hasLoadedTruthAuctionBook,
		hasLoadedViewerTruthAuctionBids,
		loadNextAuctionBidPage,
		loadNextTickPage,
		loadNextViewerBidPage,
		loadingAggregatedAuctionBids: isLoadingAggregatedAuctionBids,
		loadingTruthAuctionBook: isLoadingTruthAuctionBook,
		loadingViewerTruthAuctionBids: isLoadingViewerTruthAuctionBids,
		retryingPublicTruthAuctionBook: truthAuctionBookError !== undefined && (isLoadingTruthAuctionBook || isLoadingAggregatedAuctionBids),
		retryingViewerTruthAuctionBids: scopedViewerTruthAuctionBidsError !== undefined && isLoadingViewerTruthAuctionBids,
		retryPublicTruthAuctionBook,
		retryViewerTruthAuctionBids,
		selectTruthAuctionTick,
		selectedBookTick,
		truthAuctionBookData: scopedTruthAuctionBookData,
		truthAuctionBookError,
		viewerTruthAuctionBidsError: scopedViewerTruthAuctionBidsError,
	}
}
