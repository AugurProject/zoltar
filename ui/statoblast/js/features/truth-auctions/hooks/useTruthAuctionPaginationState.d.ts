import type { Address } from '@zoltar/shared/ethereum';
export declare function useTruthAuctionPaginationState({ accountAddress, truthAuctionAddress }: {
    accountAddress: Address | undefined;
    truthAuctionAddress: Address | undefined;
}): {
    loadedTickPageCount: number;
    loadedViewerBidPageCount: number;
    loadedAuctionBidPageCount: number;
    loadNextTickPage: () => void;
    loadNextViewerBidPage: () => void;
    loadNextAuctionBidPage: () => void;
};
//# sourceMappingURL=useTruthAuctionPaginationState.d.ts.map