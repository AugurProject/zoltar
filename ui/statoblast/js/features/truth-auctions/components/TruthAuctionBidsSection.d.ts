import type { ComponentChildren } from 'preact';
import type { Address } from '@zoltar/shared/ethereum';
import type { TruthAuctionBidRowViewModel, ViewerTruthAuctionBidRowViewModel } from '../lib/truthAuctionBidViewModels.js';
type TruthAuctionBidsSectionProps = {
    aggregatedAuctionBidCountForLoadedTicks: bigint;
    error?: string | undefined;
    hasLoadedData?: boolean;
    hasMoreAggregatedAuctionBids: boolean;
    loadedTickCount: number;
    loadingAggregatedAuctionBids: boolean;
    onLoadNextAuctionBidPage: () => void;
    onRetry?: (() => void) | undefined;
    renderPriceValue: (value: bigint | undefined) => ComponentChildren;
    retrying?: boolean;
    rows: TruthAuctionBidRowViewModel[];
};
type ViewerTruthAuctionBidsSectionProps = {
    accountAddress: Address | undefined;
    error?: string | undefined;
    hasLoadedData?: boolean;
    hasMoreViewerBids: boolean;
    loadingTruthAuctionBook: boolean;
    onLoadNextViewerBidPage: () => void;
    onRetry?: (() => void) | undefined;
    onSettlementBidSelectionChange: (bidKey: string, checked: boolean) => void;
    renderPriceValue: (value: bigint | undefined) => ComponentChildren;
    retrying?: boolean;
    rows: ViewerTruthAuctionBidRowViewModel[];
    showSettlementActionColumn: boolean;
};
export declare function TruthAuctionBidsSection({ aggregatedAuctionBidCountForLoadedTicks, error, hasLoadedData, hasMoreAggregatedAuctionBids, loadedTickCount, loadingAggregatedAuctionBids, onLoadNextAuctionBidPage, onRetry, renderPriceValue, retrying, rows }: TruthAuctionBidsSectionProps): import("preact").JSX.Element;
export declare function ViewerTruthAuctionBidsSection({ accountAddress, error, hasLoadedData, hasMoreViewerBids, loadingTruthAuctionBook, onLoadNextViewerBidPage, onRetry, onSettlementBidSelectionChange, renderPriceValue, retrying, rows, showSettlementActionColumn }: ViewerTruthAuctionBidsSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TruthAuctionBidsSection.d.ts.map