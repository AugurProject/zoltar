import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

type Interaction = {
	call: string
	caller: string
	declarations: ContractDeclaration[]
	effect: string
	preconditions: string
	signals: string
}

type ContractDeclaration = {
	kind?: 'receive'
	name: string
	sourcePath?: string
}

type ContractReference = {
	interactions: Interaction[]
	name: string
	purpose: string
	readSurface: string
	sourcePath: string
}

const outputPath = 'docs/contract-interaction-reference.md'

const eventSourceByName: Record<string, string> = {
	AuctionStarted: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	AuctionFinalized: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	AuthorizationUpdated: 'solidity/contracts/peripherals/interfaces/IShareToken.sol',
	BidSettled: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	BidSubmitted: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	CarryDepositConsumed: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	ClaimAuctionProceeds: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	ClaimDeposit: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ClaimForkedEscalationDepositsToWallet: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	CompleteSetCreated: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	CompleteSetRedeemed: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	CoordinatorStateCheckpoint: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	DeployChild: 'solidity/contracts/Zoltar.sol',
	DepositOnOutcome: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	DepositRep: 'solidity/contracts/peripherals/SecurityPool.sol',
	DepositToEscalationGame: 'solidity/contracts/peripherals/SecurityPool.sol',
	EscalationGameSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	ExecutedStagedOperation: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ForkContinuationResumed: 'solidity/contracts/peripherals/EscalationGameState.sol',
	GameContinuedFromFork: 'solidity/contracts/peripherals/EscalationGameState.sol',
	GameStarted: 'solidity/contracts/peripherals/EscalationGameState.sol',
	LocalDepositAppended: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	Migrate: 'solidity/contracts/peripherals/tokens/ShareToken.sol',
	VaultMigrationCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	MigrationRepAdded: 'solidity/contracts/Zoltar.sol',
	MigrationRepSplit: 'solidity/contracts/Zoltar.sol',
	NonDecisionReached: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	PendingOperationRecoveryConsumed: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PendingReportRecovered: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ParentRepLocked: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	PerformWithdrawRep: 'solidity/contracts/peripherals/SecurityPool.sol',
	PoolForkModeActivated: 'solidity/contracts/peripherals/SecurityPool.sol',
	PriceReportRejected: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PriceReported: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PriceRequested: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	RedeemRep: 'solidity/contracts/peripherals/SecurityPool.sol',
	RepEthPriceSet: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ResidualRepSweptToSecurityPool: 'solidity/contracts/peripherals/EscalationGameState.sol',
	SecurityPoolSet: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	SecurityPoolForkSnapshot: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	SharesRedeemed: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	StagedOperationQueued: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	SystemStateSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	TruthAuctionFinalized: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	TruthAuctionStarted: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	UniverseForked: 'solidity/contracts/Zoltar.sol',
	PoolAccountingCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	VaultAccountingCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	VaultLiquidated: 'solidity/contracts/peripherals/SecurityPool.sol',
}

const entrypointSignaturesBySource: Record<string, Record<string, string[]>> = {
	'solidity/contracts/Zoltar.sol': {
		addRepToMigrationBalance: ['public(uint248,uint256)'],
		deployChild: ['public(uint248,uint256)'],
		forkUniverse: ['public(uint248,uint256)'],
		splitMigrationRep: ['public(uint248,uint256,uint256[])'],
	},
	'solidity/contracts/peripherals/EscalationGame.sol': {
		recordDepositFromSecurityPool: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
		resumeFromFork: ['external()'],
		start: ['external(uint256,uint256)'],
		startFromFork: ['external(uint256,uint256,uint256)'],
	},
	'solidity/contracts/peripherals/EscalationGameCarry.sol': {
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
	},
	'solidity/contracts/peripherals/EscalationGameEscrow.sol': {
		exportForkedEscrowByOutcome: ['external(address,address)'],
		exportForkedEscrowByOutcomeWithoutTransfer: ['external(address)'],
		exportVaultUnresolvedTotals: ['external(address,address)'],
		exportVaultUnresolvedTotalsWithoutTransfer: ['external(address)'],
		recordForkedEscrowForOutcome: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
	},
	'solidity/contracts/peripherals/EscalationGameSettlement.sol': {
		claimDepositForWinning: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		claimDepositForWinningWithoutTransfer: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		drainAllRep: ['external(address)'],
		exportUnresolvedDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
		sweepResidualRepToSecurityPool: ['external()'],
		withdrawDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
	},
	'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol': {
		consumeEscalationDepositNotional: ['external(uint256)'],
		executeStagedOperation: ['public(uint256)'],
		openOracleCallback: ['external(uint256,uint256,uint256,uint256,address,address)'],
		recoverSettledPendingReport: ['public()'],
		requestPrice: ['public(uint256)'],
		requestPriceIfNeededAndStageOperation: ['public(OperationType,address,uint256,uint256,uint256)'],
		setRepEthPrice: ['public(uint256)'],
		setSecurityPool: ['public(ISecurityPool)'],
	},
	'solidity/contracts/peripherals/SecurityPool.sol': {
		activateForkMode: ['external()'],
		addFeeEligibleSecurityBondAllowance: ['external(address,uint256)'],
		authorizeChildPool: ['external(ISecurityPool)'],
		configureVault: ['external(address,uint256,uint256,uint256)'],
		createCompleteSet: ['external()'],
		depositRep: ['external(uint256)'],
		depositToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[64][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
		initializeForkedEscalationGame: ['external(uint256,uint256,uint256)'],
		performLiquidation: ['external(address,address,uint256,uint256,uint256,uint256,uint256)'],
		performSetSecurityBondsAllowance: ['external(address,uint256)'],
		performWithdrawRep: ['external(address,uint256)'],
		receive: ['external payable()'],
		redeemCompleteSet: ['external(uint256)'],
		redeemFees: ['external(address)'],
		redeemRep: ['external(address)'],
		redeemShares: ['external()'],
		resumeForkedEscalationGame: ['external()'],
		setAwaitingForkContinuation: ['external(bool)'],
		setOwnershipDenominator: ['external(uint256)'],
		setPoolFinancials: ['external(uint256,uint256,uint256)'],
		setStartingParams: ['external(uint256,uint256)'],
		setSystemState: ['external(SystemState)'],
		setTotalShares: ['external(uint256)'],
		transferEth: ['external(address payable,uint256)'],
		updateCollateralAmount: ['public()'],
		updateRetentionRate: ['public()'],
		updateVaultFees: ['public(address)'],
		withdrawForkedEscalationDeposits: ['external(QuestionOutcome,CarriedDepositProof[])'],
		withdrawFromEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256[])'],
	},
	'solidity/contracts/peripherals/SecurityPoolForker.sol': {
		claimAuctionProceeds: ['external(ISecurityPool,address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		claimForkedEscalationDeposits: ['external(ISecurityPool,address,BinaryOutcomes.BinaryOutcome,uint256[])'],
		createChildUniverse: ['external(ISecurityPool,uint256)'],
		finalizeTruthAuction: ['external(ISecurityPool)'],
		forkZoltarWithOwnEscalationGame: ['external(ISecurityPool)'],
		initiateSecurityPoolFork: ['external(ISecurityPool)'],
		migrateRepToZoltar: ['external(ISecurityPool,uint256[])'],
		migrateVault: ['public(ISecurityPool,uint256)'],
		migrateVaultWithUnresolvedEscalation: ['external(ISecurityPool,address,uint256)'],
		settleAuctionBids: ['external(ISecurityPool,address,IUniformPriceDualCapBatchAuction.TickIndex[],IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startTruthAuction: ['external(ISecurityPool)'],
	},
	'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol': {
		finalize: ['external()'],
		refundLosingBids: ['external(IUniformPriceDualCapBatchAuction.TickIndex[])'],
		refundLosingBidsFor: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startAuction: ['public(uint256,uint256)'],
		submitBid: ['external(int256)'],
		withdrawBids: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
	},
	'solidity/contracts/peripherals/tokens/ShareToken.sol': {
		authorize: ['external(ISecurityPool)'],
		burnCompleteSets: ['external(uint248,address,uint256)'],
		burnTokenIdAndGetRemainingSupply: ['external(uint256,address)'],
		migrate: ['external(uint256,uint256[])'],
		mintCompleteSets: ['external(uint248,address,uint256)'],
	},
}

assertDeclarationCheckerRegression()

const contractReferences: ContractReference[] = [
	{
		name: 'Zoltar',
		purpose: 'Registers universe forks and turns burned parent REP into branch-specific child REP.',
		readSurface: 'Use `universes`, `getForkTime`, `forkQuestionMatches`, `getRepToken`, `getForkThreshold`, `getUniverseTheoreticalSupply`, `getChildUniverseId`, `getDeployedChildUniverses`, and `getMigrationRepBalance` to reconstruct universe and migration state.',
		sourcePath: 'solidity/contracts/Zoltar.sol',
		interactions: [
			{
				call: '`forkUniverse(universeId, questionId)`',
				caller: 'Any address able to fund the current fork threshold',
				effect: 'Records the fork, removes threshold REP from the parent universe, and credits the caller with the post-haircut migration balance.',
				declarations: [{ name: 'forkUniverse' }],
				preconditions: 'Initialized and unforked universe; existing ended question; sufficient caller REP. Genesis REP requires allowance; child REP is burned directly without allowance.',
				signals: '`UniverseForked`',
			},
			{
				call: '`deployChild(universeId, outcomeIndex)`',
				caller: 'Anyone',
				effect: 'Deploys the deterministic child REP token and initializes the child universe.',
				declarations: [{ name: 'deployChild' }],
				preconditions: 'Parent forked; outcome is well formed; child is not already deployed.',
				signals: '`DeployChild`',
			},
			{
				call: '`addRepToMigrationBalance(universeId, amount)`',
				caller: 'Parent REP holder',
				effect: "Burns or sinks additional parent REP and increases the caller's reusable migration balance.",
				declarations: [{ name: 'addRepToMigrationBalance' }],
				preconditions: 'Universe forked; sufficient caller REP. Genesis REP requires allowance; child REP is burned directly without allowance.',
				signals: '`MigrationRepAdded`',
			},
			{
				call: '`splitMigrationRep(universeId, amount, outcomeIndexes)`',
				caller: 'Migration-balance holder',
				effect: 'Mints `amount` of child REP into every selected branch, deploying missing children lazily.',
				declarations: [{ name: 'splitMigrationRep' }],
				preconditions: "Universe forked; every outcome is well formed; cumulative amount per child does not exceed the caller's migration balance.",
				signals: '`DeployChild` when needed; `MigrationRepSplit` per branch',
			},
		],
	},
	{
		name: 'SecurityPool',
		purpose: 'Holds ETH collateral and REP underwriting, accounts for vaults and fees, mints shares, and routes local escalation.',
		readSurface: 'Use the public accounting fields plus `getVaults`, `getActiveVaults`, `sharesToCash`, `cashToShares`, `repToPoolOwnership`, `poolOwnershipToRep`, `getTotalRepBalance`, and `isEscalationResolved`. `SystemState` determines which transaction paths remain open.',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
		interactions: [
			{
				call: '`depositRep(repAmount)`',
				caller: 'Vault owner',
				effect: 'Transfers REP into the pool and credits proportional pool ownership.',
				declarations: [{ name: 'depositRep' }],
				preconditions: 'Operational, unforked, unresolved pool; resulting vault REP meets the minimum.',
				signals: '`DepositRep`',
			},
			{
				call: '`redeemFees(vault)`',
				caller: 'Anyone; ETH is always sent to `vault`',
				effect: "Accrues and pays the vault's unpaid ETH fees.",
				declarations: [{ name: 'redeemFees' }],
				preconditions: 'Pool can send the resulting ETH payment.',
				signals: '`VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`',
			},
			{
				call: '`createCompleteSet()` with ETH',
				caller: 'Trader',
				effect: 'Adds collateral and mints one `Invalid`, `Yes`, and `No` share per complete-set unit.',
				declarations: [{ name: 'createCompleteSet' }],
				preconditions: 'Operational, unforked, unresolved, not awaiting continuation; positive ETH converts to at least one complete-set unit; bond capacity covers the new collateral.',
				signals: '`CompleteSetCreated` and `PoolAccountingCheckpoint`',
			},
			{
				call: '`redeemCompleteSet(completeSetAmount)`',
				caller: 'Complete-set holder',
				effect: 'Burns equal balances of all three outcomes and returns ETH at the current collateral-per-share rate.',
				declarations: [{ name: 'redeemCompleteSet' }],
				preconditions: 'Operational and unforked; caller owns the complete set.',
				signals: '`CompleteSetRedeemed` and `PoolAccountingCheckpoint`',
			},
			{
				call: '`redeemShares()`',
				caller: 'Winning-share holder',
				effect: "Burns the caller's full winning balance and pays its pro-rata remaining collateral.",
				declarations: [{ name: 'redeemShares' }],
				preconditions: 'Operational pool with a final outcome.',
				signals: '`SharesRedeemed` and `PoolAccountingCheckpoint`',
			},
			{
				call: '`redeemRep(vault)`',
				caller: 'Anyone; REP is always sent to `vault`',
				effect: "Burns the vault's pool-ownership claim and returns its proportional REP.",
				declarations: [{ name: 'redeemRep' }],
				preconditions: 'Operational pool with a final outcome; no escalation escrow remains; vault has redeemable REP.',
				signals: '`RedeemRep`',
			},
			{
				call: '`depositToEscalationGame(outcome, maxAmount)`',
				caller: 'Vault owner',
				effect: 'Deploys the local game on the first deposit, removes enough vault ownership, and escrows accepted REP on the selected outcome.',
				declarations: [{ name: 'depositToEscalationGame' }],
				preconditions: 'Question end has passed; pool operational in an unforked universe and not awaiting continuation; outcome and amount accepted; remaining vault and pool backing stay solvent; fresh price when allowance is nonzero.',
				signals: '`EscalationGameSet` on first deposit; `DepositToEscalationGame`',
			},
			{
				call: '`withdrawFromEscalationGame(outcome, depositIndexes)`',
				caller: 'Anyone; all selected deposits must belong to one beneficiary vault',
				effect: 'Settles local deposits and routes any winning REP to their recorded depositor.',
				declarations: [{ name: 'withdrawFromEscalationGame' }],
				preconditions: 'Operational pool and final outcome; external-fork timing may require migration instead.',
				signals: 'Escalation-game `ClaimDeposit` and `CarryDepositConsumed`',
			},
			{
				call: '`withdrawForkedEscalationDeposits(outcome, proofs)`',
				caller: 'Anyone; all proofs must name one beneficiary vault',
				effect: 'Verifies and consumes carried proofs, then pays winning child REP to the recorded depositor.',
				declarations: [{ name: 'withdrawForkedEscalationDeposits' }],
				preconditions: 'Operational child pool with a final outcome and initialized continuation game.',
				signals: 'Escalation-game `ClaimDeposit` and `CarryDepositConsumed`',
			},
			{
				call: '`updateCollateralAmount()`, `updateRetentionRate()`, `updateVaultFees(vault)`',
				caller: 'Anyone',
				effect: "Advances fee, collateral, retention, or vault accounting without transferring the caller's assets.",
				declarations: [{ name: 'updateCollateralAmount' }, { name: 'updateRetentionRate' }, { name: 'updateVaultFees' }],
				preconditions: 'No special caller permission; each function may intentionally no-op at a boundary.',
				signals: '`PoolAccountingCheckpoint` or `VaultAccountingCheckpoint` when state changes',
			},
			{
				call: '`performWithdrawRep`, `performLiquidation`, `performSetSecurityBondsAllowance`',
				caller: "This pool's `OpenOraclePriceCoordinator` only",
				effect: "Executes the corresponding solvency-sensitive vault operation with the coordinator's fresh REP/ETH price.",
				declarations: [{ name: 'performWithdrawRep' }, { name: 'performLiquidation' }, { name: 'performSetSecurityBondsAllowance' }],
				preconditions: 'Operational, unresolved pool in an unforked universe; coordinator price is fresh; operation-specific solvency and snapshot checks pass.',
				signals: '`PerformWithdrawRep`, `VaultLiquidated`, `VaultAccountingCheckpoint`, or `PoolAccountingCheckpoint`',
			},
			{
				call: '`setStartingParams(...)`',
				caller: '`SecurityPoolFactory` only',
				effect: 'Seeds fee timing, retention, collateral, and inherited child price during deployment.',
				declarations: [{ name: 'setStartingParams' }],
				preconditions: 'Deployment wiring through the factory.',
				signals: '`PoolAccountingCheckpoint`',
			},
			{
				call: '`activateForkMode`, continuation initialization/resume, `setAwaitingForkContinuation`, and `setSystemState`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'activateForkMode' }, { name: 'initializeForkedEscalationGame' }, { name: 'initializeForkCarrySnapshotWithResolutionBalances' }, { name: 'resumeForkedEscalationGame' }, { name: 'setAwaitingForkContinuation' }, { name: 'setSystemState' }],
				effect: 'Freezes a parent, initializes or resumes a child continuation, and advances forker-controlled lifecycle state.',
				preconditions: 'Correct forker-controlled lifecycle phase and function-specific continuation data.',
				signals: '`PoolForkModeActivated`, continuation events, and `SystemStateSet`',
			},
			{
				call: '`configureVault`, accounting setters, pool drains/transfers, and `authorizeChildPool`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'configureVault' }, { name: 'setOwnershipDenominator' }, { name: 'setTotalShares' }, { name: 'setPoolFinancials' }, { name: 'transferEth' }, { name: 'authorizeChildPool' }],
				effect: 'Configures migrated or auction-settled vault and pool state, authorizes children, and transfers migration assets.',
				preconditions: 'Correct forker-controlled migration or finalized-auction settlement context plus function-specific accounting and balance constraints.',
				signals: 'Vault/configuration events and the corresponding token or ETH transfers',
			},
			{
				call: '`addFeeEligibleSecurityBondAllowance(vault, amount)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'addFeeEligibleSecurityBondAllowance' }],
				effect: 'Adds newly auction-claimed security-bond allowance to the live fee denominator and clears the pooled fee-index rounding remainder.',
				preconditions: 'Finalized truth-auction settlement; the resulting fee-eligible allowance cannot exceed total security-bond allowance.',
				signals: '`ClaimAuctionProceeds`, `VaultAccountingCheckpoint`, and `PoolAccountingCheckpoint`',
			},
			{
				call: 'Direct ETH transfer to `receive()`',
				caller: "Forker, this pool's truth auction, or parent pool only",
				effect: 'Accepts protocol-routed ETH used by migration and auction settlement. Forced ETH remains raw, unaccounted surplus rather than collateral or fees.',
				declarations: [{ kind: 'receive', name: 'receive' }],
				preconditions: 'Sender is one of the three authorized protocol addresses. Forced ETH bypasses this ordinary-call guard.',
				signals: 'No dedicated receive event; the calling protocol step emits its own event',
			},
		],
	},
	{
		name: 'SecurityPoolForker',
		purpose: 'Freezes parent pools, creates selected child pools, migrates vault and escalation state, and settles collateral-repair auctions.',
		readSurface: 'Use `forkData`, `getMigratedRep`, `getEscalationMigrationEntitlementStatus`, `getOwnForkRepBuckets`, `getOwnForkMigrationStatus`, `getMigrationProxyAddress`, and `getQuestionOutcome` to reconstruct fork progress.',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
		interactions: [
			{
				call: '`initiateSecurityPoolFork(securityPool)`',
				caller: 'Anyone',
				effect: 'Freezes the parent pool after an external universe fork, drains pool and game REP, and records the canonical migration snapshot.',
				declarations: [{ name: 'initiateSecurityPoolFork' }],
				preconditions: 'Pool operational; its universe already forked; fork state not initialized; if an escalation game exists, the universe fork occurred before that game settled.',
				signals: '`SecurityPoolForkSnapshot` and `ParentRepLocked`',
			},
			{
				call: '`forkZoltarWithOwnEscalationGame(securityPool)`',
				caller: 'Anyone',
				effect: 'Uses a game non-decision to fork Zoltar, freezes the pool, and records own-fork REP buckets and snapshot state.',
				declarations: [{ name: 'forkZoltarWithOwnEscalationGame' }],
				preconditions: 'Pool operational; escalation reached non-decision; universe not already forked.',
				signals: '`SecurityPoolForkSnapshot`, `ParentRepLocked`, and Zoltar fork events',
			},
			{
				call: '`migrateRepToZoltar(securityPool, outcomeIndices)`',
				caller: 'Anyone',
				effect: "Splits the forker's pool migration balance into selected child REP.",
				declarations: [{ name: 'migrateRepToZoltar' }],
				preconditions: 'Fork initialized; for a positive migration amount, the eight-week migration window is open and every existing selected child remains in `ForkMigration`; selected outcomes valid; child split does not exceed the recorded balance. A zero migration amount is a no-op.',
				signals: 'Zoltar migration events',
			},
			{
				call: '`createChildUniverse(securityPool, outcomeIndex)`',
				caller: 'Anyone',
				effect: 'Lazily deploys and initializes one selected child pool and any paused continuation.',
				declarations: [{ name: 'createChildUniverse' }],
				preconditions: 'Parent in migration window; selected fork outcome is well formed; child pool is not already deployed.',
				signals: 'Child deployment and continuation initialization events',
			},
			{
				call: '`migrateVault(securityPool, outcomeIndex)`',
				caller: 'Vault owner for its unlocked position',
				declarations: [{ name: 'migrateVault' }],
				effect: "Moves the caller's currently unlocked REP ownership, allowance, fees, and collateral into one child pool. Repeat calls can have no additional unlocked state to move.",
				preconditions: 'Migration window open. Unresolved escalation escrow is handled separately; the aggregate-entitlement wrapper calls this function first to migrate unlocked state.',
				signals: '`VaultMigrationCheckpoint`',
			},
			{
				call: '`migrateVaultWithUnresolvedEscalation(securityPool, vault, childOutcomeIndex)`',
				caller: 'The named vault',
				effect: "Captures the vault's three unresolved outcome totals once and materializes its entitlement in one selected child.",
				declarations: [{ name: 'migrateVaultWithUnresolvedEscalation' }],
				preconditions: 'Migration window open; caller equals `vault`; selected child not already materialized for the entitlement.',
				signals: 'Vault migration and forked-escrow events',
			},
			{
				call: '`claimForkedEscalationDeposits(...)`',
				caller: 'The named vault',
				effect: 'Claims winning own-fork parent deposits directly and records their stable identities against descendant replay.',
				declarations: [{ name: 'claimForkedEscalationDeposits' }],
				preconditions: 'Own-fork path; eight-week claim window open; selected child remains in `ForkMigration`; matching winning outcome; caller equals `vault`; deposit not already claimed.',
				signals: '`ClaimForkedEscalationDepositsToWallet` and escalation claim events',
			},
			{
				call: '`startTruthAuction(securityPool)`',
				caller: 'Anyone',
				effect: 'Closes migration accounting and either reopens a fully backed child or starts its repair auction.',
				declarations: [{ name: 'startTruthAuction' }],
				preconditions: 'Child migration window ended; pool is in fork migration; required child REP is available.',
				signals: '`TruthAuctionStarted`; immediate no-auction paths also emit `TruthAuctionFinalized` and pool accounting checkpoints',
			},
			{
				call: '`finalizeTruthAuction(securityPool)`',
				caller: 'Anyone',
				effect: 'Finalizes the ended auction, transfers repair ETH, and fixes bidder ownership and allowance rates. The child becomes operational only if migration-routed collateral plus auction ETH meets the full parent collateral snapshot.',
				declarations: [{ name: 'finalizeTruthAuction' }],
				preconditions: 'Truth auction started and its one-week window has passed.',
				signals: '`TruthAuctionFinalized`, auction `AuctionFinalized`, and pool accounting checkpoints',
			},
			{
				call: '`settleAuctionBids(securityPool, vault, claimTickIndices, refundTickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'settleAuctionBids' }],
				effect: 'Before finalization, refunds only provably losing bids. After finalization, combines claim and refund indexes into one settlement withdrawal.',
				preconditions: 'At least one index; before finalization the claim list must be empty and refund indexes must be eligible; after finalization all indexes must belong to the named vault and remain unsettled.',
				signals: 'Underlying auction `BidSettled`; `ClaimAuctionProceeds` when REP is purchased',
			},
			{
				call: '`claimAuctionProceeds(securityPool, vault, tickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'claimAuctionProceeds' }],
				effect: 'Withdraws finalized bid settlements and converts purchased REP into child-pool ownership and allowance for the bidder.',
				preconditions: 'Auction finalized; indexes belong to the named vault and are not already settled.',
				signals: 'Underlying auction `BidSettled`; `ClaimAuctionProceeds` when REP is purchased',
			},
		],
	},
	{
		name: 'EscalationGame',
		purpose: 'Escrows outcome REP, raises the running resolution cost, detects non-decision, and settles local or carried deposits.',
		readSurface: 'Use `getCurrentCost`, `totalCost`, `getEscalationGameEndDate`, `getQuestionResolution`, `hasReachedNonDecision`, `getBindingCapital`, `getOutcomeBalances`, deposit pagination, carry snapshot views, and escrow views. Ordinary users route deposits and withdrawals through `SecurityPool`.',
		sourcePath: 'solidity/contracts/peripherals/EscalationGame.sol',
		interactions: [
			{
				call: '`start(startBond, nonDecisionThreshold)`',
				caller: 'Deploying `EscalationGameFactory` owner',
				effect: 'Initializes a local game and sets activation three days after deployment.',
				declarations: [{ name: 'start' }],
				preconditions: 'Game not already started; threshold exceeds the positive start bond; both are at least 1 REP.',
				signals: '`GameStarted`',
			},
			{
				call: '`startFromFork(...)` and `resumeFromFork()`',
				caller: 'Factory owner starts; owner or security pool resumes',
				effect: 'Initializes a paused continuation with inherited elapsed time, then resumes its remaining escalation clock.',
				declarations: [{ name: 'startFromFork' }, { name: 'resumeFromFork' }],
				preconditions: 'Valid start parameters and inherited elapsed time no greater than seven weeks; continuation resumes once.',
				signals: '`GameContinuedFromFork`, `ForkContinuationResumed`',
			},
			{
				call: '`recordDepositFromSecurityPool(...)`',
				caller: 'Owning `SecurityPool` only',
				effect: 'Appends an accepted local deposit, updates outcome and vault escrow, and records its carry leaf.',
				declarations: [{ name: 'recordDepositFromSecurityPool' }],
				preconditions: 'Game unresolved; valid outcome; preview and accepted cumulative amount match; room remains below threshold.',
				signals: '`LocalDepositAppended`, `DepositOnOutcome`, optionally `NonDecisionReached`',
			},
			{
				call: 'Claim, withdrawal, export, carry initialization, and forked-escrow entrypoints',
				caller: 'Owning pool or `SecurityPoolForker`, depending on the function',
				declarations: [
					{ name: 'claimDepositForWinning', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
					{ name: 'claimDepositForWinningWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
					{ name: 'exportUnresolvedDeposit', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
					{ name: 'withdrawDeposit', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
					{ name: 'drainAllRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
					{ name: 'initializeForkCarrySnapshotWithResolutionBalances', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
					{ name: 'recordForkedEscrowForOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
					{ name: 'exportVaultUnresolvedTotals', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
					{ name: 'exportVaultUnresolvedTotalsWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
					{ name: 'exportForkedEscrowByOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
					{ name: 'exportForkedEscrowByOutcomeWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
				],
				effect: 'Settles local or carried deposits, initializes canonical continuation proofs, or exports unresolved vault aggregates during migration.',
				preconditions: 'Caller authority plus final-resolution, proof, nullifier, escrow, and lifecycle guards for the selected path.',
				signals: 'Claim, withdrawal, carry, export, escrow, and nullifier events',
			},
			{
				call: '`sweepResidualRepToSecurityPool()`',
				caller: 'Anyone',
				effect: 'Returns otherwise stranded residual REP to the owning pool.',
				declarations: [{ name: 'sweepResidualRepToSecurityPool', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				preconditions: 'Final outcome; no unresolved principal; no vault escrow; positive residual balance.',
				signals: '`ResidualRepSweptToSecurityPool`',
			},
		],
	},
	{
		name: 'OpenOraclePriceCoordinator',
		purpose: 'Obtains a fresh REP-per-ETH price and gates withdrawal, allowance, and liquidation operations behind it.',
		readSurface: 'Use `isPriceValid`, `priceRoundMaxNotional`, `priceRoundConsumedNotional`, `getPriceRoundRemainingNotional`, request-cost getters, pending report fields, `getPendingOperationSlot`, active-operation pagination, and pending-settlement IDs to reconstruct oracle and operation state.',
		sourcePath: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
		interactions: [
			{
				call: '`requestPriceIfNeededAndStageOperation(...)` with funding when stale',
				caller: 'Vault owner for self withdrawal/allowance; a different vault for liquidation. While a report is pending, only that report sponsor may stage more operations.',
				effect: 'Records the operation, executes immediately with a fresh price, or attaches it to a bounded pending settlement batch and opens a report when required.',
				declarations: [{ name: 'requestPriceIfNeededAndStageOperation' }],
				preconditions:
					'Unresolved pool; valid target and nonzero amount except zero allowance; timeout from 1 second through 5 minutes. Bounty, initial REP/WETH funding, and approvals are required only when this call opens a new report; staging beside a pending report or queued rejected-report work does not open or fund another report.',
				signals: '`StagedOperationQueued`, possibly `PriceRequested`, then `ExecutedStagedOperation`; authoritative `CoordinatorStateCheckpoint` records',
			},
			{
				call: '`requestPrice(amount2)` with report funding',
				caller: 'Anyone when no fresh price or report is pending',
				effect: 'Opens and atomically funds a fresh REP/WETH report without staging a new operation.',
				declarations: [{ name: 'requestPrice' }],
				preconditions: 'Cached price stale; no pending report; ETH bounty and initial REP/WETH funding and approvals available.',
				signals: '`PriceRequested` and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`executeStagedOperation(operationId)`',
				caller: 'Anyone',
				effect: 'Consumes and attempts one active staged operation using the current fresh price. Successful risk-increasing operations debit the shared report-round budget; reductions and collateral withdrawals with no outstanding pool allowance debit zero.',
				declarations: [{ name: 'executeStagedOperation' }],
				preconditions: "Operation exists and coordinator price is fresh; lifecycle failures are emitted rather than retried. The operation's ETH notional must fit the report round's remaining configured budget.",
				signals: '`ExecutedStagedOperation` and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`recoverSettledPendingReport()`',
				caller: 'Anyone',
				effect: 'Clears a pending report whose normal callback path did not clear coordinator state and consumes its pending-operation slot.',
				declarations: [{ name: 'recoverSettledPendingReport' }],
				preconditions: 'A pending report ID exists; callers should verify the underlying report actually settled.',
				signals: '`PendingReportRecovered`, optionally `PendingOperationRecoveryConsumed`, and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`openOracleCallback(...)`',
				caller: 'Configured `OpenOracle` only',
				effect: 'A valid settlement updates the price and auto-executes the bounded pending batch. A rejected settlement clears pending-report state but leaves staged operations queued for a later valid price path.',
				declarations: [{ name: 'openOracleCallback' }],
				preconditions: 'Callback report matches the pending report; high basefee or zero values reject the price after clearing pending report state.',
				signals: '`PriceReported` or `PriceReportRejected`; operation execution events; authoritative `CoordinatorStateCheckpoint` records',
			},
			{
				call: '`consumeEscalationDepositNotional(repAmount)`',
				caller: 'Configured `SecurityPool` only',
				effect: 'Debits the accepted escalation deposit against the current report round exposure budget.',
				declarations: [{ name: 'consumeEscalationDepositNotional' }],
				preconditions: "Caller is the configured pool; the deposit's allowance-capped ETH notional fits the report round's remaining budget.",
				signals: '`CoordinatorStateCheckpoint` when positive notional is consumed',
			},
			{
				call: '`setSecurityPool(pool)` and `setRepEthPrice(price)`',
				caller: 'First caller for pool wiring; configured pool for inherited child price',
				effect: "Sets the pool once or seeds the coordinator's price value. Normal factory deployment wires the pool atomically before returning the coordinator.",
				declarations: [{ name: 'setSecurityPool' }, { name: 'setRepEthPrice' }],
				preconditions: '`securityPool` is still unset for `setSecurityPool`; caller equals the configured pool for `setRepEthPrice`.',
				signals: '`SecurityPoolSet`, `RepEthPriceSet`, and `CoordinatorStateCheckpoint`',
			},
		],
	},
	{
		name: 'ShareToken',
		purpose: "Stores universe-aware ERC-1155 outcome shares and reproduces a holder's full source balance into selected fork branches.",
		readSurface: 'Use standard ERC-1155 reads plus `totalSupplyForOutcome`, `balanceOfOutcome`, `balanceOfShares`, `getTokenId`, `getTokenIds`, and `unpackTokenId`.',
		sourcePath: 'solidity/contracts/peripherals/tokens/ShareToken.sol',
		interactions: [
			{
				call: '`migrate(fromId, targetOutcomeIndexes)`',
				caller: 'Holder of the source token ID',
				effect: "Burns the holder's full source balance and mints the same balance into every selected child-universe token ID.",
				declarations: [{ name: 'migrate' }],
				preconditions: 'Source universe forked; eight-week window open; positive source balance; nonempty, strictly increasing, well-formed outcomes.',
				signals: 'ERC-1155 transfer events and `Migrate` per branch',
			},
			{
				call: '`authorize(securityPoolCandidate)`',
				caller: 'Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool',
				effect: 'Adds the candidate pool to the set allowed to mint, burn, and authorize descendants.',
				declarations: [{ name: 'authorize' }],
				preconditions: 'Caller is already authorized.',
				signals: '`AuthorizationUpdated`',
			},
			{
				call: 'Mint and burn entrypoints',
				caller: 'An authorized `SecurityPool`',
				effect: 'Performs pool-requested complete-set minting, complete-set burning, or winning-token burning.',
				declarations: [{ name: 'mintCompleteSets' }, { name: 'burnCompleteSets' }, { name: 'burnTokenIdAndGetRemainingSupply' }],
				preconditions: 'Caller is authorized; token balances cover burns.',
				signals: 'ERC-1155 transfer events',
			},
		],
	},
	{
		name: 'UniformPriceDualCapBatchAuction',
		purpose: 'Collects ETH bids under ETH-raise and REP-sale caps, computes one clearing result, and supports paged settlement.',
		readSurface: 'Use auction summary fields, `computeClearing`, `tickToPrice`, tick pagination, active-tick pagination, and bidder bid pagination before submitting settlement indexes.',
		sourcePath: 'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol',
		interactions: [
			{
				call: '`startAuction(ethRaiseCap, maxRepBeingSold)`',
				caller: 'Auction owner (`SecurityPoolForker`) only',
				effect: 'Starts the one-week auction and fixes its two caps and minimum bid.',
				declarations: [{ name: 'startAuction' }],
				preconditions: 'Auction not previously started; both caps are positive.',
				signals: '`AuctionStarted`',
			},
			{
				call: '`submitBid(tick)` with ETH',
				caller: 'Any bidder',
				effect: 'Adds ETH demand at the selected positive-price tick.',
				declarations: [{ name: 'submitBid' }],
				preconditions: 'Auction active and unfinalized; before one-week deadline; bid meets `minBidSize`; tick maps to nonzero price.',
				signals: '`BidSubmitted`',
			},
			{
				call: '`refundLosingBids(tickIndices)`',
				caller: 'Bidder for its own bids',
				declarations: [{ name: 'refundLosingBids' }],
				effect: "Refunds the caller's bids already provably below the current clearing tick before finalization.",
				preconditions: 'Auction started and unfinalized; auction has reached a clearing price; indexes belong to the caller and are strictly losing and unrefunded.',
				signals: '`BidSettled`',
			},
			{
				call: '`refundLosingBidsFor(bidder, tickIndices)`',
				caller: 'Auction owner (`SecurityPoolForker`) only; public callers use `settleAuctionBids`',
				declarations: [{ name: 'refundLosingBidsFor' }],
				effect: "Refunds a named bidder's bids already provably below the current clearing tick before finalization.",
				preconditions: 'Auction started and unfinalized; auction has reached a clearing price; indexes belong to the named bidder and are strictly losing and unrefunded.',
				signals: '`BidSettled`',
			},
			{
				call: '`finalize()`',
				caller: 'Auction owner (`SecurityPoolForker`) only; users reach it through `finalizeTruthAuction`',
				effect: 'Fixes the clearing mode, clearing tick, ETH totals, and aggregate REP allocation.',
				declarations: [{ name: 'finalize' }],
				preconditions: 'Auction started, not finalized, and one-week deadline reached.',
				signals: '`AuctionFinalized`',
			},
			{
				call: '`withdrawBids(withdrawFor, tickIndices)`',
				caller: 'Auction owner only',
				effect: 'Returns refunds and reports purchased REP for the selected beneficiary bids so the forker can credit pool ownership. Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making payout independent of claim order.',
				declarations: [{ name: 'withdrawBids' }],
				preconditions: 'Auction finalized; indexes belong to `withdrawFor`; bids not already claimed or refunded.',
				signals: '`BidSettled`',
			},
		],
	},
]

const markdown = await generateMarkdown()

if (Bun.argv.includes('--check')) {
	const outputFile = Bun.file(outputPath)
	assert.equal(await outputFile.exists(), true, `${outputPath} is missing; run bun run docs:generate-contract-reference`)
	assert.equal(await outputFile.text(), markdown, `${outputPath} is stale; run bun run docs:generate-contract-reference`)
} else {
	await writeFile(outputPath, markdown)
}

async function generateMarkdown(): Promise<string> {
	const sourceByPath = new Map<string, string>()
	const representedEntrypointKeys = new Set<string>()
	const referencedEventNames = new Set<string>()
	const getSource = async (sourcePath: string): Promise<string> => {
		const cachedSource = sourceByPath.get(sourcePath)
		if (cachedSource !== undefined) return cachedSource
		const source = await readFile(sourcePath, 'utf8')
		sourceByPath.set(sourcePath, source)
		return source
	}
	for (const contractReference of contractReferences) {
		for (const interaction of contractReference.interactions) {
			for (const declaration of interaction.declarations) {
				const declarationSourcePath = declaration.sourcePath ?? contractReference.sourcePath
				const source = await getSource(declarationSourcePath)
				const configuredSourceSignatures = entrypointSignaturesBySource[declarationSourcePath]
				assert.ok(configuredSourceSignatures, `No entrypoint signature metadata exists for ${declarationSourcePath}`)
				const expectedSignatures = configuredSourceSignatures[declaration.name]
				assert.ok(expectedSignatures, `No entrypoint signatures are configured for ${declarationSourcePath}#${declaration.name}`)
				assertEntrypointSignatures(source, declaration, expectedSignatures, declarationSourcePath)
				representedEntrypointKeys.add(`${declarationSourcePath}#${declaration.name}`)
			}
			for (const eventMatch of interaction.signals.matchAll(/`([A-Z][A-Za-z0-9_]*)`/g)) {
				const eventName = eventMatch[1]
				if (eventName === undefined) throw new Error('Expected an event name capture')
				const eventSourcePath = eventSourceByName[eventName]
				assert.ok(eventSourcePath, `No declaring source is configured for documented event ${eventName}`)
				assertEventDeclaration(await getSource(eventSourcePath), { name: eventName }, eventSourcePath)
				referencedEventNames.add(eventName)
			}
		}
	}
	const configuredEntrypointKeys = Object.entries(entrypointSignaturesBySource).flatMap(([sourcePath, signaturesByName]) => Object.keys(signaturesByName).map(name => `${sourcePath}#${name}`))
	assert.deepEqual(Array.from(representedEntrypointKeys).sort(), configuredEntrypointKeys.sort(), 'Entrypoint signature metadata must exactly match the declarations represented by interaction rows')
	assert.deepEqual(Array.from(referencedEventNames).sort(), Object.keys(eventSourceByName).sort(), 'Event source metadata must exactly match the events named in interaction signals')

	const sections = contractReferences.map(contractReference => {
		const sourceLink = `../${contractReference.sourcePath}`
		const rows = contractReference.interactions.map(interaction => `| ${interaction.call} | ${interaction.caller} | ${interaction.preconditions} | ${interaction.effect} | ${interaction.signals} |`).join('\n')
		return `## ${contractReference.name}\n\n${contractReference.purpose} [Source](${sourceLink})\n\nRead surface: ${contractReference.readSurface}\n\n| Transaction | Caller | Main prerequisites | State or asset effect | Primary signals |\n| --- | --- | --- | --- | --- |\n${rows}`
	})

	return `<!-- Generated by scripts/generate-contract-interaction-reference.mts. Do not edit directly. -->
# Contract Interaction Reference

The main state-changing protocol calls map to caller authority, lifecycle prerequisites, effects, and observable events below. The conceptual flow begins in [Start Here](./start-here.html), while the [Operator Reference](./operator-reference.md) covers edge cases and the application build consumes the complete generated ABI.

The tables focus on transaction entrypoints in the seven contracts that users and protocol components interact with directly. Read-only getters are summarized as a read surface instead of repeating every public storage accessor. Protocol-only rows identify calls that applications should observe but ordinary users should reach through the owning pool, forker, factory, or coordinator.

Failure behavior follows Solidity transaction semantics: an uncaught revert rolls back the transaction. The coordinator is the important exception at the workflow level because it deliberately consumes several failed staged operations and records the result in \`ExecutedStagedOperation\`.

${sections.join('\n\n')}
`
}

function assertEntrypointSignatures(source: string, declaration: ContractDeclaration, expectedSignatures: string[], sourceLabel: string): void {
	if (declaration.kind === 'receive') {
		const receiveMatch = source.match(/^\s*receive\s*\(\s*\)\s*(external|public|internal|private)\s*(payable)?\b/m)
		const actualSignatures = receiveMatch === null ? [] : [`${receiveMatch[1]}${receiveMatch[2] === undefined ? '' : ' payable'}()`]
		assert.deepEqual(actualSignatures, expectedSignatures, `${sourceLabel} receive signature changed; update the interaction reference`)
		return
	}
	const actualSignatures = getFunctionDeclarations(source, declaration.name)
		.filter(sourceDeclaration => sourceDeclaration.visibility === 'external' || sourceDeclaration.visibility === 'public')
		.map(sourceDeclaration => `${sourceDeclaration.visibility}(${sourceDeclaration.parameterTypes.join(',')})`)
		.sort()
	assert.deepEqual(actualSignatures, [...expectedSignatures].sort(), `${sourceLabel} entrypoint signatures for ${declaration.name} changed; update the interaction reference`)
}

function getFunctionDeclarations(source: string, name: string): Array<{ parameterTypes: string[]; visibility: string }> {
	const declarationPattern = new RegExp(`^\\s*function\\s+${name}\\s*\\(([\\s\\S]*?)\\)\\s*(external|public|internal|private)\\b`, 'gm')
	return Array.from(source.matchAll(declarationPattern), match => ({
		parameterTypes: parseParameterTypes(match[1] ?? ''),
		visibility: match[2] ?? '',
	}))
}

function parseParameterTypes(parameters: string): string[] {
	if (parameters.trim() === '') return []
	return parameters.split(',').map(parameter => {
		const tokens = parameter.trim().replace(/\s+/g, ' ').split(' ')
		if (tokens[0] === 'address' && tokens[1] === 'payable') return 'address payable'
		const parameterType = tokens[0]
		if (parameterType === undefined || parameterType === '') throw new Error(`Unable to parse Solidity parameter: ${parameter}`)
		return parameterType
	})
}

function assertEventDeclaration(source: string, event: ContractDeclaration, sourceLabel: string): void {
	const eventPattern = new RegExp(`^\\s*event\\s+${event.name}\\s*\\(`, 'm')
	assert.match(source, eventPattern, `${sourceLabel} no longer declares event ${event.name}; update the interaction reference`)
}

function assertDeclarationCheckerRegression(): void {
	const sourceWithoutSecondary = `
		function primary() external {
			secondary();
		}
	`
	assert.throws(() => assertEntrypointSignatures(sourceWithoutSecondary, { name: 'secondary' }, ['external()'], 'grouped fixture'), /entrypoint signatures for secondary changed/)
	assert.throws(() => assertEntrypointSignatures('function caller() external { removed(); }', { name: 'removed' }, ['external()'], 'call-site fixture'), /entrypoint signatures for removed changed/)
	assert.doesNotThrow(() => assertEntrypointSignatures('receive() external payable {}', { kind: 'receive', name: 'receive' }, ['external payable()'], 'receive fixture'))
	const overloadedSource = 'function overloaded(uint256 value) external {}\nfunction overloaded(address value) external {}'
	assert.doesNotThrow(() => assertEntrypointSignatures(overloadedSource, { name: 'overloaded' }, ['external(address)', 'external(uint256)'], 'overload fixture'))
	assert.throws(() => assertEntrypointSignatures(`${overloadedSource}\nfunction overloaded(bytes32 value) external {}`, { name: 'overloaded' }, ['external(address)', 'external(uint256)'], 'added-overload fixture'), /entrypoint signatures for overloaded changed/)
	assert.throws(() => assertEntrypointSignatures('function changed(address value) external {}', { name: 'changed' }, ['external(uint256)'], 'parameter-change fixture'), /entrypoint signatures for changed changed/)
	assert.throws(() => assertEntrypointSignatures('function hidden(uint256 value) internal {}', { name: 'hidden' }, ['external(uint256)'], 'visibility fixture'), /entrypoint signatures for hidden changed/)
	assert.throws(() => assertEventDeclaration('function SystemStateSet() external {}', { name: 'SystemStateSet' }, 'event fixture'), /event fixture no longer declares event SystemStateSet/)
	assert.throws(() => assertEventDeclaration('event UniverseForked(uint256 value);', { name: 'DeployChild' }, 'intended event source'), /intended event source no longer declares event DeployChild/)
}
