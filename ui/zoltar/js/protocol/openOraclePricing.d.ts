import { quoteExactInput } from './uniswapQuoter.js';
type OpenOracleInitialReportPriceSource = 'Uniswap V4' | 'Uniswap V3' | 'MOCK' | 'Manual override' | 'Unavailable';
export type OpenOracleInitialReportQuoteSource = Exclude<OpenOracleInitialReportPriceSource, 'Manual override' | 'Unavailable'>;
type OpenOracleInitialReportQuoteFailureKind = 'unsupported-pair' | 'quote-failed';
export type OpenOracleInitialReportPriceLoadResult = {
    status: 'success';
    price: bigint;
    priceSource: OpenOracleInitialReportQuoteSource;
    priceSourceUrl: string | undefined;
    token2Amount: bigint;
} | {
    attemptedSources: OpenOracleInitialReportQuoteSource[];
    failureKind: OpenOracleInitialReportQuoteFailureKind;
    reason: string | undefined;
    status: 'failure';
};
export declare function loadOpenOracleInitialReportPriceResult(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<OpenOracleInitialReportPriceLoadResult>;
export declare function loadOpenOracleInitialReportPrice(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<{
    price: bigint;
    priceSource: OpenOracleInitialReportQuoteSource;
    token2Amount: bigint;
}>;
export {};
//# sourceMappingURL=openOraclePricing.d.ts.map