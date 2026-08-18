import type { Address } from '@zoltar/shared/ethereum';
import type { ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js';
import type { TruthAuctionBidView, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js';
type LocalSettlementBidStatus = 'claimed' | 'refunded';
export type TruthAuctionBidRowViewModel = {
    bidder: Address;
    cumulativeBidAttoEth: bigint;
    bidAmountAttoEth: bigint;
    key: string;
    price: bigint;
    statusLabel: string;
    statusToneClassName: string;
};
export type ViewerTruthAuctionBidRowViewModel = {
    bidAmountAttoEth: bigint;
    key: string;
    price: bigint;
    settlementControl: {
        ariaLabel: string;
        bidKey: string;
        checked: boolean;
        disabled: boolean;
        title: string;
    } | undefined;
    statusLabel: string;
    statusToneClassName: string;
};
export type ViewerTruthAuctionBidRowsViewModel = {
    rows: ViewerTruthAuctionBidRowViewModel[];
    showSettlementActionColumn: boolean;
};
export declare function buildTruthAuctionBidRows({ bids, truthAuction }: {
    bids: TruthAuctionBidView[];
    truthAuction: TruthAuctionMetrics | undefined;
}): TruthAuctionBidRowViewModel[];
export declare function buildViewerTruthAuctionBidRows({ accountAddress, isSettlementInProgress, selectedBidKeys, selectedStage, settlementResultByKey, truthAuction, viewerBids, }: {
    accountAddress: Address | undefined;
    isSettlementInProgress: boolean;
    selectedBidKeys: string[];
    selectedStage: ForkWorkflowSelectionStage;
    settlementResultByKey: Record<string, LocalSettlementBidStatus>;
    truthAuction: TruthAuctionMetrics | undefined;
    viewerBids: TruthAuctionBidView[];
}): ViewerTruthAuctionBidRowsViewModel;
export declare function updateTruthAuctionSettlementBidSelection(currentKeys: string[], bidKey: string, checked: boolean): string[];
export {};
//# sourceMappingURL=truthAuctionBidViewModels.d.ts.map