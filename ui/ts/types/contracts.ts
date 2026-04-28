import type { Address, Hash, Hex } from 'viem'
import type { WriteClient as ClientsWriteClient } from '../lib/clients.js'
export type { ReadClient, WriteClient } from '../lib/clients.js'

export type DeploymentStepId =
	| 'proxyDeployer'
	| 'deploymentStatusOracle'
	| 'uniformPriceDualCapBatchAuctionFactory'
	| 'scalarOutcomes'
	| 'securityPoolUtils'
	| 'openOracle'
	| 'zoltarQuestionData'
	| 'zoltar'
	| 'shareTokenFactory'
	| 'priceOracleManagerAndOperatorQueuerFactory'
	| 'securityPoolForker'
	| 'escalationGameFactory'
	| 'securityPoolFactory'
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
	totalTheoreticalSupply: bigint
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

export type DeploymentStatusSnapshot = {
	augurPlaceHolderDeployed: boolean
	deploymentStatuses: DeploymentStatus[]
}

type ActionResult = { hash: Hash }

export type MarketCreationResult = {
	questionId: string
	createQuestionHash: Hash
	marketType: MarketType
}

export type ZoltarForkActionResult = ActionResult & {
	action: 'approveForkRep' | 'forkZoltar'
	questionId: string
	universeId: bigint
}

export type ZoltarChildUniverseActionResult = ActionResult & {
	action: 'createChildUniverse'
	outcomeIndex: bigint
	universeId: bigint
}

export type ZoltarMigrationActionResult = ActionResult & {
	action: 'addRepToMigrationBalance' | 'splitMigrationRep'
	amount: bigint
	outcomeIndexes: bigint[]
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
	securityPoolAddress: Address
	securityMultiplier: bigint
	universeId: bigint
}

export type SecurityVaultDetails = {
	currentRetentionRate: bigint
	lockedRepInEscalationGame: bigint
	managerAddress: Address
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

export type SecurityVaultActionResult = ActionResult & {
	action: 'approveRep' | 'depositRep' | 'queueSetSecurityBondAllowance' | 'queueWithdrawRep' | 'redeemFees' | 'updateVaultFees'
}

export type OracleManagerDetails = {
	callbackStateHash: Hex | undefined
	exactToken1Report: bigint | undefined
	isPriceValid: boolean
	lastPrice: bigint
	lastSettlementTimestamp: bigint
	managerAddress: Address
	openOracleAddress: Address
	pendingReportId: bigint
	priceValidUntilTimestamp: bigint | undefined
	requestPriceEthCost: bigint
	token1: Address | undefined
	token2: Address | undefined
}

export type OpenOracleActionResult = ActionResult & {
	action: 'approveToken1' | 'approveToken2' | 'createReportInstance' | 'dispute' | 'queueOperation' | 'requestPrice' | 'settle' | 'submitInitialReport' | 'wrapWeth'
}

export type OpenOracleReportSummary = {
	currentAmount1: bigint
	currentAmount2: bigint
	currentReporter: Address
	disputeOccurred: boolean
	exactToken1Report: bigint
	isDistributed: boolean
	price: bigint
	reportId: bigint
	reportTimestamp: bigint
	settlementTimestamp: bigint
	token1: Address
	token2: Address
	token1Decimals: number
	token2Decimals: number
	token1Symbol: string
	token2Symbol: string
}

export type OpenOracleReportSummaryPage = {
	nextReportId: bigint
	pageIndex: number
	pageSize: number
	reportCount: bigint
	reports: OpenOracleReportSummary[]
}

export type OpenOracleReportDetails = {
	// Identity
	reportId: bigint
	openOracleAddress: Address
	// Meta
	exactToken1Report: bigint
	escalationHalt: bigint
	fee: bigint
	settlerReward: bigint
	token1: Address
	token2: Address
	settlementTime: bigint
	timeType: boolean
	feePercentage: bigint
	protocolFee: bigint
	multiplier: bigint
	disputeDelay: bigint
	// Status
	currentAmount1: bigint
	currentAmount2: bigint
	price: bigint
	currentReporter: Address
	reportTimestamp: bigint
	settlementTimestamp: bigint
	initialReporter: Address
	disputeOccurred: boolean
	isDistributed: boolean
	// Extra
	stateHash: Hex
	callbackContract: Address
	callbackSelector: Hex
	callbackGasLimit: number
	protocolFeeRecipient: Address
	trackDisputes: boolean
	keepFee: boolean
	feeToken: boolean
	numReports: bigint
	lastReportOppoTime: bigint
	token1Decimals: number
	token2Decimals: number
	token1Symbol: string
	token2Symbol: string
}

export type ListedSecurityPool = {
	completeSetCollateralAmount: bigint
	currentRetentionRate: bigint
	forkOutcome: ReportingOutcomeKey | 'none'
	forkOwnSecurityPool: boolean
	lastOraclePrice: bigint | undefined
	managerAddress: Address
	marketDetails: MarketDetails
	migratedRep: bigint
	parent: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	questionId: string
	securityMultiplier: bigint
	securityPoolAddress: Address
	systemState: SecurityPoolSystemState
	totalRepDeposit: bigint
	totalSecurityBondAllowance: bigint
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	universeHasForked: boolean
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

export type SecurityPoolOverviewActionResult = ActionResult & {
	action: 'queueLiquidation'
	securityPoolAddress: Address
}

export type TradingShareBalances = {
	invalid: bigint
	no: bigint
	yes: bigint
}

export type TradingDetails = {
	maxRedeemableCompleteSets: bigint | undefined
	shareBalances: TradingShareBalances | undefined
}

export type TradingActionResult = ActionResult & {
	action: 'createCompleteSet' | 'migrateShares' | 'redeemCompleteSet' | 'redeemShares'
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

export type ReportingActionResult = ActionResult & {
	action: 'reportOutcome' | 'withdrawEscalation'
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

export type ForkAuctionActionResult = ActionResult & {
	action: ForkAuctionAction
	securityPoolAddress: Address
	universeId: bigint
}
