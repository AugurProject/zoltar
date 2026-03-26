import type { Address, Hash, Hex } from 'viem'
import type { createReadClient, createWriteClient } from '../lib/clients.js'

export type DeploymentStepId = 'proxyDeployer' | 'uniformPriceDualCapBatchAuctionFactory' | 'scalarOutcomes' | 'securityPoolUtils' | 'openOracle' | 'zoltarQuestionData' | 'zoltar' | 'shareTokenFactory' | 'priceOracleManagerAndOperatorQueuerFactory' | 'securityPoolForker' | 'escalationGameFactory' | 'securityPoolFactory'
export type MarketType = 'binary' | 'categorical' | 'scalar'
export type ReportingOutcomeKey = 'invalid' | 'yes' | 'no'

export type QuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

export type DeploymentClient = ReturnType<typeof createWriteClient>
export type DeploymentReadClient = ReturnType<typeof createReadClient>
export type BalanceReadClient = ReturnType<typeof createReadClient>
export type ContractReadClient = ReturnType<typeof createReadClient>
export type MarketWriteClient = ReturnType<typeof createWriteClient>

export type DeploymentStep = {
	id: DeploymentStepId
	label: string
	address: Address
	dependencies: DeploymentStepId[]
	deploy: (client: DeploymentClient) => Promise<Hash>
}

export type DeploymentStatus = DeploymentStep & {
	deployed: boolean
}

export type MarketCreationResult = {
	questionId: string
	createQuestionHash: Hash
	marketType: MarketType
}

export type MarketDetails = {
	answerUnit: string
	description: string
	displayValueMax: bigint
	displayValueMin: bigint
	endTime: bigint
	exists: boolean
	marketType: MarketType
	outcomeLabels: string[]
	questionId: string
	startTime: bigint
	title: string
}

export type SecurityPoolCreationResult = {
	deployPoolHash: Hash
	questionId: string
	securityMultiplier: bigint
}

export type SecurityVaultDetails = {
	currentRetentionRate: bigint
	lockedRepInEscalationGame: bigint
	poolOwnershipDenominator: bigint
	repDepositShare: bigint
	repToken: Address
	securityBondAllowance: bigint
	securityPoolAddress: Address
	totalSecurityBondAllowance: bigint
	unpaidEthFees: bigint
	vaultAddress: Address
}

export type SecurityVaultActionResult = {
	action: 'approveRep' | 'depositRep' | 'redeemFees' | 'redeemRep' | 'updateVaultFees'
	hash: Hash
}

export type OracleManagerDetails = {
	callbackStateHash: Hex | undefined
	exactToken1Report: bigint | undefined
	lastPrice: bigint
	managerAddress: Address
	openOracleAddress: Address
	pendingReportId: bigint
	requestPriceEthCost: bigint
	token1: Address | undefined
	token2: Address | undefined
}

export type OpenOracleActionResult = {
	action: 'approveToken1' | 'approveToken2' | 'requestPrice' | 'settle' | 'submitInitialReport'
	hash: Hash
}

export type ListedSecurityPool = {
	currentRetentionRate: bigint
	managerAddress: Address
	parent: Address
	questionId: string
	securityMultiplier: bigint
	securityPoolAddress: Address
	startingRepEthPrice: bigint
	universeId: bigint
}

export type SecurityPoolOverviewActionResult = {
	action: 'queueLiquidation'
	hash: Hash
	securityPoolAddress: Address
}

export type TradingActionResult = {
	action: 'createCompleteSet' | 'redeemCompleteSet'
	hash: Hash
	securityPoolAddress: Address
}

export type EscalationDeposit = {
	amount: bigint
	cumulativeAmount: bigint
	depositIndex: bigint
	depositor: Address
}

export type EscalationSide = {
	balance: bigint
	deposits: EscalationDeposit[]
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[]
}

export type ReportingDetails = {
	bindingCapital: bigint
	completeSetCollateralAmount: bigint
	currentRequiredBond: bigint
	currentTime: bigint
	escalationEndTime: bigint
	escalationGameAddress: Address
	marketDetails: MarketDetails
	nonDecisionThreshold: bigint
	resolution: ReportingOutcomeKey | 'none'
	securityPoolAddress: Address
	sides: EscalationSide[]
	startBond: bigint
	startingTime: bigint
	totalCost: bigint
}

export type ReportingActionResult = {
	action: 'reportOutcome' | 'withdrawEscalation'
	hash: Hash
	outcome: ReportingOutcomeKey
	securityPoolAddress: Address
}
