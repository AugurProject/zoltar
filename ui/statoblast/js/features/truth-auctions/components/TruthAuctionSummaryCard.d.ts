import type { ComponentChildren } from 'preact';
type TruthAuctionSummaryCardProps = {
    auctionedCapacityOwnershipAttoRepDisplay?: ComponentChildren | undefined;
    badge: ComponentChildren;
    clearingPriceDisplay: ComponentChildren;
    displayedEthRaisedAttoEth: bigint;
    displayedRepSoldAttoRep: bigint;
    endsDisplay: ComponentChildren;
    attoEthRaiseCap: bigint;
    ethRaisedProgress: number;
    maxAttoRepBeingSold: bigint;
    minBidSizeAttoEth: bigint;
    repSoldProgress: number;
    startedDisplay: ComponentChildren;
    winningThresholdPriceDisplay?: ComponentChildren | undefined;
};
export declare function TruthAuctionSummaryCard({ auctionedCapacityOwnershipAttoRepDisplay, badge, clearingPriceDisplay, displayedEthRaisedAttoEth, displayedRepSoldAttoRep, endsDisplay, attoEthRaiseCap, ethRaisedProgress, maxAttoRepBeingSold, minBidSizeAttoEth, repSoldProgress, startedDisplay, winningThresholdPriceDisplay, }: TruthAuctionSummaryCardProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TruthAuctionSummaryCard.d.ts.map