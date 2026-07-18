import type { Address, Hash, Hex } from '@zoltar/shared/ethereum'
import type { WriteClient as ClientsWriteClient } from '../lib/clients.js'
export type { ReadClient, WriteClient } from '../lib/clients.js'

export type DeploymentStepId =
	| 'proxyDeployer'
	| 'deploymentStatusOracle'
	| 'multicall3'
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
export type ForkOutcomeKey = ReportingOutcomeKey | 'none'
export type SecurityPoolSystemState = 'operational' | 'poolForked' | 'forkMigration' | 'forkTruthAuction'
export type ForkAuctionAction =
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'createChildUniverse'
	| 'migrateRepToZoltar'
	| 'migrateVault'
	| 'migrateEscalationDeposits'
	| 'migrateUnresolvedEscalation'
	| 'startTruthAuction'
	| 'submitBid'
	| 'refundLosingBids'
	| 'finalizeTruthAuction'
	| 'claimAuctionProceeds'
	| 'settleForkedEscalation'
	| 'forkUniverse'
export type TruthAuctionSettlementMode = 'claim' | 'mixed' | 'refund'
export type OracleQueueOperation = 'liquidation' | 'withdrawRep' | 'setSecurityBondsAllowance'
export type StagedOracleOperation = {
	amount: bigint
	initiatorVault: Address
	operation: OracleQueueOperation
	operationId: bigint
	targetVault: Address
}

export type StagedOracleExecutionResult = {
	errorMessage: string | undefined
	operation: OracleQueueOperation
	operationId: bigint
	success: boolean
}

export type StagedOracleQueuedResult = {
	isPendingSlot: boolean
	operation: OracleQueueOperation
	operationId: bigint
}

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
	forkBurnDivisor?: bigint
	forkThreshold: bigint
	forkQuestionDetails: MarketDetails | undefined
	forkTime: bigint
	forkingOutcomeIndex: bigint
	hasForked: boolean
	parentUniverseId: bigint
	reputationToken: Address
	totalTheoreticalSupply: bigint
	universeId: bigint
	zoltarAddress?: Address
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

export type LiquidationFundingPreview = {
	currentRepBalance: bigint
	currentWethBalance: bigint
	initialReportRepRequired: bigint
	initialReportWethRequired: bigint
	queueOperationEthValue: bigint
	totalWalletEthRequired: bigint
	wethShortfall: bigint
}

export type MarketDetails = QuestionData & {
	createdAt: bigint
	exists: boolean
	marketType: MarketType
	outcomeLabels: string[]
	questionId: string
}

export type MarketDetailsPage = {
	pageIndex: number
	pageSize: number
	questionCount: bigint
	questions: MarketDetails[]
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
	escalationEscrowedRep: bigint
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
	action: 'approveRep' | 'depositRep' | 'queueSetSecurityBondAllowance' | 'queueWithdrawRep' | 'redeemFees' | 'redeemRep' | 'updateVaultFees'
	queuedOperation?: StagedOracleQueuedResult
	stagedExecution?: StagedOracleExecutionResult
}

export type OracleManagerDetails = {
	activeStagedOperationCount?: bigint
	callbackStateHash: Hex | undefined
	exactToken1Report: bigint | undefined
	isPriceValid: boolean
	lastPrice: bigint
	lastSettlementTimestamp: bigint
	managerAddress: Address
	openOracleAddress: Address
	pendingOperation: StagedOracleOperation | undefined
	pendingOperationSlotId: bigint
	pendingSettlementOperationIds: bigint[]
	pendingSettlementQueueCapacity: bigint
	pendingReportId: bigint
	priceValidUntilTimestamp: bigint | undefined
	queuedOperationEthCost: bigint
	requestPriceEthCost: bigint
	stagedOperations?: StagedOracleOperation[]
	token1: Address | undefined
	token2: Address | undefined
}

export type OpenOracleActionResult = ActionResult & {
	action: 'approveToken1' | 'approveToken2' | 'createReportInstance' | 'dispute' | 'executeStagedOperation' | 'queueOperation' | 'requestPrice' | 'settle' | 'withdrawBalance' | 'wrapWeth'
	queuedOperation?: StagedOracleQueuedResult
	stagedExecution?: StagedOracleExecutionResult
}

export type OpenOracleWithdrawableBalances = {
	eth: bigint
	token1: bigint
	token2: bigint
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
	reportId: bigint
	openOracleAddress: Address
	currentTime: bigint
	currentBlockNumber: bigint
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
	currentAmount1: bigint
	currentAmount2: bigint
	price: bigint
	currentReporter: Address
	reportTimestamp: bigint
	settlementTimestamp: bigint
	initialReporter: Address
	disputeOccurred: boolean
	isDistributed: boolean
	stateHash: Hex
	callbackContract: Address
	callbackGasLimit: number
	protocolFeeRecipient: Address
	trackDisputes: boolean
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
	hasForkActivity: boolean
	forkOutcome: ForkOutcomeKey
	forkOwnSecurityPool: boolean
	lastOraclePrice: bigint | undefined
	lastOracleSettlementTimestamp: bigint
	managerAddress: Address
	marketDetails: MarketDetails
	migratedRep: bigint
	parent: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	questionId: string
	securityMultiplier: bigint
	securityPoolAddress: Address
	shareTokenSupply: bigint
	systemState: SecurityPoolSystemState
	totalRepDeposit: bigint
	totalSecurityBondAllowance: bigint
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	universeHasForked: boolean
	universeId: bigint
	vaultCount: bigint
	hasLoadedVaults?: boolean
	vaults: SecurityPoolVaultSummary[]
}

export type SecurityPoolPage = {
	pageIndex: number
	pageSize: number
	poolCount: bigint
	pools: ListedSecurityPool[]
}

export type SecurityPoolBrowsePage = SecurityPoolPage & {
	requestKey: string
}

export type SecurityPoolVaultSummary = {
	escalationEscrowedRep: bigint
	repDepositShare: bigint
	securityBondAllowance: bigint
	unpaidEthFees: bigint
	vaultAddress: Address
}

type OwnForkRepBuckets = {
	vaultRepAtFork: bigint
	escalationChildRepPerSelectedOutcome: bigint
	escrowSourceRepAtFork: bigint
}

export type SecurityPoolOverviewActionResult = ActionResult & {
	action: 'queueLiquidation'
	queuedOperation?: StagedOracleQueuedResult
	securityPoolAddress: Address
	stagedExecution?: StagedOracleExecutionResult
}

export type TradingShareBalances = {
	invalid: bigint
	no: bigint
	yes: bigint
}

export type TradingDetails = {
	maxRedeemableCompleteSets: bigint | undefined
	shareBalances: TradingShareBalances | undefined
	universeId: bigint
}

export type TradingActionResult = ActionResult & {
	action: 'createCompleteSet' | 'migrateShares' | 'redeemCompleteSet' | 'redeemShares'
	securityPoolAddress: Address
	shareOutcome?: ReportingOutcomeKey
	targetOutcomeIndexes?: bigint[]
	universeId: bigint
}

export type EscalationDeposit = {
	amount: bigint
	cumulativeAmount: bigint
	depositIndex: bigint
	depositor: Address
}

export type ImportedEscalationDeposit = {
	amount: bigint
	cumulativeAmount: bigint
	depositor: Address
	parentDepositIndex: bigint
}

export type CarriedDepositProof = {
	depositor: Address
	amount: bigint
	parentDepositIndex: bigint
	cumulativeAmount: bigint
	sourceNodeId: bigint
	leafIndex: bigint
	merkleMountainRangeSiblings: Hex[]
	merkleMountainRangePeakIndex: bigint
	nullifierSiblings: Hex[]
}

export type EscalationSide = {
	balance: bigint
	deposits: EscalationDeposit[]
	importedUserDeposits: ImportedEscalationDeposit[]
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[]
}

export type ReportingSettlementState = 'locked' | 'resolved' | 'migration-required' | 'migration-expired'

type EscalationMigrationEntitlementStatus = {
	initialized: boolean
	materializedByOutcome: Record<ReportingOutcomeKey, boolean>
	totalCurrentRep: bigint
}

type ReportingDetailsBase = {
	completeSetCollateralAmount: bigint
	currentTime: bigint
	forkThreshold: bigint
	marketDetails: MarketDetails
	nonDecisionThreshold: bigint
	parentSecurityPoolAddress?: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	securityPoolAddress: Address
	settlementState: ReportingSettlementState
	startBond: bigint
	systemState: SecurityPoolSystemState
	universeId: bigint
	parentWithdrawalEnabled: boolean
	viewerVaultAvailableEscalationRep: bigint | undefined
	viewerEscalationMigrationEntitlement?: EscalationMigrationEntitlementStatus | undefined
	viewerVaultExists: boolean
	viewerVaultEscrowedRep: bigint | undefined
	viewerVaultRepDepositShare: bigint | undefined
}

export type ActiveReportingDetails = ReportingDetailsBase & {
	status: 'active'
	bindingCapital: bigint
	currentRequiredBond: bigint
	escalationEndTime: bigint
	escalationGameAddress: Address
	hasReachedNonDecision: boolean
	sides: EscalationSide[]
	activationTime: bigint
	totalCost: bigint
}

export type ReportingDetails =
	| (ReportingDetailsBase & {
			status: 'not-started'
	  })
	| ActiveReportingDetails

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
	underfundedThreshold: bigint | undefined
	underfundedWinningEth: bigint
}

export type TruthAuctionTickSummary = {
	tick: bigint
	price: bigint
	currentTotalEth: bigint
	submissionCount: bigint
	active: boolean
}

export type TruthAuctionBidView = {
	tick: bigint
	bidIndex: bigint
	bidder: Address
	ethAmount: bigint
	cumulativeEth: bigint
	activeCumulativeEthBeforeBid: bigint
	claimed: boolean
	refunded: boolean
}

export type TruthAuctionTickPage = {
	pageIndex: number
	pageSize: number
	tickCount: bigint
	ticks: TruthAuctionTickSummary[]
}

export type TruthAuctionTickBidPage = {
	tick: bigint
	pageIndex: number
	pageSize: number
	bidCount: bigint
	bids: TruthAuctionBidView[]
}

export type TruthAuctionBidderBidPage = {
	bidder: Address
	pageIndex: number
	pageSize: number
	bidCount: bigint
	bids: TruthAuctionBidView[]
}

export type ForkAuctionDetails = {
	auctionedSecurityBondAllowance: bigint
	claimingAvailable: boolean
	completeSetCollateralAmount: bigint
	currentTime: bigint
	hasForkActivity: boolean
	forkOutcome: ForkOutcomeKey
	forkOwnSecurityPool: boolean
	marketDetails: MarketDetails
	migratedRep: bigint
	migrationEndsAt: bigint | undefined
	parentSecurityPoolAddress: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	ownForkRepBuckets?: OwnForkRepBuckets | undefined
	auctionableRepAtFork: bigint
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
	settlementMode?: TruthAuctionSettlementMode
	universeId: bigint
}
