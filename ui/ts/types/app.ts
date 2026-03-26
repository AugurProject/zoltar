import type { MarketType, ReportingOutcomeKey } from './contracts.js'
import type { Address } from 'viem'

export type Route = 'deploy' | 'markets' | 'security-pools' | 'security-pools-overview' | 'security-vaults' | 'open-oracle' | 'reporting' | 'trading'

export type AccountState = {
	address: Address | undefined
	chainId: string | undefined
	ethBalance: bigint | undefined
	isMainnet: boolean
	repBalance: bigint | undefined
}

export type MarketFormState = {
	answerUnit: string
	categoricalOutcomes: string
	currentRetentionRate: string
	description: string
	displayValueMax: string
	displayValueMin: string
	title: string
	endTime: string
	marketType: MarketType
	numTicks: string
	scalarStartValue: string
	startTime: string
	securityMultiplier: string
	startingRepEthPrice: string
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
	reportId: string
	stateHash: string
}

export type TradingFormState = {
	completeSetAmount: string
	redeemAmount: string
	securityPoolAddress: string
}

export type ReportingFormState = {
	reportAmount: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey
	withdrawDepositIndexes: string
}
