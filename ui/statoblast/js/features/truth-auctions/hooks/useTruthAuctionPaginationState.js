import { useEffect, useState } from 'preact/hooks';
export function useTruthAuctionPaginationState({ accountAddress, truthAuctionAddress }) {
    const [loadedTickPageCount, setLoadedTickPageCount] = useState(1);
    const [loadedViewerBidPageCount, setLoadedViewerBidPageCount] = useState(1);
    const [loadedAuctionBidPageCount, setLoadedAuctionBidPageCount] = useState(1);
    useEffect(() => {
        setLoadedTickPageCount(1);
        setLoadedViewerBidPageCount(1);
        setLoadedAuctionBidPageCount(1);
    }, [accountAddress, truthAuctionAddress]);
    return {
        loadedTickPageCount,
        loadedViewerBidPageCount,
        loadedAuctionBidPageCount,
        loadNextTickPage: () => setLoadedTickPageCount(currentPageCount => currentPageCount + 1),
        loadNextViewerBidPage: () => setLoadedViewerBidPageCount(currentPageCount => currentPageCount + 1),
        loadNextAuctionBidPage: () => setLoadedAuctionBidPageCount(currentPageCount => currentPageCount + 1),
    };
}
//# sourceMappingURL=useTruthAuctionPaginationState.js.map