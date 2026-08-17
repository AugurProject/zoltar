import type { Address } from '@zoltar/shared/ethereum';
type ForkDataView = {
    auctionableAttoRepAtFork: bigint;
    truthAuctionAddress: Address;
    truthAuctionStartedAt: bigint;
    migratedAttoRep: bigint;
    auctionedCapacityOwnershipAttoRep: bigint;
    escalationElapsedAtFork: bigint;
    escalationStartBondAtForkAttoRep: bigint;
    escalationNonDecisionThresholdAtForkAttoRep: bigint;
    forkOwnSecurityPool: boolean;
    unresolvedEscalationAtFork: boolean;
    forkOutcomeIndex: bigint;
};
export declare function requireForkDataView(value: unknown): ForkDataView;
export {};
//# sourceMappingURL=forkData.d.ts.map