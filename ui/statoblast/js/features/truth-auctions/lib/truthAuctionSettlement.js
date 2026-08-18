import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { getTruthAuctionBidDisposition, getTruthAuctionBidSettlementEstimate, getTruthAuctionWinningThresholdPrice } from './truthAuctionBook.js';
export function getTruthAuctionSettlementBidKey(bid) {
    return `${bid.tick.toString()}:${bid.bidIndex.toString()}`;
}
export function getTruthAuctionSettlementBidRows({ accountAddress, truthAuction, viewerBids }) {
    if (truthAuction === undefined || accountAddress === undefined)
        return [];
    return viewerBids
        .map(bid => ({
        bid,
        disposition: getTruthAuctionBidDisposition(bid, truthAuction),
    }))
        .filter(({ bid, disposition }) => sameAddress(bid.bidder, accountAddress) && (disposition.canPrefillRefund || disposition.canPrefillSettle));
}
export function getTruthAuctionSettlementSelectionState({ selectedBidKeys, settlementBidRows }) {
    const rowKeys = settlementBidRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid));
    const selectedRows = settlementBidRows.filter(({ bid }) => selectedBidKeys.includes(getTruthAuctionSettlementBidKey(bid)));
    const selectedRefundRows = selectedRows.filter(({ disposition }) => disposition.canPrefillRefund);
    const selectedClaimRows = selectedRows.filter(({ disposition }) => disposition.canPrefillSettle);
    const selectedClaimKeys = selectedClaimRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid));
    const selectedRefundKeys = selectedRefundRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid));
    const rowsHaveClaims = settlementBidRows.some(({ disposition }) => disposition.canPrefillSettle);
    const rowsHaveRefunds = settlementBidRows.some(({ disposition }) => disposition.canPrefillRefund);
    const rowsSelectionMode = (() => {
        if (rowsHaveClaims && rowsHaveRefunds)
            return 'mixed';
        if (rowsHaveClaims)
            return 'claim';
        return 'refund';
    })();
    const selectionMode = (() => {
        if (selectedRefundRows.length > 0 && selectedClaimRows.length > 0)
            return 'mixed';
        if (selectedClaimRows.length > 0)
            return 'claim';
        if (selectedRows.length > 0)
            return 'refund';
        return rowsSelectionMode;
    })();
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
    };
}
export function getTruthAuctionSettlementSelectionEstimate({ auctionedCapacityOwnershipAttoRep, selectedRows, truthAuction }) {
    let estimatedRefundedAttoEth = 0n;
    let estimatedVaultRepBackingAttoRep = 0n;
    const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction);
    const shouldCarryUnderfundedRemainder = truthAuction !== undefined && winningThresholdPrice !== undefined && truthAuction.underfundedWinningAttoEth > 0n && truthAuction.totalAttoRepPurchased > 0n;
    let underfundedRemainder = 0n;
    for (const row of selectedRows) {
        const estimate = getTruthAuctionBidSettlementEstimate(row.bid, truthAuction);
        estimatedRefundedAttoEth += estimate.refundedBidAmountAttoEth;
        if (shouldCarryUnderfundedRemainder && row.disposition.canPrefillSettle) {
            const numerator = row.bid.bidAmountAttoEth * truthAuction.totalAttoRepPurchased + underfundedRemainder;
            estimatedVaultRepBackingAttoRep += numerator / truthAuction.underfundedWinningAttoEth;
            underfundedRemainder = numerator % truthAuction.underfundedWinningAttoEth;
        }
        else {
            estimatedVaultRepBackingAttoRep += estimate.purchasedRepAmountAttoRep;
        }
    }
    let estimatedAssignedCapacityOwnershipAttoRep = 0n;
    if (estimatedVaultRepBackingAttoRep > 0n) {
        if (truthAuction === undefined || truthAuction.totalAttoRepPurchased === 0n || auctionedCapacityOwnershipAttoRep === undefined) {
            estimatedAssignedCapacityOwnershipAttoRep = undefined;
        }
        else {
            estimatedAssignedCapacityOwnershipAttoRep = (auctionedCapacityOwnershipAttoRep * estimatedVaultRepBackingAttoRep) / truthAuction.totalAttoRepPurchased;
        }
    }
    return {
        estimatedAssignedCapacityOwnershipAttoRep,
        estimatedRefundedAttoEth,
        estimatedVaultRepBackingAttoRep,
    };
}
export function getTruthAuctionSettlementActionAvailabilityMessage({ claimingAvailable, selectedClaimRows, selectedRows, selectionHasClaims, selectionHasRefunds, truthAuction, }) {
    const bidActionAvailability = (() => {
        if (selectedRows.length === 0)
            return 'Pick one or more of your bids before settlement.';
        if (truthAuction === undefined)
            return 'Loading truth auction.';
        if (truthAuction.finalized && selectionHasClaims && claimingAvailable === false)
            return 'Finalized settlement is not available for this pool.';
        if (selectionHasClaims && !truthAuction.finalized)
            return 'Winning bids can only be settled after the truth auction is finalized.';
        if (!truthAuction.finalized && (!truthAuction.hitCap || truthAuction.clearingTick === undefined))
            return 'Losing bids cannot be refunded until the auction has a clearing tick.';
        return undefined;
    })();
    if (selectedRows.length === 0)
        return bidActionAvailability;
    if (selectionHasClaims && selectedClaimRows.length === 0)
        return 'Select one or more winning bids before submitting settlement.';
    if (!selectionHasClaims && selectionHasRefunds === false)
        return 'Select one or more refundable bids before submitting refunds.';
    return bidActionAvailability;
}
//# sourceMappingURL=truthAuctionSettlement.js.map