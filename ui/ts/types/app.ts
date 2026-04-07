import type { MarketType, ReportingOutcomeKey } from './contracts.js'
import type { Address } from 'viem'

export type Route = 'deploy' | 'zoltar' | 'security-pools' | 'open-oracle' | 'not-found'

export type AccountState = {
	address: Address | undefined
	chainId: string | undefined
	ethBalance: bigint | undefined
}

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

export type SecurityPoolFormState = {
	currentRetentionRate: string
	marketId: string
	securityMultiplier: string
	startingRepEthPrice: string
}

export type SecurityVaultFormState = {
	depositAmount: string
	repApprovalAmount: string
	securityPoolAddress: string
}

export type OpenOracleFormState = {
	amount1: string
	amount2: string
	managerAddress: string
	operationAmount: string
	operationTargetVault: string
	queuedOperation: 'liquidation' | 'withdrawRep' | 'setSecurityBondsAllowance'
	reportId: string
	stateHash: string
}

export type TradingFormState = {
	completeSetAmount: string
	fromUniverseId: string
	redeemAmount: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey
}

export type ReportingFormState = {
	reportAmount: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey
	withdrawDepositIndexes: string
}

export type ForkAuctionFormState = {
	bidAmount: string
	bidIndex: string
	bidTick: string
	claimVaultAddress: string
	depositIndexes: string
	directForkQuestionId: string
	directForkUniverseId: string
	refundBidIndex: string
	refundTick: string
	repMigrationOutcomes: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey
	withdrawBidIndex: string
	withdrawForAddress: string
	withdrawTick: string
}

export type ZoltarMigrationFormState = {
	amount: string
	outcomeIndexes: string
}
