import type { Address } from '@zoltar/shared/ethereum';
import type { TruthAuctionBidView, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js';
import { type TruthAuctionBidDisposition } from './truthAuctionBook.js';
export type TruthAuctionSettlementBidRow = {
    bid: TruthAuctionBidView;
    disposition: TruthAuctionBidDisposition;
};
type TruthAuctionSettlementSelectionMode = 'claim' | 'mixed' | 'refund';
export type TruthAuctionSettlementSelectionState = {
    rowKeys: string[];
    selectedRows: TruthAuctionSettlementBidRow[];
    selectedRefundRows: TruthAuctionSettlementBidRow[];
    selectedClaimRows: TruthAuctionSettlementBidRow[];
    selectedClaimKeys: string[];
    selectedRefundKeys: string[];
    rowsHaveClaims: boolean;
    rowsHaveRefunds: boolean;
    rowsSelectionMode: TruthAuctionSettlementSelectionMode;
    selectionMode: TruthAuctionSettlementSelectionMode;
    selectionHasClaims: boolean;
    selectionHasRefunds: boolean;
};
export type TruthAuctionSettlementSelectionEstimate = {
    estimatedAssignedCapacityOwnershipAttoRep: bigint | undefined;
    estimatedRefundedAttoEth: bigint;
    estimatedVaultRepBackingAttoRep: bigint;
};
export declare function getTruthAuctionSettlementBidKey(bid: Pick<TruthAuctionBidView, 'bidIndex' | 'tick'>): string;
export declare function getTruthAuctionSettlementBidRows({ accountAddress, truthAuction, viewerBids }: {
    accountAddress: Address | undefined;
    truthAuction: TruthAuctionMetrics | undefined;
    viewerBids: TruthAuctionBidView[];
}): {
    bid: TruthAuctionBidView;
    disposition: TruthAuctionBidDisposition;
}[];
export declare function getTruthAuctionSettlementSelectionState({ selectedBidKeys, settlementBidRows }: {
    selectedBidKeys: string[];
    settlementBidRows: TruthAuctionSettlementBidRow[];
}): TruthAuctionSettlementSelectionState;
export declare function getTruthAuctionSettlementSelectionEstimate({ auctionedCapacityOwnershipAttoRep, selectedRows, truthAuction }: {
    auctionedCapacityOwnershipAttoRep: bigint | undefined;
    selectedRows: TruthAuctionSettlementBidRow[];
    truthAuction: TruthAuctionMetrics | undefined;
}): TruthAuctionSettlementSelectionEstimate;
export declare function getTruthAuctionSettlementActionAvailabilityMessage({ claimingAvailable, selectedClaimRows, selectedRows, selectionHasClaims, selectionHasRefunds, truthAuction, }: {
    claimingAvailable: boolean | undefined;
    selectedClaimRows: TruthAuctionSettlementBidRow[];
    selectedRows: TruthAuctionSettlementBidRow[];
    selectionHasClaims: boolean;
    selectionHasRefunds: boolean;
    truthAuction: TruthAuctionMetrics | undefined;
}): "Loading truth auction." | "Pick one or more of your bids before settlement." | "Finalized settlement is not available for this pool." | "Winning bids can only be settled after the truth auction is finalized." | "Losing bids cannot be refunded until the auction has a clearing tick." | "Select one or more winning bids before submitting settlement." | "Select one or more refundable bids before submitting refunds." | undefined;
export {};
//# sourceMappingURL=truthAuctionSettlement.d.ts.map