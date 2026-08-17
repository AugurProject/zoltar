import type { Address, Hash } from '@zoltar/shared/ethereum';
import type { ForkAuctionAction, ReadClient, WriteClient } from '../types/contracts.js';
export declare function readSecurityPoolUniverseId(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address): Promise<bigint>;
export declare function executeForkAuctionAction(client: WriteClient, action: ForkAuctionAction, securityPoolAddress: Address, universeId: bigint, request: () => Promise<Hash>): Promise<{
    action: ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
//# sourceMappingURL=securityPoolActions.d.ts.map