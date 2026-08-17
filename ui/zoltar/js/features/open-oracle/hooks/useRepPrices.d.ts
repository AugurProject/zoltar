import type { RepPriceFailure } from '../../types.js';
type PriceSource = 'v4' | 'v3' | 'mock';
type RepPrices = {
    repPerEthPrice: bigint | undefined;
    repPerEthFailure: RepPriceFailure | undefined;
    repPerEthSource: PriceSource | undefined;
    repPerEthSourceUrl: string | undefined;
    repUsdcPrice: bigint | undefined;
    repUsdcFailure: RepPriceFailure | undefined;
    repUsdcSource: PriceSource | undefined;
    repUsdcSourceUrl: string | undefined;
    isLoadingRepPrices: boolean;
    isRefreshingRepPrices: boolean;
    refreshRepPrices: () => void;
};
type UseRepPricesOptions = {
    enabled?: boolean;
};
export declare function resetRepPriceCacheForTesting(): void;
export declare function useRepPrices({ enabled }?: UseRepPricesOptions): RepPrices;
export {};
//# sourceMappingURL=useRepPrices.d.ts.map