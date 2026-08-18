export const ALL_SECURITY_POOL_ACTIONS = [
    'approveRep',
    'depositRepToVault',
    'queueWithdrawRep',
    'redeemRepFromVault',
    'redeemFees',
    'createCompleteSet',
    'redeemCompleteSet',
    'migrateShares',
    'redeemShares',
    'reportOutcome',
    'withdrawEscalation',
    'requestPrice',
    'executeStagedOperation',
    'queueLiquidation',
    'forkWithOwnEscalation',
    'initiateFork',
    'forkUniverse',
    'createChildUniverse',
    'migrateRepToZoltar',
    'migrateVault',
    'claimParentEscalationDeposits',
    'migrateUnresolvedEscalation',
    'startTruthAuction',
    'submitBid',
    'finalizeTruthAuction',
    'refundLosingBids',
    'claimAuctionProceeds',
    'settleForkedEscalation',
];
export const LIFECYCLE_ACTIONS = ['approveRep', 'depositRepToVault', 'queueWithdrawRep', 'redeemRepFromVault', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'migrateShares', 'redeemShares', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'];
export const REPORTING_ACTIONS = ['reportOutcome', 'withdrawEscalation'];
export const FORK_ACTIONS = [
    'forkWithOwnEscalation',
    'initiateFork',
    'forkUniverse',
    'createChildUniverse',
    'migrateRepToZoltar',
    'migrateVault',
    'claimParentEscalationDeposits',
    'migrateUnresolvedEscalation',
    'startTruthAuction',
    'submitBid',
    'finalizeTruthAuction',
    'refundLosingBids',
    'claimAuctionProceeds',
    'settleForkedEscalation',
];
export const ENABLED_ACTIONS_BY_LIFECYCLE = {
    operational: ['approveRep', 'depositRepToVault', 'queueWithdrawRep', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'],
    ended: ['redeemRepFromVault', 'redeemFees', 'redeemCompleteSet', 'redeemShares', 'requestPrice'],
    poolForked: ['redeemFees'],
    forkMigration: ['redeemFees'],
    forkTruthAuction: ['redeemFees'],
};
export const ENABLED_ACTIONS_BY_REPORTING_STAGE = {
    preOpen: [],
    notStarted: ['reportOutcome'],
    activeLocked: ['reportOutcome'],
    activeWithdrawable: ['reportOutcome', 'withdrawEscalation'],
    resolved: ['withdrawEscalation'],
    forkTriggered: [],
    timedOut: [],
};
export const ENABLED_ACTIONS_BY_FORK_STAGE = {
    disabled: [],
    initiate: ['forkWithOwnEscalation', 'initiateFork', 'forkUniverse'],
    migration: ['createChildUniverse', 'migrateRepToZoltar', 'migrateVault', 'claimParentEscalationDeposits', 'migrateUnresolvedEscalation', 'startTruthAuction'],
    auction: ['submitBid', 'finalizeTruthAuction', 'refundLosingBids'],
    settlement: ['claimAuctionProceeds', 'settleForkedEscalation'],
};
export const UNIVERSE_FORKED_ENABLE = ['migrateShares'];
export const UNIVERSE_FORKED_DISABLE = ['createCompleteSet', 'redeemCompleteSet', 'redeemShares'];
//# sourceMappingURL=matrix.js.map