import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import type { Address, Hash, Hex } from '@zoltar/core-shared/evm/ethereum'
import type { ForkOutcomeKey, MarketDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'

type ActionResult = { hash: Hash }

export type ForkAuctionAction =
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'prepareChildPriceFeed'
	| 'prepareChildDependencies'
	| 'createChildUniverse'
	| 'initializeChildHistory'
	| 'prepareForkClaim'
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
type TruthAuctionSettlementMode = 'claim' | 'mixed' | 'refund'
type OracleQueueOperation = 'liquidation' | 'withdrawRep' | 'setVaultUnderwritingLimit' | 'vaultOperations'
type StagedOracleExecutionResult = {
	errorMessage: string | undefined
	operation: OracleQueueOperation
	operationId: bigint
	success: boolean
}

type StagedOracleQueuedResult = {
	isPendingSlot: boolean
	operation: OracleQueueOperation
	operationId: bigint
}

export type OpenOraclePriceSettlement = { status: 'accepted' } | { status: 'unconfirmed' } | { status: 'rejected'; reason: string }

export type OpenOracleActionResult = ActionResult & {
	action: 'approveToken1' | 'approveToken2' | 'createReportInstance' | 'dispute' | 'executeStagedOperation' | 'queueOperation' | 'requestPrice' | 'settle' | 'withdrawBalance' | 'wrapWeth'
	priceSettlement?: OpenOraclePriceSettlement | undefined
	queuedOperation?: StagedOracleQueuedResult
	/** The new report's ID, read from its successful create or pool-price request receipt. */
	reportId?: bigint | undefined
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
	portfolioAddress: Address
	settlementRecoveryAttoRep?: bigint
	mintingCapacityAttoEth?: bigint
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	feeAccrualState?: {
		centralCheckpointTimestamp?: bigint
		centralSettlement?: boolean
		linearFee?: LinearFeeState
		feeEndTimestamp: bigint
		feeIndexRemainder: bigint
		lastUpdatedFeeAccumulator: bigint
		totalFeesOwedRemainder: bigint
	}
	feeEligibleUnderwritingLimitAttoEth: bigint
	hasForkActivity: boolean
	hasForkContinuationEscalationGame: boolean
	initialReportPriorityFeeAttoEthPerGas: bigint
	lastOraclePrice: bigint | undefined
	lastOracleSettlementTimestamp: bigint
	oraclePriceValidUntilTimestamp?: bigint | undefined
	managerAddress: Address
	ordinaryEscalationGameStarted: boolean
	marketDetails: MarketDetails
	parent: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	questionId: string
	statoblastSecurityMultiplierBps: bigint
	securityPoolAddress: Address
	shareTokenSupplyAttoShares: bigint
	systemState: SecurityPoolSystemState
	totalPoolHeldAttoRep: bigint
	totalUnderwritingLimitAttoEth: bigint
	universeHasForked: boolean
	universeId: bigint
}

type OwnForkRepBuckets = {
	vaultRepAtForkAttoRep: bigint
	escalationChildRepPerSelectedOutcomeAttoRep: bigint
	escrowSourceRepAtForkAttoRep: bigint
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

export type AuthenticatedForkClaim = {
	escalationGame: Address
	outcome: ReportingOutcomeKey
	snapshotRoot: Hex
	snapshotLeafCount: bigint
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
	depositor: Address
	parentDepositIndex: bigint
	leafIndex: bigint
}

export type ImportedEscalationDeposit = {
	claimIdentity?: AuthenticatedForkClaim
	claimCheckpoint?: { nextSourceGame: Address; pendingSteps: bigint; complete: boolean; ready: boolean }
	claimAllocation?: { retainedAmountAttoRep: bigint; rewardAmountAttoRep: bigint; retainedCumulativeAttoRep: bigint } | undefined
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
	viewerEscalationMigrationEntitlement?: EscalationMigrationEntitlementStatus | undefined
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

type TruthAuctionMetrics = {
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

export type ForkAuctionDetails = {
	childHistoryReady?: boolean
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
