import type { Address, Hash, Hex } from '@zoltar/core-shared/evm/ethereum'
import type { ForkOutcomeKey, MarketDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'

type ActionResult = { hash: Hash }

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
	| 'withdrawAuctionRefund'
	| 'finalizeTruthAuction'
	| 'claimAuctionProceeds'
	| 'settleForkedEscalation'
	| 'forkUniverse'
export type TruthAuctionSettlementMode = 'claim' | 'mixed' | 'refund'
export type OracleQueueOperation = 'liquidation' | 'withdrawRep' | 'setVaultUnderwritingLimit' | 'vaultOperations'
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

export type LiquidationFundingPreview = {
	currentRepBalanceAttoRep: bigint
	currentWethBalanceAttoEth: bigint
	initialReportRepRequiredAttoRep: bigint
	initialReportWethRequiredAttoEth: bigint
	queueOperationValueAttoEth: bigint
	totalWalletEthRequiredAttoEth: bigint
	wethShortfallAttoEth: bigint
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
	statoblastSecurityMultiplierBps?: bigint
	targetBackingFactorBps?: bigint
	settlementCollateralAttoEth?: bigint
	associatedRepPerCapacityBps?: bigint
	badDebtAttoEth: bigint
	currentRetentionRate: bigint
	disputeStakedAttoRep: bigint
	managerAddress: Address
	minimumSecurityBondDebtAttoEth?: bigint
	minimumVaultRepDepositAttoRep?: bigint
	openInterestAttoEth?: bigint
	poolHeldRepPerCapacityBps?: bigint
	/** Pool-held REP read in the same block as the vault, so it pairs with totalRepBackingUnits for unit conversions. */
	totalPoolHeldRepBalanceAttoRep: bigint
	totalRepBackingUnits: bigint
	vaultAttoRepBacking: bigint
	repToken: Address
	repTokenSymbol?: string
	underwritingLimitAttoEth: bigint
	securityPoolAddress: Address
	totalUnderwritingLimitAttoEth: bigint
	claimableFeesAttoEth: bigint
	universeId: bigint
	vaultAddress: Address
}

export type QueuedVaultOperationState = {
	status: 'queued' | 'manual-queued' | 'executed' | 'failed' | 'expired' | 'superseded' | 'missing'
	execution?: StagedOracleExecutionResult
}

export type SecurityVaultActionResult = ActionResult & {
	queuedOperationState?: QueuedVaultOperationState
	action: 'setVaultUnderwritingLimit' | 'approveRep' | 'depositRepToVault' | 'queueWithdrawRep' | 'redeemFees' | 'redeemRepFromVault' | 'updateVaultFees'
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
	/** The coordinator's immutable minimum price distance past a vault's liquidation threshold, in basis points. */
	minLiquidationPriceDistanceBps?: bigint | undefined
	openOracleAddress: Address
	pendingOperation: StagedOracleOperation | undefined
	pendingOperationSlotId: bigint
	pendingSettlementOperationIds: bigint[]
	pendingSettlementQueueCapacity: bigint
	pendingReportId: bigint
	pendingReportReadyAtTimestamp?: bigint | undefined
	priceValidUntilTimestamp: bigint | undefined
	queuedOperationCostAttoEth: bigint
	requestPriceCostAttoEth: bigint
	settlementTime?: bigint
	stagedOperations?: StagedOracleOperation[]
	token1: Address | undefined
	token2: Address | undefined
}

export type OpenOraclePriceSettlement = { status: 'accepted' } | { status: 'unconfirmed' } | { status: 'rejected'; reason: string }

export type OpenOracleActionResult = ActionResult & {
	action: 'approveToken1' | 'approveToken2' | 'createReportInstance' | 'dispute' | 'executeStagedOperation' | 'queueOperation' | 'requestPrice' | 'settle' | 'withdrawBalance' | 'wrapWeth'
	priceSettlement?: OpenOraclePriceSettlement | undefined
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
	unavailableReports?: Array<{ reportId: bigint; message: string }>
}

export type OpenOracleReportDetails = OpenOracleReportSummary & {
	/** Expiry of this report’s price, only for a verified pool price coordinator callback. */
	coordinatorPriceValidUntilTimestamp?: bigint | undefined
	openOracleAddress: Address
	currentTime: bigint
	currentBlockNumber: bigint
	escalationHalt: bigint
	settlerRewardAttoEth: bigint
	settlementTime: bigint
	feePercentage: bigint
	protocolFee: bigint
	multiplier: bigint
	disputeDelay: bigint
	initialReporter: Address | undefined
	stateHash: Hex
	callbackContract: Address
	callbackGasLimit: number
	protocolFeeRecipient: Address
	trackDisputes: boolean
	/** OpenOracle FLAG_FEES_ONLY_AT_HALT: disputes pay no fees until the current base amount reaches escalationHalt. */
	feesOnlyAtHalt: boolean
	/** OpenOracle FLAG_FLEXIBLE_ESCALATION: disputes may choose any base amount from the expected amount up to escalationHalt. */
	flexibleEscalation: boolean
	numReports: bigint
	lastReportOppoTime: bigint
}

export type ListedSecurityPool = {
	mintingCapacityAttoEth?: bigint
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	feeAccrualState?: {
		feeEndTimestamp: bigint
		feeIndexRemainder: bigint
		lastUpdatedFeeAccumulator: bigint
		totalFeesOwedRemainder: bigint
	}
	feeEligibleUnderwritingLimitAttoEth: bigint
	hasForkActivity: boolean
	hasForkContinuationEscalationGame: boolean
	initialReportPriorityFeeAttoEthPerGas: bigint
	forkOutcome: ForkOutcomeKey
	forkOwnSecurityPool: boolean
	lastOraclePrice: bigint | undefined
	lastOracleSettlementTimestamp: bigint
	managerAddress: Address
	minimumSecurityBondDebtAttoEth?: bigint
	minimumVaultRepDepositAttoRep?: bigint
	ordinaryEscalationGameStarted: boolean
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
	totalUnderwritingLimitAttoEth: bigint
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

export type SecurityPoolVaultSummary = {
	badDebtAttoEth?: bigint
	openInterestAttoEth?: bigint
	disputeStakedAttoRep: bigint
	repBackingUnits?: bigint
	totalRepBackingUnits?: bigint
	vaultAttoRepBacking: bigint
	underwritingLimitAttoEth: bigint
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
	walletVaultFunding?: { vaultRepBackingUnits: bigint; totalRepBackingUnits: bigint; totalPoolHeldRepAttoRep: bigint } | undefined
	minimumVaultRepDepositAttoRep?: bigint | undefined
	contributionFunding?: 'vault' | 'wallet' | undefined
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
	viewerWalletRepAllowanceAttoRep?: bigint | undefined
	viewerWalletRepBalanceAttoRep?: bigint | undefined
	viewerWalletRepTokenAddress?: Address | undefined
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
	forkContinuation?: boolean | undefined
	forkResumedAt?: bigint | undefined
	forkElapsedAtStart?: bigint | undefined
}

export type ReportingDetails =
	| (ReportingDetailsBase & {
			status: 'not-started'
	  })
	| ActiveReportingDetails

export type ReportingActionResult = ActionResult & {
	amountAttoRep?: bigint
	action: 'approveReportingRep' | 'reportOutcome' | 'withdrawEscalation'
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
	auctionedUnderwritingLimitAttoEth: bigint
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
