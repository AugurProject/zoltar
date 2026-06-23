import type { Address } from 'viem'
import type { ForkWorkflowSelectionStage } from './securityPoolWorkflow.js'
import { getTruthAuctionSettlementBidKey } from './truthAuctionSettlement.js'
import { sameAddress } from './address.js'
import { getTruthAuctionBidDisposition, getTruthAuctionDispositionClassName, getTruthAuctionPriceAtTick } from './truthAuctionBook.js'
import type { TruthAuctionBidView, TruthAuctionMetrics } from '../types/contracts.js'

type LocalSettlementBidStatus = 'claimed' | 'refunded'

export type TruthAuctionBidRowViewModel = {
	bidder: Address
	cumulativeEth: bigint
	ethAmount: bigint
	key: string
	price: bigint
	statusLabel: string
	statusToneClassName: string
}

export type ViewerTruthAuctionBidRowViewModel = {
	ethAmount: bigint
	key: string
	price: bigint
	settlementControl:
		| {
				ariaLabel: string
				bidKey: string
				checked: boolean
				disabled: boolean
				title: string
		  }
		| undefined
	statusLabel: string
	statusToneClassName: string
}

export type ViewerTruthAuctionBidRowsViewModel = {
	rows: ViewerTruthAuctionBidRowViewModel[]
	showSettlementActionColumn: boolean
}

export function buildTruthAuctionBidRows({ bids, truthAuction }: { bids: TruthAuctionBidView[]; truthAuction: TruthAuctionMetrics | undefined }): TruthAuctionBidRowViewModel[] {
	if (truthAuction === undefined) return []
	return bids.map(bid => {
		const disposition = getTruthAuctionBidDisposition(bid, truthAuction)
		return {
			bidder: bid.bidder,
			cumulativeEth: bid.cumulativeEth,
			ethAmount: bid.ethAmount,
			key: `aggregate:${bid.tick.toString()}:${bid.bidIndex.toString()}`,
			price: getTruthAuctionPriceAtTick(bid.tick),
			statusLabel: disposition.label,
			statusToneClassName: getTruthAuctionDispositionClassName(disposition.tone),
		}
	})
}

export function buildViewerTruthAuctionBidRows({
	accountAddress,
	isSettlementInProgress,
	selectedBidKeys,
	selectedStage,
	settlementResultByKey,
	truthAuction,
	viewerBids,
}: {
	accountAddress: Address | undefined
	isSettlementInProgress: boolean
	selectedBidKeys: string[]
	selectedStage: ForkWorkflowSelectionStage
	settlementResultByKey: Record<string, LocalSettlementBidStatus>
	truthAuction: TruthAuctionMetrics | undefined
	viewerBids: TruthAuctionBidView[]
}): ViewerTruthAuctionBidRowsViewModel {
	if (truthAuction === undefined) {
		return {
			rows: [],
			showSettlementActionColumn: false,
		}
	}

	const bidsWithDisposition = viewerBids.map(bid => ({
		bid,
		disposition: getTruthAuctionBidDisposition(bid, truthAuction),
	}))
	const showSettlementActionColumn = selectedStage === 'settlement' && bidsWithDisposition.some(({ bid, disposition }) => sameAddress(bid.bidder, accountAddress) && (disposition.canPrefillRefund || disposition.canPrefillSettle))
	const rows = bidsWithDisposition.map(({ bid, disposition }) => {
		const isSettlementBid = sameAddress(bid.bidder, accountAddress) && (disposition.canPrefillRefund || disposition.canPrefillSettle)
		const settlementBidKey = getTruthAuctionSettlementBidKey(bid)
		const inSessionSettlementResult = settlementResultByKey[settlementBidKey]
		const isSettlementBidActions = selectedStage === 'settlement' && isSettlementBid && inSessionSettlementResult === undefined && !isSettlementInProgress
		const isSettlementBidSelectable = inSessionSettlementResult === undefined && !isSettlementInProgress
		const statusLabel = (() => {
			if (inSessionSettlementResult === 'claimed') return 'Claimed'
			if (inSessionSettlementResult === 'refunded') return 'Refunded'
			return disposition.label
		})()
		const statusToneClassName = (() => {
			if (inSessionSettlementResult === 'claimed') return 'is-success'
			if (inSessionSettlementResult === 'refunded') return 'is-default'
			return getTruthAuctionDispositionClassName(disposition.tone)
		})()

		return {
			ethAmount: bid.ethAmount,
			key: `viewer:${bid.tick.toString()}:${bid.bidIndex.toString()}`,
			price: getTruthAuctionPriceAtTick(bid.tick),
			settlementControl: showSettlementActionColumn
				? {
						ariaLabel: isSettlementBidActions ? 'Select bid for settlement' : 'Bid is not settlement-eligible',
						bidKey: settlementBidKey,
						checked: isSettlementBidActions ? selectedBidKeys.includes(settlementBidKey) : false,
						disabled: !isSettlementBidActions || !isSettlementBidSelectable,
						title: isSettlementBidActions ? 'Select bid for settlement' : 'This bid is not yet settlement-eligible',
					}
				: undefined,
			statusLabel,
			statusToneClassName,
		}
	})

	return {
		rows,
		showSettlementActionColumn,
	}
}

export function updateTruthAuctionSettlementBidSelection(currentKeys: string[], bidKey: string, checked: boolean) {
	if (checked) {
		if (currentKeys.includes(bidKey)) return currentKeys
		return [...currentKeys, bidKey]
	}
	return currentKeys.filter(currentKey => currentKey !== bidKey)
}
