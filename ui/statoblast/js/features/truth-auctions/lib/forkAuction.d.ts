import type { ForkOutcomeKey, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js';
import { deriveHasForkActivity } from '@zoltar/ui-zoltar/protocol/forkActivity.js';
export { deriveHasForkActivity };
export declare const AUCTION_TIME_SECONDS: bigint;
export declare const AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL = "Auctioned capacity ownership";
export type ForkAuctionStageView = 'initiate' | 'migration' | 'auction' | 'settlement';
type ForkAuctionStageSource = {
    claimingAvailable?: boolean;
    forkOutcome: ForkOutcomeKey;
    migratedAttoRep: bigint;
    systemState: SecurityPoolSystemState;
    truthAuction?: Pick<TruthAuctionMetrics, 'finalized'> | undefined;
    truthAuctionStartedAt: bigint;
};
export declare function getOutcomeActionLabel(outcome: ReportingOutcomeKey): "Yes" | "No" | "Invalid" | "Unresolved";
export declare function getForkStageDescriptionForState(state: SecurityPoolSystemState): "This pool is operational. If it is a child universe, the fork and auction path has completed." | "The parent pool has forked. Child universes can now be created and REP can migrate." | "Migration is active. Vault state and REP can move into child universes before the truth auction starts. Unresolved escalation is already represented by each child snapshot and aggregate backing; winning parent deposits may instead be claimed directly." | "Truth auction is active. Winning bidders later claim REP backing units plus a pro-rata share of the Auctioned capacity ownership, which is the remaining capacity ownership carried into the child pool.";
export declare function getForkAuctionStageLabel(stage: ForkAuctionStageView): string;
export declare function getForkAuctionStageOrder(stage: ForkAuctionStageView): number;
export declare function hasForkActivity(pool: Parameters<typeof deriveHasForkActivity>[0]): boolean;
export declare function getForkAuctionStageView(source: ForkAuctionStageSource): ForkAuctionStageView;
export declare function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint): bigint | undefined;
//# sourceMappingURL=forkAuction.d.ts.map