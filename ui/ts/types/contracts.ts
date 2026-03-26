import type { Address, Hash, Hex } from 'viem'

export type DeploymentStepId = 'proxyDeployer' | 'uniformPriceDualCapBatchAuctionFactory' | 'scalarOutcomes' | 'securityPoolUtils' | 'openOracle' | 'zoltarQuestionData' | 'zoltar' | 'shareTokenFactory' | 'priceOracleManagerAndOperatorQueuerFactory' | 'securityPoolForker' | 'escalationGameFactory' | 'securityPoolFactory'
export type MarketType = 'binary' | 'categorical' | 'scalar'

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

// These aliases intentionally stay broad so the UI helpers can accept viem clients
// without reproducing viem's full generic type surface locally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeploymentClient = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeploymentReadClient = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BalanceReadClient = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContractReadClient = any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MarketWriteClient = any

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
	callbackStateHash: Hex | null
	exactToken1Report: bigint | null
	lastPrice: bigint
	managerAddress: Address
	openOracleAddress: Address
	pendingReportId: bigint
	requestPriceEthCost: bigint
	token1: Address | null
	token2: Address | null
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
