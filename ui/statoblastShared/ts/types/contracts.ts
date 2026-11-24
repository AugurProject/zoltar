import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/linearFees'
import type { Address, Hash, Hex } from '@zoltar/core-shared/evm/ethereum'
import type { MarketDetails, ReportingOutcomeKey, QuestionLedgerSystemState } from '@zoltar/ui-core-shared/types/contracts.js'

type ActionResult = { hash: Hash }

export type ForkAuctionAction =
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'prepareChildPriceFeed'
	| 'prepareChildDependencies'
	| 'createChildUniverse'
	| 'initializeChildHistory'
	| 'migrateRepToZoltar'
	| 'migrateVault'
	| 'claimParentEscalationDeposits'
	| 'migrateUnresolvedEscalation'
	| 'startCollateralRepairAuction'
	| 'submitBid'
	| 'refundLosingBids'
	| 'withdrawAuctionRefund'
	| 'finalizeCollateralRepairAuction'
	| 'claimAuctionProceeds'
	| 'settleForkedEscalation'
	| 'forkUniverse'
type CollateralRepairAuctionSettlementMode = 'claim' | 'mixed' | 'refund'
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

export type OpenOraclePriceSettlement = { status: 'accepted' } | { status: 'unconfirmed' } | { status: 'deferred'; maxSettlementBaseFee: bigint } | { status: 'rejected'; reason: string }

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
	/** True only when the callback is the escrow a factory-registered shared price feed opened for this report, so settlement needs no return-data gas allowance. */
	trustedSettlementCallback: boolean
	protocolFeeRecipient: Address
	trackDisputes: boolean
	/** OpenOracle FLAG_FEES_ONLY_AT_HALT: disputes pay no fees until the current base amount reaches escalationHalt. */
	feesOnlyAtHalt: boolean
	/** OpenOracle FLAG_FLEXIBLE_ESCALATION: disputes may choose any base amount from the expected amount up to escalationHalt. */
	flexibleEscalation: boolean
	numReports: bigint
	lastReportOppoTime: bigint
}

export type ListedQuestionLedger = {
	securityPoolAddress: Address
	settlementRecoveryAttoRep?: bigint
	mintingCapacityAttoEth?: bigint
	settlementCollateralAttoEth: bigint
	feeAccrualState?: {
		centralCheckpointTimestamp?: bigint
		centralSettlement?: boolean
		linearFee?: LinearFeeState
		feeEndTimestamp: bigint
		lastFeeCheckpointNativeTime: bigint
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
	questionLedgerAddress: Address
	shareTokenSupplyAttoShares: bigint
	systemState: QuestionLedgerSystemState
	totalPoolHeldAttoRep: bigint
	totalUnderwritingLimitAttoEth: bigint
	universeHasForked: boolean
	universeId: bigint
}

export type TradingShareBalances = {
	invalidAttoShares: bigint
	noAttoShares: bigint
	yesAttoShares: bigint
}

/** A fork's child universe as the share token sees it: the canonical question ledger a migration lands in, and what the wallet already migrated into it from each source outcome. */
export type ShareMigrationTarget = {
	canonicalPool: Address | undefined
	migratedAttoShares: TradingShareBalances
	outcomeIndex: bigint
}

/** The fork's child universes as the share token sees them, or why reading them failed; refreshing the pool retries the read. */
export type ShareMigrationTargetsState = readonly ShareMigrationTarget[] | { unavailableReason: string }

export type TradingDetails = {
	maxRedeemableCompleteSetsAttoShares: bigint | undefined
	shareBalances: TradingShareBalances | undefined
	/** Loaded once the pool's universe has forked; absent until then. A failed read leaves the rest of the details usable. */
	shareMigrationTargets?: ShareMigrationTargetsState | undefined
	shareTokenAddress: Address
	universeId: bigint
}

export type TradingActionResult = ActionResult & {
	action: 'createCompleteSet' | 'migrateShares' | 'redeemCompleteSet' | 'redeemShares'
	questionLedgerAddress: Address
	shareOutcome?: ReportingOutcomeKey
	targetOutcomeIndexes?: bigint[]
	universeId: bigint
}

export type EscalationDeposit = {
	originalAttoRep?: bigint | undefined
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
	localPrincipalAttoRep?: bigint | undefined
	balance: bigint
	deposits: EscalationDeposit[]
	importedUserDeposits: ImportedEscalationDeposit[]
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[]
}

export type ReportingSettlementState = 'locked' | 'resolved' | 'migration-required'

type EscalationMigrationEntitlementStatus = {
	initialized: boolean
	materializedByOutcome: Record<ReportingOutcomeKey, boolean>
	totalCurrentAttoRep: bigint
}

type ReportingDetailsBase = {
	reportingBlockedReason?: string
	canTriggerOwnFork?: boolean
	settlementCollateralAttoEth: bigint
	currentTime: bigint
	forkThresholdAttoRep: bigint
	marketDetails: MarketDetails
	nonDecisionThresholdAttoRep: bigint
	parentQuestionLedgerAddress?: Address
	questionOutcome: ReportingOutcomeKey | 'none'
	questionLedgerAddress: Address
	settlementState: ReportingSettlementState
	startBondAttoRep: bigint
	systemState: QuestionLedgerSystemState
	universeId: bigint
	parentWithdrawalEnabled: boolean
	viewerEscalationMigrationEntitlement?: EscalationMigrationEntitlementStatus | undefined
	viewerWalletRepAllowanceAttoRep?: bigint | undefined
	viewerWalletRepBalanceAttoRep?: bigint | undefined
	viewerWalletRepTokenAddress?: Address | undefined
}

export type ActiveReportingDetails = ReportingDetailsBase & {
	status: 'active'
	reportingDepositPool?: Address | undefined
	reportingQuestionId?: bigint
	bindingCapital: bigint
	currentRequiredBond: bigint
	/** Zoltar refuses this universe's fork before this time while its parent fork response period is active. */
	earliestForkTime: bigint
	escalationEndTime: bigint
	latestEscalationEndTime?: bigint | undefined
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
	questionLedgerAddress: Address
	universeId: bigint
}

export type ForkAuctionActionResult = ActionResult & {
	action: ForkAuctionAction
	questionLedgerAddress: Address
	settlementMode?: CollateralRepairAuctionSettlementMode
	universeId: bigint
}
