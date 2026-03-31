import type { Address, Hash, Hex } from 'viem'
import type { WriteClient as ClientsWriteClient } from '../lib/clients.js'
export type { ReadClient, WriteClient } from '../lib/clients.js'

export type DeploymentStepId = 'proxyDeployer' | 'uniformPriceDualCapBatchAuctionFactory' | 'scalarOutcomes' | 'securityPoolUtils' | 'openOracle' | 'zoltarQuestionData' | 'zoltar' | 'shareTokenFactory' | 'priceOracleManagerAndOperatorQueuerFactory' | 'securityPoolForker' | 'escalationGameFactory' | 'securityPoolFactory'
export type MarketType = 'binary' | 'categorical' | 'scalar'
export type ReportingOutcomeKey = 'invalid' | 'yes' | 'no'
export type SecurityPoolSystemState = 'operational' | 'poolForked' | 'forkMigration' | 'forkTruthAuction'
export type ForkAuctionAction = 'forkWithOwnEscalation' | 'initiateFork' | 'createChildUniverse' | 'migrateRepToZoltar' | 'migrateVault' | 'migrateEscalationDeposits' | 'startTruthAuction' | 'submitBid' | 'refundLosingBids' | 'finalizeTruthAuction' | 'claimAuctionProceeds' | 'forkUniverse' | 'withdrawBids'
export type OracleQueueOperation = 'liquidation' | 'withdrawRep' | 'setSecurityBondsAllowance'

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

export type ZoltarChildUniverseSummary = {
	exists: boolean
	forkTime: bigint
	outcomeIndex: bigint
	outcomeLabel: string
	parentUniverseId: bigint
	reputationToken: Address
	universeId: bigint
}

export type ZoltarUniverseSummary = {
	childUniverses: ZoltarChildUniverseSummary[]
	forkThreshold: bigint
	forkQuestionDetails: MarketDetails | undefined
	forkTime: bigint
	forkingOutcomeIndex: bigint
	hasForked: boolean
	parentUniverseId: bigint
	reputationToken: Address
	universeId: bigint
}

export type DeploymentStep = {
	id: DeploymentStepId
	label: string
	address: Address
	dependencies: DeploymentStepId[]
	deploy: (client: ClientsWriteClient) => Promise<Hash>
}

export type DeploymentStatus = DeploymentStep & {
	deployed: boolean
}

export type MarketCreationResult = {
	questionId: string
	createQuestionHash: Hash
	marketType: MarketType
}

export type ZoltarForkActionResult = {
	action: 'approveForkRep' | 'forkZoltar'
	hash: Hash
	questionId: string
	universeId: bigint
}

export type ZoltarChildUniverseActionResult = {
	action: 'createChildUniverse'
	hash: Hash
	outcomeIndex: bigint
	universeId: bigint
}

export type MarketDetails = QuestionData & {
	createdAt: bigint
	exists: boolean
	marketType: MarketType
	outcomeLabels: string[]
	questionId: string
}

export type SecurityPoolCreationResult = {
	deployPoolHash: Hash
	questionId: string
	securityMultiplier: bigint
	universeId: bigint
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
	universeId: bigint
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
	action: 'approveToken1' | 'approveToken2' | 'queueOperation' | 'requestPrice' | 'settle' | 'submitInitialReport'
	hash: Hash
}

export type ListedSecurityPool = {
	currentRetentionRate: bigint
	forkOutcome: ReportingOutcomeKey | 'none'
	forkOwnSecurityPool: boolean
	managerAddress: Address
	marketDetails: MarketDetails
	migratedRep: bigint
	parent: Address
	questionId: string
	securityMultiplier: bigint
	securityPoolAddress: Address
	startingRepEthPrice: bigint
	systemState: SecurityPoolSystemState
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	universeId: bigint
	vaultCount: bigint
	vaults: SecurityPoolVaultSummary[]
}

export type SecurityPoolVaultSummary = {
	feeIndex: bigint
	lockedRepInEscalationGame: bigint
	poolOwnership: bigint
	repDepositShare: bigint
	securityBondAllowance: bigint
	unpaidEthFees: bigint
	vaultAddress: Address
}

export type SecurityPoolOverviewActionResult = {
	action: 'queueLiquidation'
	hash: Hash
	securityPoolAddress: Address
}

export type TradingActionResult = {
	action: 'createCompleteSet' | 'migrateShares' | 'redeemCompleteSet' | 'redeemShares'
	hash: Hash
	securityPoolAddress: Address
	universeId: bigint
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
	universeId: bigint
}

export type ReportingActionResult = {
	action: 'reportOutcome' | 'withdrawEscalation'
	hash: Hash
	outcome: ReportingOutcomeKey
	securityPoolAddress: Address
	universeId: bigint
}

export type TruthAuctionMetrics = {
	accumulatedEth: bigint
	auctionEndsAt: bigint | undefined
	clearingPrice: bigint | undefined
	clearingTick: bigint | undefined
	ethAtClearingTick: bigint
	ethRaiseCap: bigint
	ethRaised: bigint
	finalized: boolean
	hitCap: boolean
	maxRepBeingSold: bigint
	minBidSize: bigint
	repPurchasableAtBid: bigint | undefined
	timeRemaining: bigint | undefined
	totalRepPurchased: bigint
	underfunded: boolean
}

export type ForkAuctionDetails = {
	auctionedSecurityBondAllowance: bigint
	claimingAvailable: boolean
	completeSetCollateralAmount: bigint
	currentTime: bigint
	forkOutcome: ReportingOutcomeKey | 'none'
	forkOwnSecurityPool: boolean
	marketDetails: MarketDetails
	migratedRep: bigint
	migrationEndsAt: bigint | undefined
	parentSecurityPoolAddress: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	repAtFork: bigint
	securityPoolAddress: Address
	systemState: SecurityPoolSystemState
	truthAuction: TruthAuctionMetrics | undefined
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	universeId: bigint
}

export type ForkAuctionActionResult = {
	action: ForkAuctionAction
	hash: Hash
	securityPoolAddress: Address
	universeId: bigint
}
