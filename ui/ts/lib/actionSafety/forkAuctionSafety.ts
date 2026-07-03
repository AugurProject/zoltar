import { createReasonedActionSafetyEntry, createReasonedActionSafetyFixtures } from './reasoned.js'

export const FORK_AUCTION_ACTION_SAFETY_ENTRIES = [
	createReasonedActionSafetyEntry('fork-auction.claimAuctionProceeds', 'Claim Auction Proceeds', createReasonedActionSafetyFixtures('Claim Auction Proceeds')),
	createReasonedActionSafetyEntry('fork-auction.createChildUniverse', 'Create Child Universe', createReasonedActionSafetyFixtures('Create Child Universe')),
	createReasonedActionSafetyEntry('fork-auction.finalizeTruthAuction', 'Finalize Truth Auction', createReasonedActionSafetyFixtures('Finalize Truth Auction')),
	createReasonedActionSafetyEntry('fork-auction.forkZoltar', 'Fork Zoltar', createReasonedActionSafetyFixtures('Fork Zoltar')),
	createReasonedActionSafetyEntry('fork-auction.forkUniverse', 'Fork Universe', createReasonedActionSafetyFixtures('Fork Universe')),
	createReasonedActionSafetyEntry('fork-auction.forkWithOwnEscalation', 'Trigger Zoltar Fork', createReasonedActionSafetyFixtures('Trigger Zoltar Fork')),
	createReasonedActionSafetyEntry('fork-auction.initiateFork', 'Initiate Fork', createReasonedActionSafetyFixtures('Initiate Fork')),
	createReasonedActionSafetyEntry('fork-auction.migrateEscalationDeposits', 'Migrate Escalation Deposits', createReasonedActionSafetyFixtures('Migrate Escalation Deposits')),
	createReasonedActionSafetyEntry('fork-auction.migrateRepToZoltar', 'Migrate REP To Zoltar', createReasonedActionSafetyFixtures('Migrate REP To Zoltar')),
	createReasonedActionSafetyEntry('fork-auction.migrateUnresolvedEscalation', 'Migrate Unresolved Escalation', createReasonedActionSafetyFixtures('Migrate Unresolved Escalation')),
	createReasonedActionSafetyEntry('fork-auction.migrateVault', 'Migrate Vault', createReasonedActionSafetyFixtures('Migrate Vault')),
	createReasonedActionSafetyEntry('fork-auction.refundLosingBids', 'Refund Losing Bids', createReasonedActionSafetyFixtures('Refund Losing Bids')),
	createReasonedActionSafetyEntry('fork-auction.settleAuctionRefunds', 'Settle Finalized Refunds', createReasonedActionSafetyFixtures('Settle Finalized Refunds')),
	createReasonedActionSafetyEntry('fork-auction.settleForkedEscalation', 'Settle Forked Escalation', createReasonedActionSafetyFixtures('Settle Forked Escalation')),
	createReasonedActionSafetyEntry('fork-auction.startTruthAuction', 'Start Truth Auction', createReasonedActionSafetyFixtures('Start Truth Auction')),
	createReasonedActionSafetyEntry('fork-auction.submitBid', 'Submit Bid', createReasonedActionSafetyFixtures('Submit Bid')),
] as const
