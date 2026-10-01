import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

export type { AccountState, TransactionCancellationParameters, TransactionLifecycleParameters, WriteOperationContext, WriteOperationsParameters } from '@zoltar/ui-core-shared/types/app.js'
export type { MarketFormState } from '@zoltar/ui-zoltar-shared/types/app.js'

export const STATOBLAST_ROUTES = ['deploy', 'pools', 'open-oracle', 'not-found'] as const
export type StatoblastRoute = (typeof STATOBLAST_ROUTES)[number]

export type SecurityPoolFormState = {
	initialReportPriorityFeeNanoEth: string
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

export type OpenOracleFormState = {
	amount1: string
	amount2: string
	disputeNewAmount1: string
	disputeNewAmount2: string
	disputeTokenToSwap: 'token1' | 'token2'
	reportId: string
	stateHash: string
}

export type OpenOracleCreateFormState = {
	ethValue: string
	exactToken1Report: string
	initialToken2Amount: string
	escalationHalt: string
	feePercentage: string
	multiplier: string
	protocolFee: string
	settlementTime: string
	settlerRewardEthAmount: string
	token1Address: string
	token2Address: string
	disputeDelay: string
}

export type ReportingWithdrawDepositIndexesByOutcome = {
	invalid: bigint[]
	yes: bigint[]
	no: bigint[]
}

export type ReportingFormState = {
	contributionFunding?: 'vault' | 'wallet' | undefined
	reportAmount: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedWithdrawDepositIndexesByOutcome: ReportingWithdrawDepositIndexesByOutcome
}

export type SelectedVaultView = 'browse-vaults' | 'selected-vault' | 'vault-by-address'
export type SecurityPoolLifecycleState = 'operational' | 'ended' | 'poolForked' | 'forkMigration' | 'forkTruthAuction'
export type PoolSortKey = 'recent' | 'remainingCapacity' | 'endTime' | 'state'
export type PoolStateFilter = 'all' | SecurityPoolLifecycleState
export type PoolBrowseState = {
	searchText: string
	sortKey: PoolSortKey
	stateFilter: PoolStateFilter
}
