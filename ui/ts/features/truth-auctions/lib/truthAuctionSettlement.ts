import type { Address } from '@zoltar/shared/ethereum'
import type { TruthAuctionBidView, TruthAuctionMetrics } from '../../../types/contracts.js'
import { sameAddress } from '../../../lib/address.js'
import { getTruthAuctionBidDisposition, getTruthAuctionBidSettlementEstimate, getTruthAuctionWinningThresholdPrice, type TruthAuctionBidDisposition } from './truthAuctionBook.js'

export type TruthAuctionSettlementBidRow = {
	bid: TruthAuctionBidView
	disposition: TruthAuctionBidDisposition
}

type TruthAuctionSettlementSelectionMode = 'claim' | 'mixed' | 'refund'

export type TruthAuctionSettlementSelectionState = {
	rowKeys: string[]
	selectedRows: TruthAuctionSettlementBidRow[]
	selectedRefundRows: TruthAuctionSettlementBidRow[]
	selectedClaimRows: TruthAuctionSettlementBidRow[]
	selectedClaimKeys: string[]
	selectedRefundKeys: string[]
	rowsHaveClaims: boolean
	rowsHaveRefunds: boolean
	rowsSelectionMode: TruthAuctionSettlementSelectionMode
	selectionMode: TruthAuctionSettlementSelectionMode
	selectionHasClaims: boolean
	selectionHasRefunds: boolean
}

export type TruthAuctionSettlementSelectionEstimate = {
	estimatedAssignedBondAllowance: bigint | undefined
	estimatedEthRefunded: bigint
	// Keep this concrete so the UI never needs a legacy underfunded fallback branch.
	estimatedRepClaimed: bigint
}

export function getTruthAuctionSettlementBidKey(bid: Pick<TruthAuctionBidView, 'bidIndex' | 'tick'>) {
	return `${bid.tick.toString()}:${bid.bidIndex.toString()}`
}

export function getTruthAuctionSettlementBidRows({ accountAddress, truthAuction, viewerBids }: { accountAddress: Address | undefined; truthAuction: TruthAuctionMetrics | undefined; viewerBids: TruthAuctionBidView[] }) {
	if (truthAuction === undefined || accountAddress === undefined) return []
	return viewerBids
		.map(bid => ({
			bid,
			disposition: getTruthAuctionBidDisposition(bid, truthAuction),
		}))
		.filter(({ bid, disposition }) => sameAddress(bid.bidder, accountAddress) && (disposition.canPrefillRefund || disposition.canPrefillSettle))
}

export function getTruthAuctionSettlementSelectionState({ selectedBidKeys, settlementBidRows }: { selectedBidKeys: string[]; settlementBidRows: TruthAuctionSettlementBidRow[] }): TruthAuctionSettlementSelectionState {
	const rowKeys = settlementBidRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid))
	const selectedRows = settlementBidRows.filter(({ bid }) => selectedBidKeys.includes(getTruthAuctionSettlementBidKey(bid)))
	const selectedRefundRows = selectedRows.filter(({ disposition }) => disposition.canPrefillRefund)
	const selectedClaimRows = selectedRows.filter(({ disposition }) => disposition.canPrefillSettle)
	const selectedClaimKeys = selectedClaimRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid))
	const selectedRefundKeys = selectedRefundRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid))
	const rowsHaveClaims = settlementBidRows.some(({ disposition }) => disposition.canPrefillSettle)
	const rowsHaveRefunds = settlementBidRows.some(({ disposition }) => disposition.canPrefillRefund)
	const rowsSelectionMode = (() => {
		if (rowsHaveClaims && rowsHaveRefunds) return 'mixed'
		if (rowsHaveClaims) return 'claim'
		return 'refund'
	})()
	const selectionMode = (() => {
		if (selectedRefundRows.length > 0 && selectedClaimRows.length > 0) return 'mixed'
		if (selectedClaimRows.length > 0) return 'claim'
		if (selectedRows.length > 0) return 'refund'
		return rowsSelectionMode
	})()

	return {
		rowKeys,
		selectedRows,
		selectedRefundRows,
		selectedClaimRows,
		selectedClaimKeys,
		selectedRefundKeys,
		rowsHaveClaims,
		rowsHaveRefunds,
		rowsSelectionMode,
		selectionMode,
		selectionHasClaims: selectedClaimRows.length > 0,
		selectionHasRefunds: selectedRefundRows.length > 0,
	}
}

export function getTruthAuctionSettlementSelectionEstimate({ auctionedSecurityBondAllowance, selectedRows, truthAuction }: { auctionedSecurityBondAllowance: bigint | undefined; selectedRows: TruthAuctionSettlementBidRow[]; truthAuction: TruthAuctionMetrics | undefined }): TruthAuctionSettlementSelectionEstimate {
	let estimatedEthRefunded = 0n
	let estimatedRepClaimed = 0n
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	const shouldCarryUnderfundedRemainder = truthAuction !== undefined && winningThresholdPrice !== undefined && truthAuction.underfundedWinningEth > 0n && truthAuction.totalRepPurchased > 0n
	let underfundedRemainder = 0n

	for (const row of selectedRows) {
		const estimate = getTruthAuctionBidSettlementEstimate(row.bid, truthAuction)
		estimatedEthRefunded += estimate.refundedEthAmount
		if (shouldCarryUnderfundedRemainder && row.disposition.canPrefillSettle) {
			const numerator = row.bid.ethAmount * truthAuction.totalRepPurchased + underfundedRemainder
			estimatedRepClaimed += numerator / truthAuction.underfundedWinningEth
			underfundedRemainder = numerator % truthAuction.underfundedWinningEth
		} else {
			estimatedRepClaimed += estimate.purchasedRepAmount
		}
	}

	let estimatedAssignedBondAllowance: bigint | undefined = 0n
	if (estimatedRepClaimed > 0n) {
		if (truthAuction === undefined || truthAuction.totalRepPurchased === 0n || auctionedSecurityBondAllowance === undefined) {
			estimatedAssignedBondAllowance = undefined
		} else {
			estimatedAssignedBondAllowance = (auctionedSecurityBondAllowance * estimatedRepClaimed) / truthAuction.totalRepPurchased
		}
	}

	return {
		estimatedAssignedBondAllowance,
		estimatedEthRefunded,
		estimatedRepClaimed,
	}
}

export function getTruthAuctionSettlementActionAvailabilityMessage({
	claimingAvailable,
	selectedClaimRows,
	selectedRows,
	selectionHasClaims,
	selectionHasRefunds,
	truthAuction,
}: {
	claimingAvailable: boolean | undefined
	selectedClaimRows: TruthAuctionSettlementBidRow[]
	selectedRows: TruthAuctionSettlementBidRow[]
	selectionHasClaims: boolean
	selectionHasRefunds: boolean
	truthAuction: TruthAuctionMetrics | undefined
}) {
	const bidActionAvailability = (() => {
		if (selectedRows.length === 0) return 'Pick one or more of your bids before settlement.'
		if (truthAuction === undefined) return 'Loading truth auction.'
		if (truthAuction.finalized && selectionHasClaims && claimingAvailable === false) return 'Finalized settlement is not available for this pool.'
		if (selectionHasClaims && !truthAuction.finalized) return 'Winning bids can only be settled after the truth auction is finalized.'
		if (!truthAuction.finalized && (!truthAuction.hitCap || truthAuction.clearingTick === undefined)) return 'Losing bids cannot be refunded until the auction has a clearing tick.'
		return undefined
	})()

	if (selectedRows.length === 0) return bidActionAvailability
	if (selectionHasClaims && selectedClaimRows.length === 0) return 'Select one or more winning bids before submitting settlement.'
	if (!selectionHasClaims && selectionHasRefunds === false) return 'Select one or more refundable bids before submitting refunds.'
	return bidActionAvailability
}
