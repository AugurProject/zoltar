import type { Address } from '@zoltar/shared/ethereum';
import type { ReadClient, TruthAuctionBidderBidPage, TruthAuctionTickBidPage, TruthAuctionTickPage, TruthAuctionTickSummary } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function loadTruthAuctionTickSummary(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint): Promise<TruthAuctionTickSummary>;
export declare function loadTruthAuctionTickPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionTickPage>;
export declare function loadTruthAuctionActiveTickPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionTickPage>;
export declare function loadTruthAuctionTickBidPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint, pageIndex: number, pageSize: number): Promise<TruthAuctionTickBidPage>;
export declare function loadTruthAuctionBidderBidPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, bidder: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionBidderBidPage>;
//# sourceMappingURL=truthAuctions.d.ts.map