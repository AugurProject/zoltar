import type { MarketType, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

export type { AccountState, TransactionCancellationParameters, TransactionLifecycleParameters, WriteOperationContext, WriteOperationsParameters } from '@zoltar/ui-core-shared/types/app.js'

export type Route = 'deploy' | 'zoltar' | 'not-found'

export type MarketFormState = {
	answerUnit: string
	categoricalOutcomes: string[]
	description: string
	scalarIncrement: string
	scalarMax: string
	scalarMin: string
	title: string
	endTime: string
	marketType: MarketType
	startTime: string
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
	reportAmount: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedWithdrawDepositIndexesByOutcome: ReportingWithdrawDepositIndexesByOutcome
}

export type ZoltarMigrationFormState = {
	amount: string
	outcomeIndexes: string
}
