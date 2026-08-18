import { TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_MIN_TICK, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/shared/truthAuctionTickMath';
import type { TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '@zoltar/ui-core-shared/types/contracts.js';
import { getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice, TRUTH_AUCTION_MIN_SUPPORTED_TICK } from '@zoltar/ui-core-shared/protocol/truthAuctionMath.js';
export { TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_MIN_TICK, TRUTH_AUCTION_PRICE_PRECISION };
export { getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice, TRUTH_AUCTION_MIN_SUPPORTED_TICK };
export type TruthAuctionDisposition = {
    label: string;
    tone: 'default' | 'danger' | 'success' | 'warning';
};
type TruthAuctionFinalizedSettlementKind = 'ethRefund' | 'none' | 'repClaim';
type TruthAuctionBidSummaryKind = 'losing' | 'neutral' | 'partial' | 'refundable' | 'refunded' | 'repClaimable' | 'winning';
export type TruthAuctionBidDisposition = TruthAuctionDisposition & {
    canPrefillRefund: boolean;
    canPrefillSettle: boolean;
    settlementKind: TruthAuctionFinalizedSettlementKind;
    summaryKind: TruthAuctionBidSummaryKind;
};
export type TruthAuctionDepthPoint = {
    tick: bigint;
    price: bigint;
    currentTotalBidAttoEth: bigint;
    cumulativeBidAttoEth: bigint;
    disposition: TruthAuctionDisposition;
    isSelected: boolean;
    isPreviewTick: boolean;
    submissionCount: bigint;
};
export type TruthAuctionBidSettlementEstimate = {
    purchasedRepAmountAttoRep: bigint;
    refundedBidAmountAttoEth: bigint;
    usedBidAmountAttoEth: bigint;
};
export declare function estimateRepPurchased(bidAmountAttoEth: bigint, price: bigint): bigint;
export declare function getTruthAuctionWinningThresholdPrice(truthAuction: TruthAuctionMetrics | undefined): bigint | undefined;
export declare function getTruthAuctionBidDisposition(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionBidDisposition;
export declare function getTruthAuctionBidSettlementEstimate(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionBidSettlementEstimate;
export declare function getTruthAuctionDispositionClassName(tone: TruthAuctionDisposition['tone']): "is-danger" | "is-success" | "is-warning" | "is-default";
export declare function sortTruthAuctionTickSummariesDescending(tickSummaries: TruthAuctionTickSummary[]): TruthAuctionTickSummary[];
export declare function buildTruthAuctionDepthPoints({ enteredBidTick, selectedBookTick, tickSummaries, truthAuction }: {
    enteredBidTick: bigint | undefined;
    selectedBookTick: bigint | undefined;
    tickSummaries: TruthAuctionTickSummary[];
    truthAuction: TruthAuctionMetrics | undefined;
}): TruthAuctionDepthPoint[];
export declare function getTruthAuctionOverviewProgress(truthAuction: TruthAuctionMetrics | undefined, tickSummaries: TruthAuctionTickSummary[]): {
    attoEthRaised: bigint;
    attoRepSold: bigint;
} | undefined;
export declare function sortTruthAuctionBidsByPriority(bids: TruthAuctionBidView[]): TruthAuctionBidView[];
export declare function getTruthAuctionBidPreview(submitBidPriceInput: string): {
    enteredPrice: bigint;
    submittedPrice: bigint;
    tick: bigint;
} | undefined;
export declare function getTruthAuctionBidPriceValidationMessage(submitBidPriceInput: string): "Enter a bid price greater than zero." | "Bid price is outside the supported auction range." | "Enter a valid bid price." | undefined;
export declare function getTruthAuctionBidGuardMessage({ accountAddress, currentTimestamp, isOnActiveAppChain, submitBidAmountInput, truthAuction, walletBalanceAttoEth, }: {
    accountAddress: string | undefined;
    currentTimestamp?: bigint | undefined;
    isOnActiveAppChain: boolean;
    submitBidAmountInput: string;
    truthAuction: TruthAuctionMetrics | undefined;
    walletBalanceAttoEth: bigint | undefined;
}): string | undefined;
//# sourceMappingURL=truthAuctionBook.d.ts.map