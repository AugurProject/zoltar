import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { getTimeRemaining as getSharedTimeRemaining } from '@zoltar/ui-core-shared/lib/time.js';
import { getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js';
import { deriveHasForkActivity } from '@zoltar/ui-zoltar/protocol/forkActivity.js';
export { deriveHasForkActivity };
const SECONDS_PER_WEEK = 7n * 24n * 60n * 60n;
export const AUCTION_TIME_SECONDS = SECONDS_PER_WEEK;
export const AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL = 'Auctioned capacity ownership';
const FORK_AUCTION_STAGE_LABELS = {
    initiate: 'Trigger',
    migration: 'Migration',
    auction: 'Truth Auction',
    settlement: 'Settlement',
};
const FORK_AUCTION_STAGE_ORDER = {
    initiate: 0,
    migration: 1,
    auction: 2,
    settlement: 3,
};
export function getOutcomeActionLabel(outcome) {
    return getReportingOutcomeLabel(outcome);
}
export function getForkStageDescriptionForState(state) {
    switch (state) {
        case 'operational':
            return 'This pool is operational. If it is a child universe, the fork and auction path has completed.';
        case 'poolForked':
            return 'The parent pool has forked. Child universes can now be created and REP can migrate.';
        case 'forkMigration':
            return 'Migration is active. Vault state and REP can move into child universes before the truth auction starts. Unresolved escalation is already represented by each child snapshot and aggregate backing; winning parent deposits may instead be claimed directly.';
        case 'forkTruthAuction':
            return `Truth auction is active. Winning bidders later claim REP backing units plus a pro-rata share of the ${AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL}, which is the remaining capacity ownership carried into the child pool.`;
        default:
            return assertNever(state);
    }
}
export function getForkAuctionStageLabel(stage) {
    return FORK_AUCTION_STAGE_LABELS[stage];
}
export function getForkAuctionStageOrder(stage) {
    return FORK_AUCTION_STAGE_ORDER[stage];
}
export function hasForkActivity(pool) {
    return deriveHasForkActivity(pool);
}
export function getForkAuctionStageView(source) {
    if (source.truthAuction !== undefined) {
        if (!source.truthAuction.finalized)
            return 'auction';
        return 'settlement';
    }
    if (source.systemState === 'forkTruthAuction')
        return 'auction';
    if (source.claimingAvailable === true)
        return 'settlement';
    if (source.systemState === 'operational' && hasForkActivity(source))
        return 'settlement';
    if (source.systemState === 'poolForked' || source.systemState === 'forkMigration' || source.migratedAttoRep > 0n)
        return 'migration';
    return 'initiate';
}
export function getTimeRemaining(targetTime, currentTime) {
    return getSharedTimeRemaining(targetTime, currentTime);
}
//# sourceMappingURL=forkAuction.js.map