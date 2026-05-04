import type { MarketType, ReportingOutcomeKey } from './contracts.js'
import type { Address, Hash } from 'viem'
import type { SupportedNetworkKey } from '../shared/networkConfig.js'

export type Route = 'deploy' | 'zoltar' | 'security-pools' | 'open-oracle' | 'not-found'

export type WriteOperationsParameters = {
	accountAddress: Address | undefined
	activeNetworkKey: SupportedNetworkKey
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export type AccountState = {
	address: Address | undefined
	chainId?: string | undefined
	walletChainId: string | undefined
	ethBalance: bigint | undefined
	wethBalance: bigint | undefined
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
}

export type SecurityVaultFormState = {
	depositAmount: string
	securityBondAllowanceAmount: string
	repWithdrawAmount: string
	selectedVaultAddress: string
	securityPoolAddress: string
}

export type OpenOracleFormState = {
	amount1: string
	amount2: string
	disputeNewAmount1: string
	disputeNewAmount2: string
	disputeTokenToSwap: 'token1' | 'token2'
	reportId: string
	price: string
	stateHash: string
}

export type OpenOracleCreateFormState = {
	ethValue: string
	exactToken1Report: string
	escalationHalt: string
	feePercentage: string
	multiplier: string
	protocolFee: string
	settlementTime: string
	settlerReward: string
	token1Address: string
	token2Address: string
	disputeDelay: string
}

export type TradingFormState = {
	completeSetAmount: string
	redeemAmount: string
	securityPoolAddress: string
	selectedShareOutcome: ReportingOutcomeKey
	targetOutcomeIndexes: string
}

export type ReportingFormState = {
	reportAmount: string
	securityPoolAddress: string
	selectedOutcome: ReportingOutcomeKey
	withdrawDepositIndexes: string
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
	submitBidAmount: string
	submitBidTick: string
	vaultAddress: string
	withdrawBidIndex: string
	withdrawForAddress: string
	withdrawTick: string
}

export type ZoltarMigrationFormState = {
	amount: string
	outcomeIndexes: string
}
