import type { Address, Hash, Hex } from '@zoltar/shared/ethereum'
import type { WriteClient as ClientsWriteClient } from '../lib/clients.js'
export type { ReadClient, WriteClient } from '../lib/clients.js'

export type DeploymentStepId =
	| 'proxyDeployer'
	| 'deploymentStatusOracle'
	| 'weth'
	| 'reputationToken'
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
	| 'escalationGameClaimDelegate'
	| 'escalationGameFactory'
	| 'securityPoolFactory'
export type MarketType = 'binary' | 'categorical' | 'scalar'

export type LiquidationApprovalDetails = {
	registryAddress: Address
	params: {
		securityPool: Address
		receiverVault: Address
		operator: Address
		targetVault: Address
		maxCumulativeDebtAttoEth: bigint
		maxDebtPerLiquidationAttoEth: bigint
		minPostLiquidationHealthFactorBps: bigint
		validAfter: bigint
		validUntil: bigint
		nonce: bigint
	}
	availableDebtAttoEth: bigint
	reservedDebtAttoEth: bigint
	consumedDebtAttoEth: bigint
	minimumValidNonce: bigint
	revoked: boolean
}
export type ReportingOutcomeKey = 'invalid' | 'yes' | 'no'
export type ForkOutcomeKey = ReportingOutcomeKey | 'none'
export type SecurityPoolSystemState = 'operational' | 'poolForked' | 'forkMigration' | 'forkTruthAuction'
export type ForkAuctionAction =
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'createChildUniverse'
	| 'migrateRepToZoltar'
	| 'migrateVault'
	| 'claimParentEscalationDeposits'
	| 'migrateUnresolvedEscalation'
	| 'startTruthAuction'
	| 'submitBid'
	| 'refundLosingBids'
	| 'finalizeTruthAuction'
	| 'claimAuctionProceeds'
	| 'settleForkedEscalation'
	| 'forkUniverse'
export type TruthAuctionSettlementMode = 'claim' | 'mixed' | 'refund'
export type OracleQueueOperation = 'liquidation' | 'withdrawRep'
export type StagedOracleOperation = {
	amount: bigint
	operator: Address
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
	forkThresholdAttoRep: bigint
	forkQuestionDetails: MarketDetails | undefined
	forkTime: bigint
	forkingOutcomeIndex: bigint
	hasForked: boolean
	parentUniverseId: bigint
	reputationToken: Address
	totalTheoreticalSupplyAttoRep: bigint
	universeId: bigint
	zoltarAddress?: Address
}

export type DeploymentStep = {
	id: DeploymentStepId
	label: string
	address: Address
	dependencies: DeploymentStepId[]
	deploy: (client: ClientsWriteClient) => Promise<Hash>
	expectedRuntimeCodeHash?: Hash
	trustedSimulationCodePresence?: true
}

export type DeploymentStatus = DeploymentStep & {
	deployed: boolean
}

export type DeploymentStatusSnapshot = {
	augurStatoblastDeployed: boolean
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
	amountAttoRep: bigint
	outcomeIndexes: bigint[]
	universeId: bigint
}

export type LiquidationFundingPreview = {
	currentRepBalanceAttoRep: bigint
	currentWethBalanceAttoEth: bigint
	initialReportRepRequiredAttoRep: bigint
	initialReportWethRequiredAttoEth: bigint
	queueOperationValueAttoEth: bigint
	totalWalletEthRequiredAttoEth: bigint
	wethShortfallAttoEth: bigint
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
	initialReportPriorityFeeAttoEthPerGas: bigint
	questionId: string
	securityPoolAddress: Address
	statoblastSecurityMultiplierBps: bigint
	universeId: bigint
}

export type SecurityVaultDetails = {
	badDebtAttoEth: bigint
	currentRetentionRate: bigint
	disputeStakedAttoRep: bigint
	managerAddress: Address
	minimumSecurityBondDebtAttoEth?: bigint
	minimumVaultRepDepositAttoRep?: bigint
	totalRepBackingUnits: bigint
	vaultAttoRepBacking: bigint
	repToken: Address
	capacityOwnershipAttoRep: bigint
	securityPoolAddress: Address
	totalCapacityOwnershipAttoRep: bigint
	claimableFeesAttoEth: bigint
	universeId: bigint
	vaultAddress: Address
}

export type SecurityVaultActionResult = ActionResult & {
	action: 'approveRep' | 'depositRepToVault' | 'queueWithdrawRep' | 'redeemFees' | 'redeemRepFromVault' | 'updateVaultFees'
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
	queuedOperationCostAttoEth: bigint
	requestPriceCostAttoEth: bigint
	settlementTime?: bigint
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
	ethAttoEth: bigint
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
	timeType: boolean
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
	settlerRewardAttoEth: bigint
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
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	feeEligibleCapacityOwnershipAttoRep: bigint
	hasForkActivity: boolean
	initialReportPriorityFeeAttoEthPerGas: bigint
	forkOutcome: ForkOutcomeKey
	forkOwnSecurityPool: boolean
	lastOraclePrice: bigint | undefined
	lastOracleSettlementTimestamp: bigint
	managerAddress: Address
	minimumSecurityBondDebtAttoEth?: bigint
	minimumVaultRepDepositAttoRep?: bigint
	marketDetails: MarketDetails
	migratedAttoRep: bigint
	parent: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	questionId: string
	statoblastSecurityMultiplierBps: bigint
	securityPoolAddress: Address
	shareTokenSupplyAttoShares: bigint
	systemState: SecurityPoolSystemState
	totalPoolHeldAttoRep: bigint
	totalCapacityOwnershipAttoRep: bigint
	truthAuctionAddress: Address
	truthAuctionStartedAt: bigint
	universeHasForked: boolean
	universeId: bigint
	vaultCount: bigint
	hasLoadedVaults?: boolean
	vaultScanCapped?: boolean
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
	badDebtAttoEth?: bigint
	openInterestAttoEth?: bigint
	disputeStakedAttoRep: bigint
	repBackingUnits?: bigint
	totalRepBackingUnits?: bigint
	vaultAttoRepBacking: bigint
	capacityOwnershipAttoRep: bigint
	totalPoolHeldRepBalanceAttoRep?: bigint
	claimableFeesAttoEth: bigint
	vaultAddress: Address
}

type OwnForkRepBuckets = {
	vaultRepAtForkAttoRep: bigint
	escalationChildRepPerSelectedOutcomeAttoRep: bigint
	escrowSourceRepAtForkAttoRep: bigint
}

export type SecurityPoolOverviewActionResult = ActionResult & {
	action: 'queueLiquidation'
	queuedOperation?: StagedOracleQueuedResult
	securityPoolAddress: Address
	stagedExecution?: StagedOracleExecutionResult
}

export type TradingShareBalances = {
	invalidAttoShares: bigint
	noAttoShares: bigint
	yesAttoShares: bigint
}

export type TradingDetails = {
	maxRedeemableCompleteSetsAttoShares: bigint | undefined
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
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	depositIndex: bigint
	depositor: Address
}

export type ImportedEscalationDeposit = {
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	depositor: Address
	parentDepositIndex: bigint
}

export type CarriedDepositProof = {
	depositor: Address
	amountAttoRep: bigint
	parentDepositIndex: bigint
	cumulativeAmountAttoRep: bigint
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
	totalCurrentAttoRep: bigint
}

type ReportingDetailsBase = {
	settlementCollateralAttoEth: bigint
	currentTime: bigint
	forkThresholdAttoRep: bigint
	marketDetails: MarketDetails
	nonDecisionThresholdAttoRep: bigint
	parentSecurityPoolAddress?: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	securityPoolAddress: Address
	settlementState: ReportingSettlementState
	startBondAttoRep: bigint
	systemState: SecurityPoolSystemState
	universeId: bigint
	parentWithdrawalEnabled: boolean
	viewerPoolHeldVaultRepBackingAttoRep: bigint | undefined
	viewerEscalationMigrationEntitlement?: EscalationMigrationEntitlementStatus | undefined
	viewerVaultExists: boolean
	viewerVaultDisputeStakedAttoRep: bigint | undefined
	viewerVaultRepBackingAttoRep: bigint | undefined
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
	totalCostAttoRep: bigint
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
	accumulatedBidAttoEth: bigint
	auctionEndsAt: bigint | undefined
	clearingPrice: bigint | undefined
	clearingTick: bigint | undefined
	bidAtClearingTickAttoEth: bigint
	attoEthRaiseCap: bigint
	attoEthRaised: bigint
	finalized: boolean
	hitCap: boolean
	maxAttoRepBeingSold: bigint
	minBidSizeAttoEth: bigint
	attoRepPurchasableAtBid: bigint | undefined
	timeRemaining: bigint | undefined
	totalAttoRepPurchased: bigint
	underfunded: boolean
	underfundedThreshold: bigint | undefined
	underfundedWinningAttoEth: bigint
}

export type TruthAuctionTickSummary = {
	tick: bigint
	price: bigint
	currentTotalBidAttoEth: bigint
	submissionCount: bigint
	active: boolean
}

export type TruthAuctionBidView = {
	tick: bigint
	bidIndex: bigint
	bidder: Address
	bidAmountAttoEth: bigint
	cumulativeBidAttoEth: bigint
	activeCumulativeBidBeforeAttoEth: bigint
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
	auctionedCapacityOwnershipAttoRep: bigint
	claimingAvailable: boolean
	settlementCollateralAttoEth: bigint
	currentTime: bigint
	hasForkActivity: boolean
	forkOutcome: ForkOutcomeKey
	forkOwnSecurityPool: boolean
	marketDetails: MarketDetails
	migratedAttoRep: bigint
	migrationEndsAt: bigint | undefined
	parentSecurityPoolAddress: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	ownForkRepBuckets?: OwnForkRepBuckets | undefined
	auctionableAttoRepAtFork: bigint
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
