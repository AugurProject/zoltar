import type { SecurityPoolActionId, SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage } from './types.js'

type ActionList = readonly SecurityPoolActionId[]

export const ALL_SECURITY_POOL_ACTIONS: ActionList = [
	'approveRep',
	'depositRep',
	'queueWithdrawRep',
	'redeemRep',
	'queueSetSecurityBondAllowance',
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
	'migrateEscalationDeposits',
	'migrateUnresolvedEscalation',
	'startTruthAuction',
	'submitBid',
	'finalizeTruthAuction',
	'refundLosingBids',
	'claimAuctionProceeds',
	'settleForkedEscalation',
]

export const LIFECYCLE_ACTIONS: ActionList = ['approveRep', 'depositRep', 'queueWithdrawRep', 'redeemRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'migrateShares', 'redeemShares', 'requestPrice', 'executeStagedOperation', 'queueLiquidation']

export const REPORTING_ACTIONS: ActionList = ['reportOutcome', 'withdrawEscalation']

export const FORK_ACTIONS: ActionList = [
	'forkWithOwnEscalation',
	'initiateFork',
	'forkUniverse',
	'createChildUniverse',
	'migrateRepToZoltar',
	'migrateVault',
	'migrateEscalationDeposits',
	'migrateUnresolvedEscalation',
	'startTruthAuction',
	'submitBid',
	'finalizeTruthAuction',
	'refundLosingBids',
	'claimAuctionProceeds',
	'settleForkedEscalation',
]

export const ENABLED_ACTIONS_BY_LIFECYCLE: Record<SecurityPoolLifecycleState, ActionList> = {
	operational: ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'],
	ended: ['redeemRep', 'redeemFees', 'redeemCompleteSet', 'redeemShares', 'requestPrice'],
	poolForked: ['redeemFees'],
	forkMigration: ['redeemFees'],
	forkTruthAuction: ['redeemFees'],
}

export const ENABLED_ACTIONS_BY_REPORTING_STAGE: Record<SecurityPoolReportingStage, ActionList> = {
	preOpen: [],
	notStarted: ['reportOutcome'],
	activeLocked: ['reportOutcome'],
	activeWithdrawable: ['reportOutcome', 'withdrawEscalation'],
	resolved: ['withdrawEscalation'],
	forkTriggered: [],
	timedOut: [],
}

export const ENABLED_ACTIONS_BY_FORK_STAGE: Record<SecurityPoolForkStage, ActionList> = {
	disabled: [],
	initiate: ['forkWithOwnEscalation', 'initiateFork', 'forkUniverse'],
	migration: ['createChildUniverse', 'migrateRepToZoltar', 'migrateVault', 'migrateEscalationDeposits', 'migrateUnresolvedEscalation', 'startTruthAuction'],
	auction: ['submitBid', 'finalizeTruthAuction', 'refundLosingBids'],
	settlement: ['claimAuctionProceeds', 'settleForkedEscalation'],
}

export const UNIVERSE_FORKED_ENABLE: ActionList = ['migrateShares']
export const UNIVERSE_FORKED_DISABLE: ActionList = ['createCompleteSet', 'redeemCompleteSet', 'redeemShares']
