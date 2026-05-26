import {
	FORK_AUCTION_STAGE_MESSAGE,
	FORK_INITIATE_STAGE_MESSAGE,
	FORK_MIGRATION_STAGE_MESSAGE,
	FORK_SETTLEMENT_STAGE_MESSAGE,
	FORK_WORKFLOW_DISABLED_MESSAGE,
	LIQUIDATION_ENDED_REASON,
	MARKET_ALREADY_FINALIZED_MESSAGE,
	MARKET_NOT_FINALIZED_MESSAGE,
	MINT_AFTER_FORK_MESSAGE,
	MINT_NON_OPERATIONAL_MESSAGE,
	POOL_ACTION_LOCK_REASON,
	REDEEM_COMPLETE_SETS_AFTER_FORK_MESSAGE,
	REDEEM_COMPLETE_SETS_NON_OPERATIONAL_MESSAGE,
	REDEEM_REP_NOT_ENDED_MESSAGE,
	REDEEM_RESOLVED_SHARES_AFTER_FORK_MESSAGE,
	REDEEM_RESOLVED_SHARES_NON_OPERATIONAL_MESSAGE,
	REPORTING_FORK_TRIGGERED_MESSAGE,
	REPORTING_NOT_OPEN_MESSAGE,
	REPORTING_RESOLVED_MESSAGE,
	REPORTING_TIMED_OUT_MESSAGE,
	SHARE_MIGRATION_AFTER_FORK_MESSAGE,
	WITHDRAW_ESCALATION_FORK_TRIGGERED_MESSAGE,
	WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE,
	WITHDRAW_ESCALATION_NOT_STARTED_MESSAGE,
} from './messages.js'
import type { SecurityPoolActionId, SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage } from './types.js'

type ActionList = readonly SecurityPoolActionId[]
type ActionReasonMap = Partial<Record<SecurityPoolActionId, string>>

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
	'startTruthAuction',
	'submitBid',
	'finalizeTruthAuction',
	'refundLosingBids',
	'claimAuctionProceeds',
	'withdrawBids',
]

export const LIFECYCLE_ACTIONS: ActionList = ['approveRep', 'depositRep', 'queueWithdrawRep', 'redeemRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'migrateShares', 'redeemShares', 'requestPrice', 'executeStagedOperation', 'queueLiquidation']

export const REPORTING_ACTIONS: ActionList = ['reportOutcome', 'withdrawEscalation']

export const FORK_ACTIONS: ActionList = ['forkWithOwnEscalation', 'initiateFork', 'forkUniverse', 'createChildUniverse', 'migrateRepToZoltar', 'migrateVault', 'migrateEscalationDeposits', 'startTruthAuction', 'submitBid', 'finalizeTruthAuction', 'refundLosingBids', 'claimAuctionProceeds', 'withdrawBids']

export const ENABLED_ACTIONS_BY_LIFECYCLE: Record<SecurityPoolLifecycleState, ActionList> = {
	operational: ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'],
	ended: ['redeemRep', 'redeemFees', 'redeemCompleteSet', 'redeemShares', 'requestPrice'],
	poolForked: ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'],
	forkMigration: ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'],
	forkTruthAuction: ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'],
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
	migration: ['createChildUniverse', 'migrateRepToZoltar', 'migrateVault', 'migrateEscalationDeposits'],
	auction: ['startTruthAuction', 'submitBid'],
	settlement: ['finalizeTruthAuction', 'refundLosingBids', 'claimAuctionProceeds', 'withdrawBids'],
}

export const UNIVERSE_FORKED_ENABLE: ActionList = ['migrateShares']
export const UNIVERSE_FORKED_DISABLE: ActionList = ['createCompleteSet', 'redeemCompleteSet', 'redeemShares']

export const DISABLED_REASON_BY_LIFECYCLE: Record<SecurityPoolLifecycleState, ActionReasonMap> = {
	operational: {
		redeemRep: REDEEM_REP_NOT_ENDED_MESSAGE,
		migrateShares: SHARE_MIGRATION_AFTER_FORK_MESSAGE,
		redeemShares: MARKET_NOT_FINALIZED_MESSAGE,
	},
	ended: {
		approveRep: POOL_ACTION_LOCK_REASON,
		depositRep: POOL_ACTION_LOCK_REASON,
		queueWithdrawRep: POOL_ACTION_LOCK_REASON,
		queueSetSecurityBondAllowance: POOL_ACTION_LOCK_REASON,
		createCompleteSet: MARKET_ALREADY_FINALIZED_MESSAGE,
		migrateShares: SHARE_MIGRATION_AFTER_FORK_MESSAGE,
		executeStagedOperation: POOL_ACTION_LOCK_REASON,
		queueLiquidation: LIQUIDATION_ENDED_REASON,
	},
	poolForked: {
		redeemRep: REDEEM_REP_NOT_ENDED_MESSAGE,
		createCompleteSet: MINT_NON_OPERATIONAL_MESSAGE,
		redeemCompleteSet: REDEEM_COMPLETE_SETS_NON_OPERATIONAL_MESSAGE,
		migrateShares: SHARE_MIGRATION_AFTER_FORK_MESSAGE,
		redeemShares: REDEEM_RESOLVED_SHARES_NON_OPERATIONAL_MESSAGE,
	},
	forkMigration: {
		redeemRep: REDEEM_REP_NOT_ENDED_MESSAGE,
		createCompleteSet: MINT_NON_OPERATIONAL_MESSAGE,
		redeemCompleteSet: REDEEM_COMPLETE_SETS_NON_OPERATIONAL_MESSAGE,
		migrateShares: SHARE_MIGRATION_AFTER_FORK_MESSAGE,
		redeemShares: REDEEM_RESOLVED_SHARES_NON_OPERATIONAL_MESSAGE,
	},
	forkTruthAuction: {
		redeemRep: REDEEM_REP_NOT_ENDED_MESSAGE,
		createCompleteSet: MINT_NON_OPERATIONAL_MESSAGE,
		redeemCompleteSet: REDEEM_COMPLETE_SETS_NON_OPERATIONAL_MESSAGE,
		migrateShares: SHARE_MIGRATION_AFTER_FORK_MESSAGE,
		redeemShares: REDEEM_RESOLVED_SHARES_NON_OPERATIONAL_MESSAGE,
	},
}

export const DISABLED_REASON_BY_REPORTING_STAGE: Record<SecurityPoolReportingStage, ActionReasonMap> = {
	preOpen: {
		reportOutcome: REPORTING_NOT_OPEN_MESSAGE,
		withdrawEscalation: REPORTING_NOT_OPEN_MESSAGE,
	},
	notStarted: {
		withdrawEscalation: WITHDRAW_ESCALATION_NOT_STARTED_MESSAGE,
	},
	activeLocked: {
		withdrawEscalation: WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE,
	},
	activeWithdrawable: {},
	resolved: {
		reportOutcome: REPORTING_RESOLVED_MESSAGE,
	},
	forkTriggered: {
		reportOutcome: REPORTING_FORK_TRIGGERED_MESSAGE,
		withdrawEscalation: WITHDRAW_ESCALATION_FORK_TRIGGERED_MESSAGE,
	},
	timedOut: {
		reportOutcome: REPORTING_TIMED_OUT_MESSAGE,
		withdrawEscalation: WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE,
	},
}

export const DISABLED_REASON_BY_FORK_STAGE: Record<SecurityPoolForkStage, ActionReasonMap> = {
	disabled: {
		forkWithOwnEscalation: FORK_WORKFLOW_DISABLED_MESSAGE,
		initiateFork: FORK_WORKFLOW_DISABLED_MESSAGE,
		forkUniverse: FORK_WORKFLOW_DISABLED_MESSAGE,
		createChildUniverse: FORK_WORKFLOW_DISABLED_MESSAGE,
		migrateRepToZoltar: FORK_WORKFLOW_DISABLED_MESSAGE,
		migrateVault: FORK_WORKFLOW_DISABLED_MESSAGE,
		migrateEscalationDeposits: FORK_WORKFLOW_DISABLED_MESSAGE,
		startTruthAuction: FORK_WORKFLOW_DISABLED_MESSAGE,
		submitBid: FORK_WORKFLOW_DISABLED_MESSAGE,
		finalizeTruthAuction: FORK_WORKFLOW_DISABLED_MESSAGE,
		refundLosingBids: FORK_WORKFLOW_DISABLED_MESSAGE,
		claimAuctionProceeds: FORK_WORKFLOW_DISABLED_MESSAGE,
		withdrawBids: FORK_WORKFLOW_DISABLED_MESSAGE,
	},
	initiate: {
		createChildUniverse: FORK_MIGRATION_STAGE_MESSAGE,
		migrateRepToZoltar: FORK_MIGRATION_STAGE_MESSAGE,
		migrateVault: FORK_MIGRATION_STAGE_MESSAGE,
		migrateEscalationDeposits: FORK_MIGRATION_STAGE_MESSAGE,
		startTruthAuction: FORK_AUCTION_STAGE_MESSAGE,
		submitBid: FORK_AUCTION_STAGE_MESSAGE,
		finalizeTruthAuction: FORK_SETTLEMENT_STAGE_MESSAGE,
		refundLosingBids: FORK_SETTLEMENT_STAGE_MESSAGE,
		claimAuctionProceeds: FORK_SETTLEMENT_STAGE_MESSAGE,
		withdrawBids: FORK_SETTLEMENT_STAGE_MESSAGE,
	},
	migration: {
		forkWithOwnEscalation: FORK_INITIATE_STAGE_MESSAGE,
		initiateFork: FORK_INITIATE_STAGE_MESSAGE,
		forkUniverse: FORK_INITIATE_STAGE_MESSAGE,
		startTruthAuction: FORK_AUCTION_STAGE_MESSAGE,
		submitBid: FORK_AUCTION_STAGE_MESSAGE,
		finalizeTruthAuction: FORK_SETTLEMENT_STAGE_MESSAGE,
		refundLosingBids: FORK_SETTLEMENT_STAGE_MESSAGE,
		claimAuctionProceeds: FORK_SETTLEMENT_STAGE_MESSAGE,
		withdrawBids: FORK_SETTLEMENT_STAGE_MESSAGE,
	},
	auction: {
		forkWithOwnEscalation: FORK_INITIATE_STAGE_MESSAGE,
		initiateFork: FORK_INITIATE_STAGE_MESSAGE,
		forkUniverse: FORK_INITIATE_STAGE_MESSAGE,
		createChildUniverse: FORK_MIGRATION_STAGE_MESSAGE,
		migrateRepToZoltar: FORK_MIGRATION_STAGE_MESSAGE,
		migrateVault: FORK_MIGRATION_STAGE_MESSAGE,
		migrateEscalationDeposits: FORK_MIGRATION_STAGE_MESSAGE,
		finalizeTruthAuction: FORK_SETTLEMENT_STAGE_MESSAGE,
		refundLosingBids: FORK_SETTLEMENT_STAGE_MESSAGE,
		claimAuctionProceeds: FORK_SETTLEMENT_STAGE_MESSAGE,
		withdrawBids: FORK_SETTLEMENT_STAGE_MESSAGE,
	},
	settlement: {
		forkWithOwnEscalation: FORK_INITIATE_STAGE_MESSAGE,
		initiateFork: FORK_INITIATE_STAGE_MESSAGE,
		forkUniverse: FORK_INITIATE_STAGE_MESSAGE,
		createChildUniverse: FORK_MIGRATION_STAGE_MESSAGE,
		migrateRepToZoltar: FORK_MIGRATION_STAGE_MESSAGE,
		migrateVault: FORK_MIGRATION_STAGE_MESSAGE,
		migrateEscalationDeposits: FORK_MIGRATION_STAGE_MESSAGE,
		startTruthAuction: FORK_AUCTION_STAGE_MESSAGE,
		submitBid: FORK_AUCTION_STAGE_MESSAGE,
	},
}

export const DISABLED_REASON_BY_UNIVERSE_FORKED: ActionReasonMap = {
	createCompleteSet: MINT_AFTER_FORK_MESSAGE,
	redeemCompleteSet: REDEEM_COMPLETE_SETS_AFTER_FORK_MESSAGE,
	redeemShares: REDEEM_RESOLVED_SHARES_AFTER_FORK_MESSAGE,
}
