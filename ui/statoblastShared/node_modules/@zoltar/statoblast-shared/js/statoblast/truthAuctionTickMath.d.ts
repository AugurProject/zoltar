export declare const TRUTH_AUCTION_PRICE_PRECISION: bigint;
export declare const TRUTH_AUCTION_MIN_TICK = -524288n;
export declare const TRUTH_AUCTION_MAX_TICK = 524288n;
export declare function assertTruthAuctionTickInContractDomain(tick: bigint): void;
export declare function tickToPrice(tick: bigint): bigint;
export declare function priceToClosestTick(price: bigint): bigint;
export declare function findTruthAuctionMinSupportedTick(): bigint;
