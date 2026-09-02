import type { Address, Hash, Hex } from '@zoltar/bot-shared/ethereum'
import type { CanonicalUintString } from '../core/units.ts'

export type ChaosEcosystem = 'zoltar' | 'statoblast' | 'open-oracle' | 'trading'
export type OperationRisk = 'low' | 'medium' | 'high' | 'irreversible'
export type OperationClassification = 'selectable' | 'prerequisite' | 'lifecycle-obligation' | 'role-restricted' | 'excluded-dangerous'
export type OperationAbiEntryKind = 'fallback' | 'function' | 'receive'

export interface SnapshotAnchor {
	baseFeePerGas: CanonicalUintString
	blockNumber: string
	blockHash: Hash
	timestamp: string
}

export interface TokenInventory {
	address: Address
	symbol: string
	balance: string
	allowances: Record<string, string>
	openOracleCredit: string
	/**
	 * Anchored OpenOracle internal allowance from this wallet to itself.
	 *
	 * Optionality preserves compatibility with snapshots produced before the
	 * allowance was discovered. The planner fails closed when it is absent.
	 */
	openOracleInternalAllowanceToSelf?: string
}

export interface ShareInventory {
	shareToken: Address
	universeId: string
	invalid: string
	yes: string
	no: string
	isApprovedForAll: Record<string, boolean>
	/** Already-minted child shares, keyed as `<sourceOutcome>:<targetForkOutcome>`. */
	migrationProgressByRoute: Record<string, string>
}

export interface LpInventory {
	pair: Address
	balance: string
	allowanceToRouter: string
}

export interface WalletInventory {
	address: Address
	ethBalanceAttoEth: CanonicalUintString
	openOracleEthCredit: string
	tokens: TokenInventory[]
	shares: ShareInventory[]
	lpTokens: LpInventory[]
}

export interface UniverseSnapshot {
	id: string
	repToken: Address
	forkBurnDivisor?: string
	forkTime: string
	forkQuestionId: string
	forkThresholdAttoRep: CanonicalUintString
	nonDecisionThresholdAttoRep: CanonicalUintString
	initialEscalationDepositAttoRep: CanonicalUintString
	parentUniverseId?: string
	forkingOutcomeIndex?: string
	migrationBalance: string
	/** Canonical cumulative wallet REP split per fork outcome, reconstructed from Zoltar events. */
	migrationRepSplitProgressByOutcome: Record<string, string>
	knownChildOutcomes: string[]
}

export interface QuestionSnapshot {
	id: string
	createdAt: string
	startTime: string
	endTime: string
	numTicks: string
	kind: 'binary' | 'categorical' | 'scalar'
	outcomeLabels: string[]
}

export interface VaultSnapshot {
	address: Address
	feeIndex: string
	repBackingUnits: string
	repBackingAttoRep: CanonicalUintString
	capacityOwnershipAttoRep: CanonicalUintString
	claimableFeesAttoEth: CanonicalUintString
	openInterestAttoEth: CanonicalUintString
	badDebtAttoEth: CanonicalUintString
	disputeStakedAttoRep: CanonicalUintString
}

/** Immutable coordinator inputs used to bound inclusion-time oracle funding. */
export interface OracleRequestFundingSnapshot {
	escalationHaltMultiplierBps: CanonicalUintString
	feePercentage: CanonicalUintString
	gasConsumedOpenOracleReportPrice: CanonicalUintString
	gasUnitsForOneDispute: CanonicalUintString
	initialReportPriorityFeeAttoEthPerGas: CanonicalUintString
	openOracleSecurityMultiplierBps: CanonicalUintString
	protocolFee: CanonicalUintString
	settlementCallbackGasLimit: CanonicalUintString
	targetPriceErrorForDispute: CanonicalUintString
}

export interface DirectEscalationDepositQuoteSnapshot {
	/** Exact REP amount the game preview accepts from the wallet. */
	acceptedAmountAttoRep: CanonicalUintString
	/** Fixed calldata ceiling used by both the anchored preview and mutation. */
	maximumDepositAttoRep: CanonicalUintString
	/** Whether the exact wallet-originated mutation succeeded in anchored simulation. */
	mutationExpectedSuccess: boolean
	/** Exact resulting outcome balance returned by the canonical preview. */
	resultingCumulativeAmountAttoRep: CanonicalUintString
}

export interface PoolSnapshot {
	address: Address
	/** Exact authenticated size of the canonical pool vault registry. */
	canonicalVaultCount: CanonicalUintString
	parent: Address
	universeId: string
	questionId: string
	repToken: Address
	shareToken: Address
	coordinator: Address
	escalationGame: Address
	/** Canonical operational-resolution state used to classify inherited carry work. */
	escalationResolved: boolean
	/** Whether the escalation game has committed the carry snapshot required for inherited claims. */
	forkCarrySnapshotInitialized: boolean
	/** Canonical final escalation outcome, or the contract's unresolved sentinel. */
	escalationFinalQuestionResolution: number
	truthAuction: Address
	systemState: number
	awaitingForkContinuation: boolean
	questionOutcome: number
	settlementCollateralAttoEth: CanonicalUintString
	projectedSettlementCollateralAttoEth: CanonicalUintString
	shareTokenSupplyAttoShares: CanonicalUintString
	currentMintingCapacityAttoEth: CanonicalUintString
	totalCapacityOwnershipAttoRep: CanonicalUintString
	statoblastSecurityMultiplierBps: string
	unassignedRepBackingAttoRep: CanonicalUintString
	unassignedCapacityOwnershipAttoRep: CanonicalUintString
	unassignedBadDebtAttoEth: CanonicalUintString
	totalBadDebtAttoEth: CanonicalUintString
	feeIndex: string
	lastUpdatedFeeAccumulator: string
	parentForkActivationTime: string
	poolRepBalanceAttoRep: CanonicalUintString
	totalRepBackingUnits: string
	escalationRepBalanceAttoRep: CanonicalUintString
	escalationResidualSweepExpectedSuccess: boolean
	minimumVaultRepDepositAttoRep: CanonicalUintString
	/** Smallest REP input whose anchored post-transfer backing round-trip satisfies the vault minimum. */
	minimumSafeWalletVaultDepositAttoRep: CanonicalUintString
	oraclePriceValid: boolean
	requestPriceCostAttoEth: CanonicalUintString
	oracleSettlementTime: string
	lastRepPerEthPrice: string
	lastOracleSettlementTimestamp: string
	stagedOperationCounter: string
	totalPoolHeldAttoRep: CanonicalUintString
	minimumToken1ReportAttoEth: CanonicalUintString
	oracleRequestFunding: OracleRequestFundingSnapshot
	pendingReportId: string
	pendingReportSettled: boolean
	forkActivationTime: string
	forkOutcomeIndex: string
	forkOwnQuestion: boolean
	/** REP already attributed to this pool by parent-vault migration. */
	forkMigratedAttoRep: CanonicalUintString
	/** Fork-time pool-held REP bucket that migrateRepToZoltar must split into every child route. */
	forkRepMigrationTargetAttoRep: CanonicalUintString
	/** Canonical cumulative pool-held REP split per fork outcome, reconstructed from forker events. */
	forkRepMigrationProgressByOutcome: Record<string, string>
	forkUnresolvedEscalation: boolean
	walletEscalationMaterializedOutcomes: [boolean, boolean, boolean]
	/** Generic universe-fork outcomes whose unresolved entitlement migration simulates successfully at the anchor. */
	unresolvedEscalationMigrationReadyOutcomes: string[]
	escalationCanTriggerOwnFork: boolean
	escalationForkContinuation: boolean
	escalationForkCarryFundingComplete: boolean
	escalationForkResumedAt: string
	escalationGameEndTime: string
	escalationHasReachedNonDecision: boolean
	escalationNonDecisionState: number
	escalationStartBondAttoRep: CanonicalUintString
	escalationNonDecisionThresholdAttoRep: CanonicalUintString
	escalationOutcomeBalancesAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString]
	/** Anchored direct-wallet quotes for outcomes Invalid/Yes/No. */
	directEscalationDepositQuotes: [DirectEscalationDepositQuoteSnapshot, DirectEscalationDepositQuoteSnapshot, DirectEscalationDepositQuoteSnapshot]
	/** Maximum arguments proven by anchored simulation for outcomes Invalid/Yes/No. */
	safeEscalationDepositMaximumsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString]
	/** True only when every canonical vault was included in this anchored snapshot. */
	vaultDiscoveryComplete: boolean
	vaults: VaultSnapshot[]
	/** Whether the complete authenticated vault registry contains the configured wallet. */
	walletVaultRegistered: boolean
}

export interface StagedOperationSnapshot {
	coordinator: Address
	id: string
	operation: number
	operator: Address
	targetVault: Address
	receiverVault: Address
	amount: string
	queuedAt: string
	validForSeconds: string
	isPendingSettlement: boolean
	/** True only when an anchored direct simulation proves the underlying mutation succeeds. */
	executionExpectedSuccess: boolean
	/** Exact ABI-encoded return bytes quorum-agreed during anchored discovery. */
	executionExpectedResult: Hex
	/** Exact liquidation policy arguments used by the successful direct downstream simulation. */
	liquidationMinimumReceiverHealthFactorBps: string
	liquidationMinPriceDistanceBps: string
	snapshotTargetBackingUnits: string
	snapshotTargetCapacityOwnershipAttoRep: CanonicalUintString
	snapshotTargetOpenInterestAttoEth: CanonicalUintString
	snapshotTargetDisputeStakedAttoRep: CanonicalUintString
	snapshotTotalPoolHeldAttoRep: CanonicalUintString
	snapshotTotalRepBackingUnits: string
	liquidationApprovalId: Hash
	reservedLiquidationDebtAttoEth: CanonicalUintString
}

export interface EscalationDepositSnapshot {
	pool: Address
	escalationGame: Address
	vault: Address
	outcome: number
	depositIndex: string
	parentDepositIndex: string
	amountAttoRep: CanonicalUintString
	claimed: boolean
}

/** A serialization-safe carried-deposit proof verified against one canonical anchor. */
export interface ForkedCarryDepositProofSnapshot {
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	cumulativeAmountAttoRep: CanonicalUintString
	sourceNodeId: string
	leafIndex: string
	merkleMountainRangeSiblings: Hash[]
	merkleMountainRangePeakIndex: string
	nullifierSiblings: Hash[]
}

/** One independently executable inherited escalation withdrawal. */
export interface ForkedCarryWithdrawalSnapshot {
	pool: Address
	game: Address
	sourcePool: Address
	sourceGame: Address
	claimSourceGame: Address
	snapshotId: Hash
	outcome: 0 | 1 | 2
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	sourceNodeId: string
	proof: ForkedCarryDepositProofSnapshot
	resultingCarryRoot: Hash
	resultingNullifierRoot: Hash
	resultingUnresolvedTotalAttoRep: CanonicalUintString
	amountToWithdrawAttoRep: CanonicalUintString
	burnAmountAttoRep: CanonicalUintString
	preflightExpectedResult: Hex
}

/** Lightweight canonical identity retained independently of bounded proof work. */
export interface ForkedCarryWithdrawalPresenceSnapshot {
	pool: Address
	game: Address
	sourceGame: Address
	claimSourceGame: Address
	outcome: 0 | 1 | 2
	parentDepositIndex: string
	sourceNodeId: string
}

export interface MigrationRepSplitProgressSnapshot {
	universeId: string
	outcomeIndex: string
	childUniverseId: string
	childMigrationRepAmountAttoRep: CanonicalUintString
}

export interface ChildRepSplitProgressSnapshot {
	pool: Address
	outcomeIndex: string
	childPoolRepSplitAttoRep: CanonicalUintString
}

export interface AuctionBidSnapshot {
	tick: string
	index: string
	amountAttoEth: CanonicalUintString
	refunded: boolean
}

export interface AuctionRefundSnapshot {
	generation: Hash
	pendingAttoEth: CanonicalUintString
}

export interface AuctionSnapshot {
	address: Address
	pool: Address
	startTime: string
	endTime: string
	finalized: boolean
	minimumBidAttoEth: CanonicalUintString
	hasClearingPrice: boolean
	clearingTick: string
	underfunded: boolean
	underfundedWinningAttoEth: CanonicalUintString
	pendingEthRefund: string
	pendingEthRefundGeneration?: Hash
	bids: AuctionBidSnapshot[]
}

export interface OracleGameSnapshot {
	reportId: string
	openOracle: Address
	stateHash: Hash
	currentAmount1: string
	currentAmount2: string
	currentReporter: Address
	reportTimestamp: string
	settlementTime: string
	settlementTimestamp: string
	token1: Address
	token2: Address
	disputeDelay: string
	multiplier: number
	escalationHalt: string
	flags: number
	game: {
		lastReportOppoTime: string
		protocolFeeRecipient: Address
		settlerReward: string
		numReports: number
		feePercentage: number
		callbackContract: Address
		callbackGasLimit: number
		protocolFee: number
	}
	helper: {
		creator: Address
		blockTimestamp: string
		blockNumber: string
	}
	settleAfterTimestamp?: string
	disputeAfterTimestamp?: string
	disputeBeforeTimestamp?: string
}

export interface PairSnapshot {
	address: Address
	pool: Address
	shareToken: Address
	universeId: string
	feeBps: number
	status: number
	yesReserve: string
	noReserve: string
	/** Live ERC-1155 balances used after the pair synchronizes at execution. */
	effectiveYesReserve: string
	effectiveNoReserve: string
	totalSupply: string
	walletLiquidity: string
}

export interface EcosystemDeployments {
	zoltar: Address
	questionData: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	openOracle: Address
	weth: Address
	tradingFactory: Address
	tradingRouter: Address
	uniswapV3Factory?: Address | undefined
}

export interface EcosystemSnapshot {
	schemaVersion: 1
	chainId: number
	anchor: SnapshotAnchor
	deployments: EcosystemDeployments
	wallet: WalletInventory
	questions: QuestionSnapshot[]
	universes: UniverseSnapshot[]
	pools: PoolSnapshot[]
	stagedOperations: StagedOperationSnapshot[]
	escalationDeposits: EscalationDepositSnapshot[]
	/** Verified, unconsumed inherited deposits owned by the configured wallet. */
	forkedCarryWithdrawals?: ForkedCarryWithdrawalSnapshot[]
	/** Complete raw identities used for lifecycle absence confirmation. */
	forkedCarryWithdrawalPresence?: ForkedCarryWithdrawalPresenceSnapshot[]
	auctions: AuctionSnapshot[]
	reports: OracleGameSnapshot[]
	pairs: PairSnapshot[]
	tradingDeployment?: { factory: boolean; router: boolean }
	genesisUniswap?: { factory: boolean; initialized: boolean; liquidity: string; pool?: Address | undefined; proxy: boolean; seeder: boolean }
	warnings: string[]
}

export interface EligibilityResult {
	eligible: boolean
	blockers: string[]
}

export type OperationEvidence =
	| { kind: 'event'; emitter: Address; topic0: Hash; signature: string }
	| {
			kind: 'decoded-event-field'
			emitter: Address
			topic0: Hash
			signature: string
			abi: string
			indexed: Record<string, string>
			field: string
			equals: string | number | boolean
			/** A missing receipt event leaves a lifecycle workflow pending for canonical discovery. */
			canonicalLifecycleConfirmation?: true
	  }
	| { kind: 'balance-change'; account: Address; asset: 'ETH' | Address; direction: 'increase' | 'decrease' | 'any' }
	| { kind: 'storage-postcondition'; contract: Address; abi: string; functionName: string; args: Array<string | boolean>; relation: 'changed' | 'equals' | 'greater-than' | 'at-least'; expected?: string }
	| { kind: 'receipt-success' }

/**
 * Maximum principal that a step can debit from the chaos wallet, excluding gas.
 *
 * The executor treats these declarations as fail-closed limits and sums them
 * across a multi-step plan. An ERC-1155 entry identifies one token id; callers
 * must emit a separate entry for every outcome share consumed by a batch call.
 */
export type OperationWalletAssetDebit =
	| { kind: 'native'; asset: 'ETH'; amount: string }
	| { kind: 'erc20'; asset: Address; amount: string; category: 'rep' | 'weth' | 'lp-token' | 'other' }
	| { kind: 'erc1155'; asset: Address; tokenId: string; amount: string; category: 'outcome-share' }
	| { kind: 'open-oracle-credit'; openOracle: Address; asset: 'ETH' | Address; amount: string; category: 'rep' | 'weth' | 'other' }
	| { kind: 'security-pool-vault-rep'; pool: Address; vault: Address; amount: string; category: 'rep' }

/**
 * An exact read-only call that must succeed at the same canonical block as the
 * transaction simulation. This is needed when an outer protocol call catches
 * a downstream revert and reports semantic failure through an event instead of
 * reverting the transaction itself.
 */
export interface OperationPreflightCall {
	caller: Address
	data: Hex
	expectedResult: Hex
	label: string
	to: Address
	value?: string
}

export interface OperationStep {
	id: string
	label: string
	to: Address
	data: Hex
	value?: string
	gasLimit: string
	evidence: OperationEvidence[]
	preflightCalls: OperationPreflightCall[]
	walletAssetDebits: OperationWalletAssetDebit[]
}

export interface OperationTerminalSubmission {
	kind: 'private-next-block'
	maximumFeePerGas: CanonicalUintString
}

export type OperationContinuationDisposition = 'cleanup-only'

export interface OperationPlan {
	id: string
	definitionId: string
	ecosystem: ChaosEcosystem
	label: string
	risk: OperationRisk
	classification: 'selectable' | 'lifecycle-obligation'
	priority: 'random' | 'urgent'
	obligation: boolean
	createdAtBlock: string
	deadlineTimestamp?: string
	/** Semantic protocol deadline. Passing it can terminally supersede an obligation. */
	semanticDeadlineBlockNumber?: string
	/** Transaction/calldata horizon. Passing it requires rediscovery, never obligation tombstoning. */
	lastValidBlockNumber?: string
	/** Seed that must be reused when rebuilding a durable workflow after restart. */
	planningSeed: number
	steps: OperationStep[]
	/** Explicitly identifies a continuation plan that only unwinds confirmed preparation. */
	continuationDisposition?: OperationContinuationDisposition
	/** Maximum additional revoke transactions needed after a terminal step failure. */
	maximumCleanupTransactionCount?: number
	/** A fresh signing constraint that applies only to the terminal step. */
	terminalSubmission?: OperationTerminalSubmission
	postconditions: string[]
	metadata: Record<string, string | number | boolean>
}

export type OperationPlanDraft = Omit<OperationPlan, 'planningSeed'>

/** Configured immutable-topology envelopes that novel plans must preserve. */
export interface ImmutableTopologyPlanningCapacity {
	maxPools: number
	maxQuestions: number
	maxStagedOperationsPerPool: number
	maxUniverses: number
	maxVaultsPerPool: number
	maximumAggregateItems: number
}

export interface PlanningOptions {
	seed: number
	/** Exact linked topology selected by the genesis initializer. Ordinary random planning leaves this absent. */
	genesisInitializationTarget?: {
		pair?: Address | undefined
		pool?: Address | undefined
		questionId?: string | undefined
		universeId: string
	}
	allowHighRisk?: boolean
	allowIrreversibleOperations?: boolean
	/** Required before a plan may create a question, universe, or pool. */
	immutableTopologyCapacity?: ImmutableTopologyPlanningCapacity
	maximumBlockIntervalSeconds: number
	maxEthSpendAttoEth?: CanonicalUintString
	maximumGasCostAttoEth?: CanonicalUintString
	maxRepSpendAttoRep?: CanonicalUintString
	minimumEthReserveAttoEth?: CanonicalUintString
	minimumRepReserveAttoRep?: CanonicalUintString
	submissionMode?: 'private' | 'public'
	workflowValidForBlocks?: number
}

export interface OperationContinuationContext {
	confirmedStepIds: readonly string[]
	continuationDisposition?: OperationContinuationDisposition
	previousPlan: OperationPlan
}

export interface OperationDefinition {
	id: string
	label: string
	ecosystem: ChaosEcosystem
	contract: string
	method: string
	/** Defaults to `function`; coverage-only rows retain receive and fallback identity explicitly. */
	abiEntryKind?: OperationAbiEntryKind
	risk: OperationRisk
	classification: OperationClassification
	/** False only for a coverage row that cannot be planned as its own operation. */
	independentlyExecutable?: boolean
	description: string
	discoveryInputs: string[]
	evaluate(snapshot: EcosystemSnapshot, options: PlanningOptions): EligibilityResult
	buildPlan(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlanDraft | undefined
	/** Rebuilds or safely cleans up a partially confirmed selectable workflow. */
	buildContinuationPlan?(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext): OperationPlanDraft | undefined
	/**
	 * Builds every currently eligible durable instance in one deterministic pass.
	 * Required for lifecycle definitions; random selection happens only after the
	 * complete set has been synchronized with durable state.
	 */
	buildLifecyclePlans?(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlanDraft[]
	/**
	 * Enumerates raw protocol identities independently of execution policy and
	 * eligibility. Required for lifecycle definitions by the catalog invariant.
	 */
	enumerateLifecyclePresence?(snapshot: EcosystemSnapshot, options: PlanningOptions): Array<Record<string, string | number | boolean>>
	/**
	 * Enumerates every raw identity whose protocol phase is currently due and
	 * must obstruct unrelated novelty. This is independent of local execution
	 * policy and, unlike executable plan construction, must not be paginated.
	 * Required for lifecycle definitions by the catalog invariant.
	 */
	enumerateLifecycleObstructingPresence?(snapshot: EcosystemSnapshot, options: PlanningOptions): Array<Record<string, string | number | boolean>>
}

export interface EvaluatedOperation {
	definition: Omit<OperationDefinition, 'evaluate' | 'buildPlan' | 'buildContinuationPlan' | 'buildLifecyclePlans' | 'enumerateLifecycleObstructingPresence' | 'enumerateLifecyclePresence'>
	eligibility: EligibilityResult
	plan?: OperationPlan
}

export interface CanonicalLifecyclePresence {
	definitionId: string
	ecosystem: ChaosEcosystem
	metadata: Record<string, string | number | boolean>
	/** True only while this exact raw identity is canonically due. */
	blocksNovelty: boolean
}
