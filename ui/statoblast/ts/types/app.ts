import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

export type { AccountState, WriteOperationsParameters } from '@zoltar/ui-core-shared/types/app.js'
export type { MarketFormState } from '@zoltar/ui-zoltar/types/app.js'

export type Route = 'deploy' | 'security-pools' | 'open-oracle' | 'not-found'

export type SecurityPoolFormState = {
	initialReportPriorityFeeGwei: string
	marketId: string
	statoblastSecurityMultiplierBps: string
}

export type SecurityVaultFormState = {
	depositAmount: string
	targetHealthFactor: string
	repWithdrawAmount: string
	selectedVaultOwner: string
	securityPoolAddress: string
	stagedOperationTimeoutMinutes?: string
}

export type TradingFormState = {
	completeSetAmount: string
	redeemAmount: string
	securityPoolAddress: string
	selectedShareOutcome: ReportingOutcomeKey
	targetOutcomeIndexes: string
}

export type ForkAuctionFormState = {
	claimBidIndex: string
	claimBidTick: string
	depositIndexes: string
	directForkQuestionId: string
	directForkUniverseId: string
	refundBidIndex: string
	refundTick: string
	repMigrationOutcomes: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey
	settlementAddress: string
	submitBidAmount: string
	submitBidPrice: string
	vaultAddress: string
}
