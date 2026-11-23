import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

export type { AccountState, WriteOperationsParameters } from '@zoltar/ui-core-shared/types/app.js'

export const STATOBLAST_ROUTES = ['deploy', 'pools', 'securityPools', 'open-oracle', 'not-found'] as const
export type StatoblastRoute = (typeof STATOBLAST_ROUTES)[number]

export type TradingFormState = {
	completeSetAmount: string
	redeemAmount: string
	questionLedgerAddress: string
	selectedShareOutcome: ReportingOutcomeKey
	targetOutcomeIndexes: string
}

export type OpenOracleFormState = {
	amount1: string
	amount2: string
	disputeNewAmount1: string
	disputeNewAmount2: string
	reportId: string
	stateHash: string
}

export type OpenOracleCreateFormState = {
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
	questionLedgerAddress: string
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedWithdrawDepositIndexesByOutcome: ReportingWithdrawDepositIndexesByOutcome
}

export type SelectedVaultView = 'browse-vaults' | 'selected-vault' | 'vault-by-address'
export type QuestionLedgerLifecycleState = 'operational' | 'ended' | 'poolForked' | 'forkMigration'
export type PoolSortKey = 'recent' | 'remainingCapacity' | 'endTime' | 'state'
/** Browse filters use the pool badge vocabulary: a forked pool's badge reads Fork migration, so it filters with fork migration instead of on its own. */
export type PoolStateFilter = 'all' | Exclude<QuestionLedgerLifecycleState, 'poolForked'>
export type PoolBrowseState = {
	searchText: string
	sortKey: PoolSortKey
	stateFilter: PoolStateFilter
}
