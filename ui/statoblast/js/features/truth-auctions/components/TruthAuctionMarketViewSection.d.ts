import type { ComponentChildren } from 'preact';
import { type TruthAuctionDepthPoint } from '../lib/truthAuctionBook.js';
type TruthAuctionMarketViewSectionProps = {
    clearingTick: bigint | undefined;
    hasMoreTickSummaries: boolean;
    loadingTruthAuctionBook: boolean;
    maxTickAttoEth: bigint;
    onLoadNextTickPage: () => void;
    onSelectTick: (tick: bigint) => void;
    renderPriceValue: (value: bigint | undefined) => ComponentChildren;
    showDepthClearingTick: boolean;
    truthAuctionBookError: string | undefined;
    truthAuctionDepthPoints: TruthAuctionDepthPoint[];
};
export declare function TruthAuctionMarketViewSection({ clearingTick, hasMoreTickSummaries, loadingTruthAuctionBook, maxTickAttoEth, onLoadNextTickPage, onSelectTick, renderPriceValue, showDepthClearingTick, truthAuctionBookError, truthAuctionDepthPoints }: TruthAuctionMarketViewSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TruthAuctionMarketViewSection.d.ts.map