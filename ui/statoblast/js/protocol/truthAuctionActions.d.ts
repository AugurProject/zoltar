import { type Address } from '@zoltar/shared/ethereum';
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function startTruthAuctionForSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function submitTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
type TruthAuctionSettlementBidIdentifier = {
    tick: bigint;
    bidIndex: bigint;
};
type TruthAuctionSettlementBidBatch = readonly TruthAuctionSettlementBidIdentifier[];
export declare function refundTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, selectedBids?: readonly TruthAuctionSettlementBidIdentifier[]): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function settleTruthAuctionBids(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, claimTickIndices: TruthAuctionSettlementBidBatch, refundTickIndices: TruthAuctionSettlementBidBatch): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function finalizeSecurityPoolTruthAuction(client: WriteClient, securityPoolAddress: Address, universeId: bigint): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export {};
//# sourceMappingURL=truthAuctionActions.d.ts.map