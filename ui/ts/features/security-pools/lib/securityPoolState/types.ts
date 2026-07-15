export type SecurityPoolLifecycleState = 'operational' | 'ended' | 'poolForked' | 'forkMigration' | 'forkTruthAuction'

export type SecurityPoolReportingStage = 'preOpen' | 'notStarted' | 'activeLocked' | 'activeWithdrawable' | 'resolved' | 'forkTriggered' | 'timedOut'

export type SecurityPoolForkStage = 'disabled' | 'initiate' | 'migration' | 'auction' | 'settlement'

export type SecurityPoolActionId =
	| 'approveRep'
	| 'depositRep'
	| 'queueWithdrawRep'
	| 'redeemRep'
	| 'queueSetSecurityBondAllowance'
	| 'redeemFees'
	| 'createCompleteSet'
	| 'redeemCompleteSet'
	| 'migrateShares'
	| 'redeemShares'
	| 'reportOutcome'
	| 'withdrawEscalation'
	| 'requestPrice'
	| 'executeStagedOperation'
	| 'queueLiquidation'
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'forkUniverse'
	| 'createChildUniverse'
	| 'migrateRepToZoltar'
	| 'migrateVault'
	| 'migrateEscalationDeposits'
	| 'migrateUnresolvedEscalation'
	| 'startTruthAuction'
	| 'submitBid'
	| 'finalizeTruthAuction'
	| 'refundLosingBids'
	| 'claimAuctionProceeds'
	| 'settleForkedEscalation'

export type SecurityPoolActionState = {
	enabled: boolean
}

export type SecurityPoolStateInput = {
	lifecycleState?: SecurityPoolLifecycleState | undefined
	reportingStage?: SecurityPoolReportingStage | undefined
	forkStage?: SecurityPoolForkStage | undefined
	universeHasForked: boolean
}

export type SecurityPoolStateModel = {
	lifecycleState?: SecurityPoolLifecycleState | undefined
	reportingStage?: SecurityPoolReportingStage | undefined
	forkStage?: SecurityPoolForkStage | undefined
	universeHasForked: boolean
	actions: Record<SecurityPoolActionId, SecurityPoolActionState>
}
