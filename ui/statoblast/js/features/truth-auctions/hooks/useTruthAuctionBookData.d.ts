import { type Address } from '@zoltar/shared/ethereum';
import type { ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js';
import type { ReadClient, TruthAuctionBidView, TruthAuctionTickSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type TruthAuctionBookData = {
    tickSummaries: TruthAuctionTickSummary[];
    tickCount: bigint;
    viewerBids: TruthAuctionBidView[];
    viewerBidCount: bigint;
};
type UseTruthAuctionBookDataParams = {
    accountAddress: Address | undefined;
    enteredBidTick: bigint | undefined;
    forkAuctionResultHash: string | undefined;
    selectedStage: ForkWorkflowSelectionStage;
    shouldShowTruthAuctionVisualization: boolean;
    truthAuctionAddress: Address | undefined;
    truthAuctionClearingTick: bigint | undefined;
    truthAuctionReadClient: Pick<ReadClient, 'readContract'> | ReadClient | undefined;
};
export declare function useTruthAuctionBookData({ accountAddress, enteredBidTick, forkAuctionResultHash, selectedStage, shouldShowTruthAuctionVisualization, truthAuctionAddress, truthAuctionClearingTick, truthAuctionReadClient }: UseTruthAuctionBookDataParams): {
    aggregatedAuctionBidCountForLoadedTicks: bigint;
    aggregatedAuctionBids: TruthAuctionBidView[];
    hasMoreAggregatedAuctionBids: boolean;
    hasMoreTickSummaries: boolean;
    hasMoreViewerBids: boolean;
    hasLoadedAggregatedAuctionBids: boolean;
    hasLoadedTruthAuctionBook: boolean;
    hasLoadedViewerTruthAuctionBids: boolean;
    loadNextAuctionBidPage: () => void;
    loadNextTickPage: () => void;
    loadNextViewerBidPage: () => void;
    loadingAggregatedAuctionBids: boolean;
    loadingTruthAuctionBook: boolean;
    loadingViewerTruthAuctionBids: boolean;
    retryingPublicTruthAuctionBook: boolean;
    retryingViewerTruthAuctionBids: boolean;
    retryPublicTruthAuctionBook: () => void;
    retryViewerTruthAuctionBids: () => void;
    selectTruthAuctionTick: (tick: bigint) => void;
    selectedBookTick: bigint | undefined;
    truthAuctionBookData: TruthAuctionBookData;
    truthAuctionBookError: string | undefined;
    viewerTruthAuctionBidsError: string | undefined;
};
export {};
//# sourceMappingURL=useTruthAuctionBookData.d.ts.map