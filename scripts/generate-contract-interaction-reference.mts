import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { keccak256 } from '../shared/ts/ethereum'
import { renderReferencePage } from './docs-html-page.mts'
import { ensureContractArtifactsAreCurrent } from './ensure-contract-artifacts.mts'

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
	compiledAbiFingerprint: string
	interactions: Interaction[]
	name: string
	purpose: string
	readAbiFingerprint: string
	readDeclarations: ContractDeclaration[]
	readStorageDeclarations?: ContractDeclaration[]
	readSurface: string
	securityBoundary?: string
	securityBoundaryHeading?: string
	sourcePath: string
}

type AssemblyDelegateCall = {
	abiSignature: string
	argumentOffsets: Array<{ argument: string; offset: string }>
	calldataLength: string
	selector: string
	sourcePath: string
	targetEntrypointSignature: string
	targetFunctionName: string
	targetSourcePath: string
}

const outputPath = 'docs/reference/contracts.html'
const expectedProductionSoliditySourceFingerprint = 'd7f143000d729b03a6a7a0d37923ae035c2e13f80f86c0fb6807419d63fbd1dc'

const eventSourceByName: Record<string, string> = {
	VaultBadDebtMigrated: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	Approval: 'solidity/contracts/IERC20.sol',
	ApprovalForAll: 'solidity/contracts/peripherals/interfaces/IERC1155.sol',
	AuctionStarted: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	AwaitingForkContinuationSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	AuctionFinalized: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	AuthorizationUpdated: 'solidity/contracts/peripherals/interfaces/IShareToken.sol',
	BidSettled: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	BidSubmitted: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	Burn: 'solidity/contracts/ReputationToken.sol',
	CarryDepositConsumed: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	ChildDisputeStakedRepMaterialized: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	ChildPoolLinked: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	PoolHeldRepSweptToChild: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	ChildRepSplit: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	ClaimAuctionProceeds: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	ClaimDeposit: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ClaimForkedEscalationDepositsToWallet: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	CompleteSetCreated: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	CompleteSetRedeemed: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	CoordinatorStateCheckpoint: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	DeployChild: 'solidity/contracts/Zoltar.sol',
	DeploySecurityPool: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
	DepositOnOutcome: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	RepDepositedToVault: 'solidity/contracts/peripherals/SecurityPool.sol',
	DepositToEscalationGame: 'solidity/contracts/peripherals/SecurityPool.sol',
	EscalationGameSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	EscalationMigrationEntitlementInitialized: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	EscalationMigrationEntitlementMaterialized: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	DisputeStakedRepDrainedAtFork: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	TruthAuctionHaircutApplied: 'solidity/contracts/peripherals/EscalationGameState.sol',
	EthRefundDeferred: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	ExecutedStagedOperation: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ForkContinuationResumed: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ForkCarryCheckpoint: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	ForkedEscrowExported: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ForkedEscrowRecorded: 'solidity/contracts/peripherals/EscalationGameState.sol',
	GameContinuedFromFork: 'solidity/contracts/peripherals/EscalationGameState.sol',
	GameStarted: 'solidity/contracts/peripherals/EscalationGameState.sol',
	InheritedThresholdTie: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	LocalDepositAppended: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	LiquidationApprovalConsumed: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
	LiquidationApprovalNonceInvalidated: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
	LiquidationApprovalReleased: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
	LiquidationApprovalReserved: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
	LiquidationApprovalRevoked: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
	LiquidationApprovalSet: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
	LiquidationRouteStaged: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	Migrate: 'solidity/contracts/peripherals/tokens/ShareToken.sol',
	VaultMigrationCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	MigrationRepAdded: 'solidity/contracts/Zoltar.sol',
	MigrationRepSplit: 'solidity/contracts/Zoltar.sol',
	Mint: 'solidity/contracts/ReputationToken.sol',
	NonDecisionReached: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	TotalRepBackingUnitsSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	VaultTargetHealthFactorSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	PendingEthRefundWithdrawn: 'solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol',
	PendingReportRecovered: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ParentRepLocked: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	RepWithdrawnFromVault: 'solidity/contracts/peripherals/SecurityPool.sol',
	PoolForkModeActivated: 'solidity/contracts/peripherals/SecurityPool.sol',
	PriceReportRejected: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PriceReported: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PriceRequested: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	QuestionCreated: 'solidity/contracts/ZoltarQuestionData.sol',
	RepRedeemedFromVault: 'solidity/contracts/peripherals/SecurityPool.sol',
	RepBurned: 'solidity/contracts/Zoltar.sol',
	RepEthPriceSet: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ResidualRepSweptToSecurityPool: 'solidity/contracts/peripherals/EscalationGameState.sol',
	SecurityPoolSet: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	SecurityPoolForkSnapshot: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	SecurityPoolRegistered: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
	ShareTokenSupplySet: 'solidity/contracts/peripherals/SecurityPool.sol',
	SharesRedeemed: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	StagedOperationQueued: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	SystemStateSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	TruthAuctionFinalized: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	TruthAuctionStarted: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	TheoreticalSupplySet: 'solidity/contracts/ReputationToken.sol',
	Transfer: 'solidity/contracts/IERC20.sol',
	TransferBatch: 'solidity/contracts/peripherals/interfaces/IERC1155.sol',
	TransferSingle: 'solidity/contracts/peripherals/interfaces/IERC1155.sol',
	UniverseForked: 'solidity/contracts/Zoltar.sol',
	PoolAccountingCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	VaultAccountingCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	VaultBadDebtRecorded: 'solidity/contracts/peripherals/SecurityPool.sol',
	VaultLiquidated: 'solidity/contracts/peripherals/SecurityPool.sol',
	VaultEscrowUpdated: 'solidity/contracts/peripherals/EscalationGameState.sol',
	VaultUnresolvedTotalsExported: 'solidity/contracts/peripherals/EscalationGameState.sol',
}

const documentedEventSchemas: Array<{ name: string; parameters: string; sourcePath: string }> = [
	{
		name: 'Transfer',
		parameters: 'address indexed from,address indexed to,uint256 value',
		sourcePath: 'solidity/contracts/IERC20.sol',
	},
	{
		name: 'Approval',
		parameters: 'address indexed owner,address indexed spender,uint256 value',
		sourcePath: 'solidity/contracts/IERC20.sol',
	},
	{
		name: 'TransferSingle',
		parameters: 'address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value',
		sourcePath: 'solidity/contracts/peripherals/interfaces/IERC1155.sol',
	},
	{
		name: 'TransferBatch',
		parameters: 'address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values',
		sourcePath: 'solidity/contracts/peripherals/interfaces/IERC1155.sol',
	},
	{
		name: 'ApprovalForAll',
		parameters: 'address indexed owner,address indexed operator,bool approved',
		sourcePath: 'solidity/contracts/peripherals/interfaces/IERC1155.sol',
	},
	{
		name: 'QuestionCreated',
		parameters: 'uint256 indexed questionId,uint256 createdTimestamp,QuestionData questionData,string[] outcomeOptions',
		sourcePath: 'solidity/contracts/ZoltarQuestionData.sol',
	},
	{
		name: 'UniverseInitialized',
		parameters: 'uint248 indexed universeId,uint256 forkTime,uint256 forkQuestionId,uint256 forkingOutcomeIndex,ReputationToken reputationToken,uint248 indexed parentUniverseId,uint256 universeTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/Zoltar.sol',
	},
	{
		name: 'DeployChild',
		parameters: 'address deployer,uint248 indexed universeId,uint256 indexed outcomeIndex,uint248 indexed childUniverseId,ReputationToken childReputationToken,uint256 childUniverseTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/Zoltar.sol',
	},
	{
		name: 'SecurityPoolRegistered',
		parameters: 'bytes32 indexed originId,bytes32 indexed poolId,uint248 indexed universeId,ISecurityPool securityPool',
		sourcePath: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
	},
	{
		name: 'DeploySecurityPool',
		parameters:
			'ISecurityPool indexed securityPool,UniformPriceDualCapBatchAuction truthAuction,OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,IShareToken shareToken,ISecurityPool indexed parent,uint248 indexed universeId,uint256 questionId,uint256 statoblastSecurityMultiplierBps,uint256 initialReportPriorityFeeAttoEthPerGas,uint256 currentRetentionRate,uint256 settlementCollateralAttoEth',
		sourcePath: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
	},
	{
		name: 'ChildPoolLinked',
		parameters: 'ISecurityPool indexed parent,uint256 indexed outcomeIndex,ISecurityPool indexed child,UniformPriceDualCapBatchAuction truthAuction',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	},
	{
		name: 'ChildRepSplit',
		parameters: 'ISecurityPool indexed parent,uint256 indexed outcomeIndex,uint256 childPoolRepSplitAttoRep,uint256 pendingChildAttoRep',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	},
	{
		name: 'ChildDisputeStakedRepMaterialized',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,address indexed childGame,uint256 outcomeIndex,uint256 attoRepAmount,uint256 resultingDisputeStakedRepBalanceAttoRep',
		sourcePath: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'PoolHeldRepSweptToChild',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,uint256 indexed outcomeIndex,uint256 attoRepAmount,uint256 resultingChildPoolHeldRepBalanceAttoRep',
		sourcePath: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'EscalationMigrationEntitlementInitialized',
		parameters: 'ISecurityPool indexed parent,address indexed vault,uint256[3] sourcePrincipalByOutcomeAttoRep,uint256[3] currentRepByOutcomeAttoRep,uint256 totalCurrentAttoRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	},
	{
		name: 'EscalationMigrationEntitlementMaterialized',
		parameters: 'ISecurityPool indexed parent,address indexed vault,uint256 indexed childOutcomeIndex,ISecurityPool child,uint256 childAttoRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	},
	{ name: 'TheoreticalSupplySet', parameters: 'uint256 totalTheoreticalSupplyAttoRep', sourcePath: 'solidity/contracts/ReputationToken.sol' },
	{ name: 'Mint', parameters: 'address indexed account,uint256 valueAttoRep', sourcePath: 'solidity/contracts/ReputationToken.sol' },
	{
		name: 'Burn',
		parameters: 'address indexed account,uint256 valueAttoRep,uint256 totalTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
	{
		name: 'AwaitingForkContinuationSet',
		parameters: 'bool awaitingForkContinuation',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
	},
	{
		name: 'TotalRepBackingUnitsSet',
		parameters: 'uint256 totalRepBackingUnits',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
	},
	{
		name: 'ShareTokenSupplySet',
		parameters: 'uint256 shareTokenSupplyAttoShares',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
	},
	{ name: 'SystemStateSet', parameters: 'SystemState systemState', sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol' },
	{
		name: 'VaultEscrowUpdated',
		parameters: 'address indexed vault,uint256 disputeStakedRepByVaultAttoRep,uint256 totalDisputeStakedAttoRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowRecorded',
		parameters: 'address indexed depositor,BinaryOutcomes.BinaryOutcome indexed outcome,uint256 sourcePrincipalTotalAttoRep,uint256 childRepTotalAttoRep,uint256 disputeStakedRepByVaultAttoRep,uint256 totalDisputeStakedAttoRep,uint256 outcomeBalanceAttoRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'VaultUnresolvedTotalsExported',
		parameters: 'address indexed vault,address repReceiver,uint256[3] principalByOutcomeAttoRep,uint256 principalToTransferAttoRep,bool transferredRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowExported',
		parameters: 'address indexed vault,address repReceiver,uint256[3] sourcePrincipalByOutcomeAttoRep,uint256[3] childRepByOutcomeAttoRep,uint256 totalChildRepToTransferAttoRep,bool transferredRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowClaimed',
		parameters: 'address indexed depositor,BinaryOutcomes.BinaryOutcome indexed outcome,uint256 sourcePrincipalClaimedAttoRep,uint256 childRepClaimedAttoRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'InternalApproval',
		parameters: 'address indexed owner,address indexed spender,address indexed token,uint256 amount',
		sourcePath: 'solidity/contracts/peripherals/openOracle/OpenOracle.sol',
	},
	{
		name: 'DeploymentAddressesSet',
		parameters: 'address[] deploymentAddresses',
		sourcePath: 'solidity/contracts/DeploymentStatusOracle.sol',
	},
]

const delegateEventDeclarationMirrors: Array<{ name: string; sourcePath: string }> = [
	{ name: 'PoolAccountingCheckpoint', sourcePath: 'solidity/contracts/peripherals/SecurityPoolEventEmitter.sol' },
	{ name: 'VaultAccountingCheckpoint', sourcePath: 'solidity/contracts/peripherals/SecurityPoolEventEmitter.sol' },
	{ name: 'ChildPoolLinked', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol' },
	{ name: 'ChildRepSplit', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol' },
	{ name: 'ClaimForkedEscalationDepositsToWallet', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol' },
]

const assemblyEventEmissions: Array<{
	dataArguments: string
	indexedArguments: string
	name: string
	signature: string
	signatureConstant: string
	sourcePath: string
}> = [
	{
		dataArguments: 'carryRoots, nullifierRoots, leafCounts, unresolvedTotalsAttoRep, resolutionBalancesAttoRep',
		indexedArguments: 'sourceGame, snapshotId',
		name: 'ForkCarryCheckpoint',
		signature: 'ForkCarryCheckpoint(address,bytes32,bytes32[3],bytes32[3],uint256[3],uint256[3],uint256[3])',
		signatureConstant: 'FORK_CARRY_CHECKPOINT_SIGNATURE',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol',
	},
	{
		dataArguments: 'BinaryOutcomes.BinaryOutcome(outcomeIndex), amountAttoRep, reason, carryTotalAttoRep, _getCurrentNullifierRoot(outcomeIndex), carryRoot',
		indexedArguments: 'parentDepositIndex, sourceNodeId, depositor',
		name: 'CarryDepositConsumed',
		signature: 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)',
		signatureConstant: 'CARRY_DEPOSIT_CONSUMED_SIGNATURE',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol',
	},
]

const assemblyDelegateCalls: AssemblyDelegateCall[] = [
	{
		abiSignature: 'emitForkSnapshotEvents(address,address,address,uint256,uint256,uint256)',
		argumentOffsets: [
			{ argument: 'parent', offset: '0x04' },
			{ argument: 'migrationProxy', offset: '0x24' },
			{ argument: 'sourceGame', offset: '0x44' },
			{ argument: 'totalPoolHeldRepAtForkAttoRep', offset: '0x64' },
			{ argument: 'disputeStakedRepAtForkAttoRep', offset: '0x84' },
			{ argument: 'resultingLockedAttoRep', offset: '0xa4' },
		],
		calldataLength: '0xc4',
		selector: '0x408d33da',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
		targetEntrypointSignature: 'external(ISecurityPool,address,address,uint256,uint256,uint256)',
		targetFunctionName: 'emitForkSnapshotEvents',
		targetSourcePath: 'solidity/contracts/peripherals/SecurityPoolEventEmitter.sol',
	},
]

const referencedEventAbiFingerprint = 'f73cedceb07d7243fbd91f9e0bdd7c5f19a886ba391f5e8bcd115408d9489206'

const entrypointSignaturesBySource: Record<string, Record<string, string[]>> = {
	'solidity/contracts/ERC20.sol': {
		approve: ['public(address,uint256)'],
		transfer: ['public(address,uint256)'],
		transferFrom: ['public(address,address,uint256)'],
	},
	'solidity/contracts/ZoltarQuestionData.sol': {
		createQuestion: ['external(QuestionData,string[])'],
	},
	'solidity/contracts/Zoltar.sol': {
		addRepToMigrationBalance: ['public(uint248,uint256)'],
		burnRep: ['external(uint248,uint256)'],
		deployChild: ['public(uint248,uint256)'],
		forkUniverse: ['public(uint248,uint256)'],
		splitMigrationRep: ['public(uint248,uint256,uint256[])'],
	},
	'solidity/contracts/ReputationToken.sol': {
		burn: ['external(address,uint256)'],
		mint: ['external(address,uint256)'],
		setMaxTheoreticalSupplyAttoRep: ['external(uint256)'],
	},
	'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol': {
		deployChildSecurityPool: ['external(ISecurityPool,IShareToken,uint248,uint256,uint256,uint256,uint256)'],
		deployOriginSecurityPool: ['external(uint248,uint256,uint256,uint256)'],
	},
	'solidity/contracts/peripherals/EscalationGame.sol': {
		applyTruthAuctionHaircut: ['external(uint256)'],
		recordDepositFromSecurityPool: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
		resumeFromFork: ['external()'],
		start: ['external(uint256,uint256)'],
		startFromFork: ['external(uint256,uint256,uint256,BinaryOutcomes.BinaryOutcome,bool,uint256)'],
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
		exportUnresolvedDeposit: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		sweepResidualRepToSecurityPool: ['external()'],
		withdrawDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
	},
	'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol': {
		executeStagedOperation: ['public(uint256)'],
		expireStagedOperation: ['external(uint256)'],
		openOracleCallback: ['external(uint256,uint256,uint256,uint256,address,address)'],
		recoverSettledPendingReport: ['public()'],
		requestPrice: ['public(uint256,uint256)'],
		requestPriceIfNeededAndStageLiquidation: ['external(address,address,uint256,bytes32,uint256,uint256,uint256)'],
		requestPriceIfNeededAndStageOperation: ['public(OperationType,address,uint256,uint256,uint256,uint256)'],
		setLiquidationApprovalRegistry: ['external(LiquidationApprovalRegistry)'],
		setRepEthPrice: ['public(uint256)'],
		setSecurityPool: ['public(ISecurityPool)'],
	},
	'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol': {
		consume: ['external(uint256,uint256)'],
		initialize: ['external(address)'],
		invalidateLiquidationApprovalNonce: ['external(uint256)'],
		permitLiquidationApproval: ['external(LiquidationApprovalParams,bytes)'],
		release: ['external(uint256)'],
		reserve: ['external(uint256,bytes32,address,address,address,uint256,uint256,uint256)'],
		revokeLiquidationApproval: ['external(bytes32)'],
		setLiquidationApproval: ['external(LiquidationApprovalParams)'],
	},
	'solidity/contracts/peripherals/SecurityPool.sol': {
		activateForkMode: ['external()'],
		addFeeEligibleCapacityOwnershipAttoRep: ['external(address,uint256)'],
		authorizeChildPool: ['external(ISecurityPool)'],
		burnEscalationWinnerHaircut: ['external(uint256)'],
		configureVault: ['external(address,uint256,uint256,uint256,uint256,uint256,uint256)'],
		createCompleteSet: ['external()'],
		depositRepToVault: ['external(uint256,uint256)'],
		depositToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[64][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
		initializeForkedEscalationGame: ['external(uint256,uint256,uint256,BinaryOutcomes.BinaryOutcome)'],
		performLiquidation: ['external(LiquidationRequest)'],
		withdrawRepFromVault: ['external(address,uint256)'],
		receive: ['external payable()'],
		redeemCompleteSet: ['external(uint256)'],
		redeemFees: ['external(address)'],
		redeemRepFromVault: ['external(address)'],
		redeemShares: ['external()'],
		resumeForkedEscalationGame: ['external()'],
		setAwaitingForkContinuation: ['external(bool)'],
		setTotalRepBackingUnits: ['external(uint256)'],
		setPoolFinancials: ['external(uint256,uint256,uint256,uint256)'],
		setStartingParams: ['external(uint256,uint256)'],
		setSystemState: ['external(SystemState)'],
		setTotalSharesAttoShares: ['external(uint256)'],
		transferEth: ['external(address payable,uint256)'],
		updateSettlementCollateral: ['public()'],
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
		initializeChildForkedEscalationGameIfNeeded: ['external(ISecurityPool,ISecurityPool,EscalationGame)'],
		migrateRepToZoltar: ['external(ISecurityPool,uint256[])'],
		migrateVault: ['public(ISecurityPool,uint256)'],
		migrateVaultWithUnresolvedEscalation: ['external(ISecurityPool,address,uint256)'],
		receive: ['external payable()'],
		settleAuctionBids: ['external(ISecurityPool,address,IUniformPriceDualCapBatchAuction.TickIndex[],IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startTruthAuction: ['external(ISecurityPool)'],
	},
	'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol': {
		finalize: ['external()'],
		refundLosingBids: ['external(IUniformPriceDualCapBatchAuction.TickIndex[])'],
		refundLosingBidsFor: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startAuction: ['public(uint256,uint256)'],
		submitBid: ['external(int256)'],
		withdrawBids: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[],uint256)'],
		withdrawPendingEthRefund: ['external()'],
	},
	'solidity/contracts/peripherals/tokens/ShareToken.sol': {
		authorize: ['external(ISecurityPool)'],
		burnCompleteSets: ['external(uint248,address,uint256)'],
		burnTokenIdAndGetRemainingSupply: ['external(uint256,address)'],
		migrate: ['external(uint256,uint256[])'],
		mintCompleteSets: ['external(uint248,address,uint256)'],
	},
	'solidity/contracts/peripherals/tokens/ERC1155.sol': {
		safeBatchTransferFrom: ['external(address,address,uint256[],uint256[])', 'external(address,address,uint256[],uint256[],bytes)'],
		safeTransferFrom: ['external(address,address,uint256,uint256)', 'external(address,address,uint256,uint256,bytes)'],
		setApprovalForAll: ['external(address,bool)'],
	},
}

const stateChangingAbiFingerprintBySource: Record<string, string> = {
	'solidity/contracts/Context.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/ERC20.sol': '6c4161bf27a2ed1bc2de94b58253a8ec4201e28d125571cb2124238753387a22',
	'solidity/contracts/ReputationToken.sol': 'b3e68791ded4f7fd9cc70785bdd3c55d5ec7fde5ad64b7fbe8aee03d5d273e3b',
	'solidity/contracts/Zoltar.sol': '6479e6b24905f8f3299e486703df934aa7811152a9d20517596da64cbcd4b471',
	'solidity/contracts/ZoltarQuestionData.sol': '904b4369195f070fa3b04bbcbc1acba529810ffa2da4667569cd9168ac568d65',
	'solidity/contracts/peripherals/EscalationGame.sol': '41394612ae4488f08c9f4c18ff912cec089fc40a3f5d501a27cb8b2fabc4db57',
	'solidity/contracts/peripherals/EscalationGameCalculations.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/EscalationGameCarry.sol': 'bdd7cfe47523c5e0c8985eec993214de44caf88fc4f2e6f1586d2d03c0a02ef0',
	'solidity/contracts/peripherals/EscalationGameEscrow.sol': 'c75cd0c9ea134a3bfa03227d0500485049818553447b4b258ff220cb0d201dde',
	'solidity/contracts/peripherals/EscalationGameSettlement.sol': '73f9aad63165cacbff5bd02fd57a6b5a3f73737545018ecdf152c46f905c8c32',
	'solidity/contracts/peripherals/EscalationGameState.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/EscalationGameStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol': '2a27b7ed5407ac8067de39d67bbe84902f4c1c36ab070eeaeb99375db6f8b8e1',
	'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol': '986a20fc0e4cfe0898be8fc91c6b911b93ef0ae1086d4cb1142a93c66f315684',
	'solidity/contracts/peripherals/SecurityPool.sol': '7de24a5d15ed2b8ffc052c498eefb96f92997d59ee8b8d075b42efad4a17012d',
	'solidity/contracts/peripherals/SecurityPoolForker.sol': '282c464a68623405a6241816a1c5fcef4b80e9db39e42e89d77177d8a4f10eae',
	'solidity/contracts/peripherals/SecurityPoolForkerBase.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/SecurityPoolForkerStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol': 'af052a0723644556a488b365d578205eb331e53a1e47fff8b869ff77fab9c7ef',
	'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol': '618aed7f3f8bdfd50267b9d7533db3f489f45715f1cd448f5107f67631814d34',
	'solidity/contracts/peripherals/tokens/ERC1155.sol': '7bb87695bc3df8fa177c545209ed58d2e4571c19c869b5598bb0a829e764b218',
	'solidity/contracts/peripherals/tokens/ShareToken.sol': '2a3339ca5db0ccabc2bc10318ff3baf52273b90837f01683d3e5147a13fd2d0d',
}

const readDeclarationExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/peripherals/EscalationGameClaimDelegate.sol': ['securityPool'],
	'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol': ['storedGame', 'disputeHistory'],
	'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol': ['securityPool'],
	'solidity/contracts/peripherals/SecurityPool.sol': ['eventEmitter', 'factory'],
	'solidity/contracts/peripherals/SecurityPoolForkerBase.sol': [],
}

assertDeclarationCheckerRegression()
await ensureContractArtifactsAreCurrent()
const productionSoliditySourceFingerprint = await getProductionSoliditySourceFingerprint()
assert.equal(productionSoliditySourceFingerprint, expectedProductionSoliditySourceFingerprint, 'Production Solidity source changed; re-audit every affected contract behavior against the documentation, then update the pinned source fingerprint')

const contractReferences: ContractReference[] = [
	{
		compiledAbiFingerprint: '580109cfcebb3ce505def01895f7b6567e75bbd8e8ccac857bdd00d54f15c37f',
		name: 'ZoltarQuestionData',
		purpose: 'Creates immutable, content-addressed scalar or categorical questions and exposes their display metadata.',
		readAbiFingerprint: '964d0ce318d2890011ff485c8d78e933cabc8d10e489a0c22f0e266fa2563ded',
		readSurface:
			'Use `getQuestionId` before submission; `questionCreatedTimestamp` and `questions` for direct lookup; `getQuestionCount` and `getQuestions` for indexed or paged discovery; and `getQuestionEndDate`, `getOutcomeLabels`, `splitUint256IntoTwoWithInvalid`, `hasNonZeroScalarReservedBits`, `isMalformedAnswerOption`, and `getAnswerOptionName` when validating or displaying answers. In the `QuestionData` tuple, `startTime` and `endTime` are `uint48`, while `numTicks` is `uint120`; clients must use these exact widths because they determine the `getQuestionId` and `createQuestion` selectors.',
		readDeclarations: [
			{ name: 'getQuestionId' },
			{ name: 'getQuestionCount' },
			{ name: 'getQuestions' },
			{ name: 'getQuestionEndDate' },
			{ name: 'getOutcomeLabels' },
			{ name: 'splitUint256IntoTwoWithInvalid' },
			{ name: 'hasNonZeroScalarReservedBits' },
			{ name: 'isMalformedAnswerOption' },
			{ name: 'getAnswerOptionName' },
		],
		readStorageDeclarations: [{ name: 'questionCreatedTimestamp' }, { name: 'questions' }],
		sourcePath: 'solidity/contracts/ZoltarQuestionData.sol',
		interactions: [
			{
				call: '`createQuestion(questionData, outcomeOptions)`',
				caller: 'Anyone',
				effect: 'Stores the question at its deterministic content hash, records the creation timestamp, appends it to discovery order, and stores categorical labels when supplied.',
				declarations: [{ name: 'createQuestion' }],
				preconditions: 'Question ID not already created; end time is on or after start time. Scalar questions use no labels, require display maximum greater than minimum, and positive ticks. Categorical questions require nonempty labels whose `keccak256(abi.encode(label))` values are strictly descending.',
				signals: '`QuestionCreated`',
			},
		],
	},
	{
		compiledAbiFingerprint: '023e5a38bcf613044e07d23e84095e1125be871017388a0c5a6cf7a41958b350',
		name: 'Zoltar',
		purpose: 'Registers universe forks, charges the fork admission haircut, and mints branch-specific child REP.',
		readAbiFingerprint: '1916e3480c70c4ccd5962f4b8069988d7dc36f0ea89337ebe04b8bca089d1492',
		readSurface:
			'Use `universes`, `forkThresholdDivisor`, `forkBurnDivisor`, `zoltarQuestionData`, `genesisReputationToken`, `getForkTime`, `forkQuestionMatches`, `getRepToken`, `getForkThresholdAttoRep`, `getNonDecisionThresholdAttoRep`, `getUniverseTheoreticalSupplyAttoRep`, `getChildUniverseId`, `getDeployedChildUniverses`, and `getMigrationRepBalanceAttoRep` to reconstruct universe and migration state. Construction requires a deployed genesis REP token with theoretical supply from one attoREP through 11 million REP and `forkBurnDivisor >= 5`, which caps the uncredited fork haircut at 20% of the threshold.',
		securityBoundary: 'Security boundaries for these calls are [A15 intended question selection](./security-model.html#assumption-a15) and [A25 safe immutable parameters](./security-model.html#assumption-a25).',
		readDeclarations: [
			{ name: 'getForkTime' },
			{ name: 'forkQuestionMatches' },
			{ name: 'getRepToken' },
			{ name: 'getForkThresholdAttoRep' },
			{ name: 'getNonDecisionThresholdAttoRep' },
			{ name: 'getUniverseTheoreticalSupplyAttoRep' },
			{ name: 'getChildUniverseId' },
			{ name: 'getDeployedChildUniverses' },
			{ name: 'getMigrationRepBalanceAttoRep' },
		],
		readStorageDeclarations: [{ name: 'universes' }, { name: 'forkThresholdDivisor' }, { name: 'forkBurnDivisor' }, { name: 'zoltarQuestionData' }, { name: 'genesisReputationToken' }],
		sourcePath: 'solidity/contracts/Zoltar.sol',
		interactions: [
			{
				call: '`forkUniverse(universeId, questionId)`',
				caller: 'Any address able to fund the current fork threshold',
				effect: 'Records the fork, removes threshold REP from the parent universe, and credits the caller with the threshold minus the configured uncredited haircut.',
				declarations: [{ name: 'forkUniverse' }],
				preconditions: 'Initialized and unforked universe; existing ended question; sufficient caller REP. Genesis REP requires allowance; child REP is burned directly without allowance.',
				signals: '`UniverseForked`',
			},
			{
				call: '`burnRep(universeId, amountAttoRep)`',
				caller: 'Any REP holder; the caller can burn only its own balance',
				effect: 'Permanently removes REP without creating migration credit; escalation settlement uses this when the haircut was not paid through its own fork.',
				declarations: [{ name: 'burnRep' }],
				preconditions: 'Initialized universe; positive amount; sufficient caller REP and theoretical supply. Genesis REP requires allowance.',
				signals: '`RepBurned` and the token burn or transfer event',
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
				call: '`addRepToMigrationBalance(universeId, amountAttoRep)`',
				caller: 'Parent REP holder',
				effect: "Burns or sinks additional parent REP and increases the caller's reusable migration balance.",
				declarations: [{ name: 'addRepToMigrationBalance' }],
				preconditions: 'Universe forked; sufficient caller REP. Genesis REP requires allowance; child REP is burned directly without allowance.',
				signals: '`MigrationRepAdded`',
			},
			{
				call: '`splitMigrationRep(universeId, amountAttoRep, outcomeIndexes)`',
				caller: 'Migration-balance holder',
				effect:
					'Mints `amount` of child REP into every selected branch, deploying missing children lazily. An empty outcome list returns after the universe-fork guard without outcome validation, deployment, minting, or events. A nonempty zero-amount call still validates every outcome, may deploy missing children, performs zero-value child REP mints, and records a zero split for every branch.',
				declarations: [{ name: 'splitMigrationRep' }],
				preconditions: "Universe forked. A nonempty list additionally requires every outcome to be well formed and the cumulative amount per child not to exceed the caller's migration balance.",
				signals: '`TheoreticalSupplySet` and `DeployChild` when needed; child REP `Transfer` and `Mint`, then `MigrationRepSplit`, per selected branch, including at zero amount; no event for an empty list',
			},
		],
	},
	{
		compiledAbiFingerprint: '14cee3c68c22f454d0d83f16aad27d40b686fa8abc7fb0220c03ba19ba609f64',
		name: 'ReputationToken',
		purpose: 'Implements universe-specific ERC-20 REP and enforces the supply ceiling maintained by Zoltar.',
		readAbiFingerprint: '1385406a6e5989eb754a8adeb36f946309659127e088734528cdffa7f8bbe7c8',
		readSurface: 'Use `getTotalTheoreticalSupplyAttoRep`, `zoltar`, and the standard ERC-20 `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, and `allowance` reads.',
		readDeclarations: [
			{ name: 'getTotalTheoreticalSupplyAttoRep' },
			{ name: 'name', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'symbol', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'decimals', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'totalSupply', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'balanceOf', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'allowance', sourcePath: 'solidity/contracts/ERC20.sol' },
		],
		readStorageDeclarations: [{ name: 'zoltar' }],
		sourcePath: 'solidity/contracts/ReputationToken.sol',
		interactions: [
			{
				call: '`setMaxTheoreticalSupplyAttoRep(totalTheoreticalSupplyAttoRep)`',
				caller: '`Zoltar` only',
				effect: 'Sets the child token theoretical-supply ceiling used to bound subsequent migration mints.',
				declarations: [{ name: 'setMaxTheoreticalSupplyAttoRep' }],
				preconditions: 'Called by Zoltar as part of child-universe creation; theoretical supply does not exceed 11 million REP.',
				signals: '`TheoreticalSupplySet`',
			},
			{
				call: '`mint(account, valueAttoRep)`',
				caller: '`Zoltar` only',
				effect: 'Mints branch REP to an account.',
				declarations: [{ name: 'mint' }],
				preconditions: '`account` is nonzero; resulting ERC-20 supply does not exceed theoretical supply.',
				signals: '`Mint` and ERC-20 `Transfer`',
			},
			{
				call: '`burn(account, valueAttoRep)`',
				caller: '`Zoltar` only',
				effect: 'Burns account REP and reduces both actual and theoretical supply by the same amount.',
				declarations: [{ name: 'burn' }],
				preconditions: '`account` is nonzero and has sufficient REP; theoretical supply covers the burn.',
				signals: '`Burn` and ERC-20 `Transfer`',
			},
			{
				call: '`transfer(to, value)`',
				caller: 'REP holder',
				effect: 'Moves REP from the caller without changing actual or theoretical supply.',
				declarations: [{ name: 'transfer', sourcePath: 'solidity/contracts/ERC20.sol' }],
				preconditions: 'Destination is nonzero; caller has sufficient balance.',
				signals: '`Transfer`',
			},
			{
				call: '`approve(spender, value)`',
				caller: 'Any REP account setting its own allowance',
				effect: 'Replaces the named spender allowance without moving REP.',
				declarations: [{ name: 'approve', sourcePath: 'solidity/contracts/ERC20.sol' }],
				preconditions: 'Spender is nonzero.',
				signals: '`Approval`',
			},
			{
				call: '`transferFrom(from, to, value)`',
				caller: 'A spender with sufficient allowance from `from`',
				effect: 'Moves REP from `from`; a finite allowance decreases by `value`, while an infinite allowance remains unchanged. Neither allowance path emits `Approval`.',
				declarations: [{ name: 'transferFrom', sourcePath: 'solidity/contracts/ERC20.sol' }],
				preconditions: 'Source and destination are nonzero; source has sufficient balance; caller has sufficient allowance, including when caller equals source.',
				signals: '`Transfer` only',
			},
		],
	},
	{
		compiledAbiFingerprint: 'c502f414482a9872fb01eaa78dccd3c19d5e1af5227c10047ba645da00fb3406',
		name: 'SecurityPoolFactory',
		purpose: 'Creates and canonically registers origin and child security pools with their share token, oracle coordinator, and optional truth auction.',
		readAbiFingerprint: '855853487a8ab201b9e990820bac4f51ec6ae6520ae2dcf49efcc93e81c9a474',
		readSurface:
			'Use `initialEscalationGameDepositAttoRep`, `minimumSecurityBondDebtAttoEth`, and `minimumVaultRepDepositAttoRep` for immutable deployment floors. The factory requires the escalation baseline to equal 1 REP, so each pool fixes its effective escalation deposit at construction as exactly `max(1 REP, theoretical REP supply / 10,000,000)`. A zero configured vault REP floor selects the default `theoretical REP supply / 100,000`; a nonzero constructor value is the exact override. The security-bond debt floor defaults to 1 ETH. Use `securityPoolDeploymentCount` with the strict `securityPoolDeploymentsRange(startIndex, count)` pager, which reverts rather than truncating when the requested range exceeds the array. Use `getOriginId`, `getPoolId`, `getSecurityPool`, `getSecurityPoolOriginId`, and `getSecurityPoolHasInheritedForkOutcome` for canonical lookup.',
		readDeclarations: [{ name: 'securityPoolDeploymentCount' }, { name: 'securityPoolDeploymentsRange' }, { name: 'getOriginId' }, { name: 'getPoolId' }, { name: 'getSecurityPool' }, { name: 'getSecurityPoolOriginId' }, { name: 'getSecurityPoolHasInheritedForkOutcome' }],
		readStorageDeclarations: [{ name: 'initialEscalationGameDepositAttoRep' }, { name: 'minimumSecurityBondDebtAttoEth' }, { name: 'minimumVaultRepDepositAttoRep' }],
		sourcePath: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
		interactions: [
			{
				call: '`deployOriginSecurityPool(universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)`',
				caller: 'Anyone',
				effect: 'Creates the canonical origin pool, its lineage-wide share token, and its price coordinator with the configured initial-report priority fee, then wires and registers them atomically.',
				declarations: [{ name: 'deployOriginSecurityPool' }],
				preconditions:
					'`statoblastSecurityMultiplierBps > 10_001`, which makes the halfway migration component strictly greater than one; the effective pool-held vault REP backing multiplier separately floors that component at the 10,500-BPS liquidation-award reserve described by the [liquidation design](../explanation/liquidations.html#rule). `initialReportPriorityFeeAttoEthPerGas > 0` and remains within the coordinator-computed OpenOracle `uint128` report/escalation-halt capacity bound; question exists and has exactly the categorical labels `Yes`, then `No`; universe is unforked and has a REP token; the non-decision threshold exceeds the construction-time effective escalation deposit `max(1 REP, theoretical REP supply / 10,000,000)`; the origin/universe/priority-fee slot has not already been claimed.',
				signals: '`SecurityPoolRegistered`, then `DeploySecurityPool`',
			},
			{
				call: '`deployChildSecurityPool(parent, shareToken, universeId, questionId, statoblastSecurityMultiplierBps, currentRetentionRate, settlementCollateralAttoEth)`',
				caller: '`SecurityPoolForker` only',
				effect: 'Creates and registers a canonical child pool with a coordinator that inherits `initialReportPriorityFeeAttoEthPerGas` from the parent coordinator and a forker-owned truth auction, while retaining the parent lineage share token.',
				declarations: [{ name: 'deployChildSecurityPool' }],
				preconditions: 'Parent is the canonical pool for its lineage; supplied share token equals the parent share token; target origin/universe slot is unclaimed; deployment arguments satisfy downstream constructors and wiring.',
				signals: '`SecurityPoolRegistered`, then `DeploySecurityPool`',
			},
		],
	},
	{
		compiledAbiFingerprint: '4e95ce668a620668593258b22e33ff0fdaa591d23455a7ac0dffafd4d003354f',
		name: 'SecurityPool',
		purpose: 'Holds ETH collateral and REP underwriting, accounts for vaults and fees, mints shares, and routes local escalation.',
		readAbiFingerprint: '25c286eef854f7f8c3a60fb339e29063f864976fb0c650594e6b5478a5af13f8',
		readSurface:
			'Immutable relationship and configuration getters are `questionId`, `universeId`, `initialEscalationGameDepositAttoRep`, `zoltar`, `parent`, `shareToken`, `repToken`, `priceOracleManagerAndOperatorQueuer`, `openOracle`, `escalationGameFactory`, `questionData`, `securityPoolForker`, `truthAuction`, `securityPoolFactory`, and `statoblastSecurityMultiplierBps`; the current game is `escalationGame`. Accounting getters include `totalCapacityOwnershipAttoRep`, `settlementCollateralAttoEth`, `totalRepBackingUnits`, `shareTokenSupplyAttoShares`, `securityVaults`, `minimumSecurityBondDebtAttoEth`, `minimumVaultRepDepositAttoRep`, `vaultTargetHealthFactorBps`, `totalBadDebtAttoEth`, and `vaultBadDebtAttoEth`. Use `getCurrentMintingCapacityAttoEth` for price-converted aggregate capacity and `getVaultOpenInterestAttoEth` for a vault’s live proportional obligation. Other derived and paged reads are `getVaultCount`, `getVaults`, `attoSharesToAttoEth`, `attoEthToAttoShares`, `attoRepToBackingUnits`, `backingUnitsToAttoRep`, `getTotalPoolHeldAttoRep`, `totalAccruedFeesAttoEth`, `getPoolAccountingSnapshot`, `getVaultFeeRemainder`, and `isEscalationResolved`. The vault registry is append-only and newest-registered first. Registration requires only a nonzero address and can occur without economic state; consumers filter current positions from `securityVaults`, escalation stake, and bad debt. `isEscalationResolved()` is true only when a local escalation game is configured and the forker routes a non-`None` outcome; an operational fixed-outcome child without a local game returns false. Lifecycle and fee getters are `totalClaimableVaultFeesAttoEth`, `lastUpdatedFeeAccumulator`, `feeIndex`, `currentRetentionRate`, `awaitingForkContinuation`, and `systemState`.',
		securityBoundary:
			'Price-sensitive withdrawal, dynamic-capacity, and liquidation calls depend on [A16 timely inclusion](./security-model.html#assumption-a16), [A21 genesis REP and WETH behavior](./security-model.html#assumption-a21), [A19 observable correctable price](./security-model.html#assumption-a19), and [A06 lifecycle executors](./security-model.html#assumption-a06). User-initiated pool calls additionally depend on [A28 account authority](./security-model.html#assumption-a28).',
		readDeclarations: [
			{ name: 'getVaultCount' },
			{ name: 'getVaults' },
			{ name: 'attoSharesToAttoEth' },
			{ name: 'attoEthToAttoShares' },
			{ name: 'attoRepToBackingUnits' },
			{ name: 'backingUnitsToAttoRep' },
			{ name: 'getTotalPoolHeldAttoRep' },
			{ name: 'totalAccruedFeesAttoEth' },
			{ name: 'getPoolAccountingSnapshot' },
			{ name: 'getVaultFeeRemainder' },
			{ name: 'getCurrentMintingCapacityAttoEth' },
			{ name: 'getVaultOpenInterestAttoEth' },
			{ name: 'isEscalationResolved' },
		],
		readStorageDeclarations: [
			{ name: 'questionId' },
			{ name: 'universeId' },
			{ name: 'initialEscalationGameDepositAttoRep' },
			{ name: 'zoltar' },
			{ name: 'parent' },
			{ name: 'shareToken' },
			{ name: 'repToken' },
			{ name: 'priceOracleManagerAndOperatorQueuer' },
			{ name: 'openOracle' },
			{ name: 'escalationGameFactory' },
			{ name: 'escalationGame', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'questionData' },
			{ name: 'securityPoolForker' },
			{ name: 'truthAuction' },
			{ name: 'securityPoolFactory' },
			{ name: 'totalCapacityOwnershipAttoRep', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'settlementCollateralAttoEth', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'totalRepBackingUnits', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'statoblastSecurityMultiplierBps', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'shareTokenSupplyAttoShares', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'totalClaimableVaultFeesAttoEth', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'lastUpdatedFeeAccumulator', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'feeIndex', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'currentRetentionRate', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'awaitingForkContinuation', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'securityVaults', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'totalBadDebtAttoEth', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'vaultBadDebtAttoEth', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'systemState', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'minimumSecurityBondDebtAttoEth', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'minimumVaultRepDepositAttoRep', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
			{ name: 'vaultTargetHealthFactorBps', sourcePath: 'solidity/contracts/peripherals/SecurityPoolStorage.sol' },
		],
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
		interactions: [
			{
				call: '`burnEscalationWinnerHaircut(amountAttoRep)`',
				caller: "This pool's `EscalationGame` only",
				effect: 'Burns the winning-deposit haircut from REP already escrowed in the game.',
				declarations: [{ name: 'burnEscalationWinnerHaircut' }],
				preconditions: 'Caller is the configured escalation game; amount is positive and the game has already transferred enough REP to the pool.',
				signals: '`RepBurned` and ERC-20 `Transfer`; child REP also emits `Burn`',
			},
			{
				call: '`depositRepToVault(attoRepAmount, targetHealthFactorBps)`',
				caller: 'Vault owner',
				effect: 'Transfers REP into the pool, credits proportional REP backing units, and creates REP-denominated fee-earning capacity ownership from the deposit and selected target health factor.',
				declarations: [{ name: 'depositRepToVault' }],
				preconditions: 'Operational and unforked; `isEscalationResolved()` is false; target health factor is at least 10,000; resulting vault REP meets the configured supply-scaled minimum.',
				signals: '`RepDepositedToVault`, the vault target-health-factor event, and accounting checkpoints',
			},
			{
				call: '`redeemFees(vault)`',
				caller: 'Anyone; any nonzero ETH payment is always sent to `vault`',
				effect: "First accrues the vault's fees. If resulting claimable fees are zero, returns without payment; otherwise clears and pays the full amount.",
				declarations: [{ name: 'redeemFees' }],
				preconditions: 'A nonzero payment path requires `vault` to accept ETH.',
				signals: 'Accrual checkpoints only when accrual state changes; both `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint` for a nonzero redemption; no event when fees and accrual state are unchanged',
			},
			{
				call: '`createCompleteSet()` with ETH',
				caller: 'Trader',
				effect: 'Adds collateral and mints one `Invalid`, `Yes`, and `No` share per complete-set unit, then invokes the ERC-1155 batch-receiver callback for a contract trader. Callback rejection rolls back the ETH, pool accounting, events, and share mint.',
				declarations: [{ name: 'createCompleteSet' }],
				preconditions:
					'Operational and unforked; `isEscalationResolved()` is false; not awaiting continuation; positive ETH converts to at least one complete-set unit; live oracle-priced minting capacity covers the resulting settlement collateral, not merely this deposit; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract trader accepts `onERC1155BatchReceived`.',
				signals: '`CompleteSetCreated`, `PoolAccountingCheckpoint`, then ERC-1155 `TransferBatch` on a successful callback',
			},
			{
				call: '`redeemCompleteSet(amountAttoShares)`',
				caller: 'Anyone; positive redemption requires the caller to hold the complete set',
				effect:
					"Burns equal balances of all three outcomes and pays `amountAttoShares * settlementCollateralAttoEth / shareTokenSupplyAttoShares` using the pool's remaining economic claim supply as its collateral denominator. Complete-set issuance adds to that denominator, while complete-set and winning-share redemption consume it; fork-time source entitlements materialize without changing it because their claims are already reserved. Zero passes the token and accounting checks and follows the normal zero-value event, checkpoint, and ETH-send path; rejection of that ETH call reverts the transaction.",
				declarations: [{ name: 'redeemCompleteSet' }],
				preconditions: 'Operational and unforked; caller holds every outcome amount requested; caller accepts the resulting ETH call, including zero value. Zero is accepted without a token balance.',
				signals: '`CompleteSetRedeemed` and `PoolAccountingCheckpoint`',
			},
			{
				call: '`redeemShares()`',
				caller: 'Anyone; a positive payout requires the caller to hold winning shares',
				effect: "Burns the caller's full winning balance and pays its pro-rata remaining collateral. A zero winning balance passes token and accounting checks and follows the normal zero-value event, checkpoint, and ETH-send path; rejection of that ETH call reverts the transaction.",
				declarations: [{ name: 'redeemShares' }],
				preconditions: 'Operational pool with a final outcome; caller accepts the resulting ETH call, including zero value.',
				signals: '`SharesRedeemed` and `PoolAccountingCheckpoint`',
			},
			{
				call: '`redeemRepFromVault(vault)`',
				caller: 'Anyone; REP is always sent to `vault`',
				effect: "Burns the vault's REP backing units and returns its proportional vault REP backing.",
				declarations: [{ name: 'redeemRepFromVault' }],
				preconditions: 'Operational pool with a final outcome; the specified `vault` has no escalation escrow and has redeemable REP.',
				signals: '`RepRedeemedFromVault`',
			},
			{
				call: '`depositToEscalationGame(outcome, maxAmount)`',
				caller: 'Vault owner',
				effect:
					"Deploys the local game on the first deposit. The game factory uses the configured start bond while it is below the live non-decision threshold; if tracked REP supply later makes it too large, the factory uses `nonDecisionThresholdAttoRep - 1` instead. Repeat deposits use the existing game's stored `startBondAttoRep` and `nonDecisionThresholdAttoRep`. Every accepted deposit removes enough REP backing units and escrows dispute-staked REP on the selected outcome.",
				declarations: [{ name: 'depositToEscalationGame' }],
				preconditions:
					'Question end has passed; pool operational in an unforked universe, without an inherited fixed outcome, and not awaiting continuation. On the first deposit, the live non-decision threshold must exceed one attoREP; outcome and amount accepted; the remaining vault and aggregate pool totals each preserve both live open-interest health branches; a fresh price is required when total capacity ownership is nonzero.',
				signals: '`EscalationGameSet` on first deposit; `DepositToEscalationGame`',
			},
			{
				call: '`withdrawFromEscalationGame(outcome, depositIndexes)`',
				caller: 'Anyone; a nonempty list must select deposits belonging to one original depositor',
				effect: 'A nonempty list settles local deposits and pays winning REP to the immutable depositor recorded by each deposit. Liquidation cannot change that payout address. An empty list returns after the outer lifecycle checks without settlement, state change, or event.',
				declarations: [{ name: 'withdrawFromEscalationGame' }],
				preconditions:
					'Game configured; operational pool; valid final outcome. If an external fork interrupted the game, parent withdrawal stays unavailable: winners settle in the child by carried proof, inherited losers require no transaction, and unresolved parent escalation-deposit accounting cleanup is optional. A nonempty list additionally requires valid local indexes and one common depositor.',
				signals: 'Per processed deposit, escalation-game `CarryDepositConsumed`; additionally `ClaimDeposit` for a winning payout. No event for an empty list',
			},
			{
				call: '`withdrawForkedEscalationDeposits(outcome, proofs)`',
				caller: 'Anyone; a nonempty list must name one original depositor across all proofs',
				effect:
					'A nonempty list verifies and consumes carried proofs, then pays winning child REP to the immutable depositor committed in each leaf. Stable continuation identities retain the creating game, and the cumulative retention-index ratio applies every intervening auction haircut in constant ancestry work. An empty list returns after the outer lifecycle checks without proof verification, state change, or event.',
				declarations: [{ name: 'withdrawForkedEscalationDeposits' }],
				preconditions: 'Game configured; operational child pool; valid final outcome. A nonempty list additionally requires an initialized and fully resumed continuation game, valid unconsumed winning proofs, and one common depositor.',
				signals: 'Per processed proof, escalation-game `CarryDepositConsumed` and `ClaimDeposit`. No event for an empty list',
			},
			{
				call: '`updateSettlementCollateral()`',
				caller: 'Anyone',
				effect:
					"Accrues elapsed fees through question end while this pool's universe remains unforked; after that universe forks, its fork timestamp replaces question end as this pool epoch's cutoff, including a later question-end-to-fork interval. The cutoff is local to this pool: an activated child starts a separate fee epoch. It moves whole credited fees from settlement collateral into the unallocated accrued-fee reserve and advances the accumulator. With positive elapsed time but zero fee-eligible capacity ownership it clears denominator-specific remainder and advances the timestamp without charging fees.",
				declarations: [{ name: 'updateSettlementCollateral' }],
				preconditions: 'No caller or lifecycle restriction. It returns unchanged when the accumulator is already at or beyond the clamped timestamp.',
				signals: '`PoolAccountingCheckpoint` whenever positive elapsed time is processed, including the zero-capacity-ownership branch; no event for an unchanged timestamp',
			},
			{
				call: '`updateRetentionRate()`',
				caller: 'Anyone',
				effect: 'Recalculates the retention rate from current collateral and live oracle-priced minting capacity.',
				declarations: [{ name: 'updateRetentionRate' }],
				preconditions: 'No caller restriction. It returns unchanged when the pool is not `Operational` or the calculated rate equals the stored rate. Zero live minting capacity selects the maximum retention rate.',
				signals: '`PoolAccountingCheckpoint` only when the stored retention rate changes; no event for a no-op',
			},
			{
				call: '`updateVaultFees(vault)`',
				caller: 'Anyone for any address',
				effect:
					'First updates pool accrual, then advances the vault fee index and fractional remainder, moves whole assigned fees from reserve to the vault, registers any previously unseen nonzero vault address regardless of economic state, and returns leftover reserve to settlement collateral once a forked pool has checkpointed all fee-eligible capacity ownership.',
				declarations: [{ name: 'updateVaultFees' }],
				preconditions: 'No caller, nonzero-vault, or lifecycle restriction.',
				signals: 'Accrual `PoolAccountingCheckpoint` when due; `VaultAccountingCheckpoint` when the vault index, remainder, or claimable fee balance changes; an additional `PoolAccountingCheckpoint` when pool accounting changes; no event when neither accrual nor vault or pool accounting changes',
			},
			{
				call: '`withdrawRepFromVault(vault, attoRepAmount)`',
				caller: "This pool's `OpenOraclePriceCoordinator` only",
				effect: 'Removes the requested proportional REP backing units, or all backing units when the requested remainder would fall below the REP minimum; proportionally reduces the vault and pool capacity ownership; recalculates retention; and transfers the resulting withdrawable REP to `vault`.',
				declarations: [{ name: 'withdrawRepFromVault' }],
				preconditions: 'Fresh coordinator price; operational pool in an unforked universe; `isEscalationResolved()` is false; no vault REP escrow; the remaining vault and aggregate pool totals each meet the upward-rounded associated-REP and free-REP backing requirements, with equality healthy.',
				signals: '`VaultTargetHealthFactorSet`; REP `Transfer`; `RepWithdrawnFromVault`; `VaultAccountingCheckpoint`; and applicable fee-accrual or retention `PoolAccountingCheckpoint` events, including a zero-value transfer/event path if the trusted coordinator supplies zero',
			},
			{
				call: '`performLiquidation(request)`',
				caller: "This pool's `OpenOraclePriceCoordinator` only",
				effect:
					"Capped by the target vault's open interest and fundable REP award, a nominal debt quote selects proportional capacity ownership rounded downward and moves that ownership to the explicitly selected receiver vault. Moved security-bond debt is the receiver's exact live open-interest increase and cannot exceed the nominal quote or request. On a delegated route, the coordinator additionally bounds it by the staged approval reservation; the self-receiving route has no approval reservation. The operator only submits the transaction. Dispute-staked REP claims, accrued claimable fees, surplus vault REP backing, and unmatched ownership remain with the target. On a full-target request, target open interest minus exact moved debt is recorded as attoETH-denominated bad debt; that residual can include both an award-unfunded slice and integer-allocation residue. Receiver or target dust cannot turn otherwise funded debt into bad debt.",
				declarations: [{ name: 'performLiquidation' }],
				preconditions:
					'In ABI order, `request` contains `operationId`, `operator`, `receiverVault`, `targetVault`, `requestedDebtAttoEth`, `snapshot`, `minimumReceiverHealthFactorBps`, and `minLiquidationPriceDistanceBps`. The nested snapshot contains `targetBackingUnits`, `targetCapacityOwnershipAttoRep`, `totalPoolHeldAttoRep`, and `totalRepBackingUnits`. Fresh settled coordinator price; operational pool in an unforked universe; `isEscalationResolved()` is false; receiver differs from target. The target backing and capacity-ownership snapshot fields must match; the two pool-total snapshot fields are reconstruction evidence, while execution uses live pool totals. After target and receiver fee checkpoints, the liquidation delegate requires live target backing, dispute-staked REP, and open interest to remain at least `minLiquidationPriceDistanceBps` beyond the liquidation threshold and requires the live target state to remain unhealthy. When debt moves, the receiver must satisfy the protocol backing checks multiplied by its approved minimum health factor, using live post-liquidation state and upward-rounded requirements; its resulting debt must meet the configured debt floor and its REP must meet the vault floor. The target resulting debt must be zero or meet the debt floor; when debt remains, target REP must meet the vault floor.',
				signals:
					'Fee-accrual and target or receiver `VaultAccountingCheckpoint` events as needed; `VaultLiquidated` identifies operation, operator, receiver, target, moved debt, moved ownership, and bad debt; `VaultBadDebtRecorded` records residual target debt on a full-target request; final pool accounting checkpoint',
			},
			{
				call: '`setStartingParams(...)`',
				caller: '`SecurityPoolFactory` only',
				effect: "Sets the fee timestamp, retention, and collateral, seeds the coordinator with zero for an origin or the parent's last price for a child, then checkpoints initialization.",
				declarations: [{ name: 'setStartingParams' }],
				preconditions: 'Factory caller. The pool has no internal one-shot or lifecycle guard; the factory exposes it only through atomic deployment wiring.',
				signals: 'Coordinator `RepEthPriceSet` and `CoordinatorStateCheckpoint`, then pool `PoolAccountingCheckpoint`, even for zero or repeated values if the factory were to call again',
			},
			{
				call: '`activateForkMode()`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'activateForkMode' }],
				effect:
					"Sets `PoolForked`, accrues through the fork clamp, transfers the pool's entire REP balance to the forker, then makes the pool drain its configured escalation game's entire REP balance to the forker. Repeated calls are not lifecycle-guarded and transfer any balances replenished since the prior call before repeating the checkpoints.",
				preconditions: "The pool has no inherited fixed outcome, so a fixed child cannot reopen for a later universe fork. There is no current-state guard otherwise. A configured game's drain must succeed or the entire activation reverts without propagating its reason data.",
				signals: 'Pool-held REP `Transfer` always, including at zero; configured-game REP `Transfer` only for a positive game balance; accrual checkpoint when due; always `PoolForkModeActivated` and fork-activation `PoolAccountingCheckpoint`',
			},
			{
				call: '`initializeForkedEscalationGame(...)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'initializeForkedEscalationGame' }],
				effect: "Deploys and starts the pool's paused fork-continuation game with inherited timing and optional fixed outcome.",
				preconditions: 'No game is configured; downstream `startFromFork` parameters are valid.',
				signals: 'Escalation `GameContinuedFromFork`, then pool `EscalationGameSet`',
			},
			{
				call: '`initializeForkCarrySnapshotWithResolutionBalances(...)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'initializeForkCarrySnapshotWithResolutionBalances' }],
				effect: "Installs the continuation game's immutable carry peaks, counts, totals, resolution balances, and normalized nullifier roots.",
				preconditions: 'A game is configured; it is a fork continuation with no prior snapshot; leaf counts fit the MMR; supplied or computed snapshot ID matches the data.',
				signals: '`ForkCarryCheckpoint`',
			},
			{
				call: '`resumeForkedEscalationGame()`',
				caller: 'Anyone',
				declarations: [{ name: 'resumeForkedEscalationGame' }],
				effect: "Checks the already-installed immutable carry commitment and aggregate REP funding, clears the pool wait flag, records the resume timestamp, and starts the continuation's remaining escalation clock in one bounded call.",
				preconditions: 'Pool is operational, awaiting a configured fork continuation, and the game has not resumed.',
				signals: '`ForkContinuationResumed` and `AwaitingForkContinuationSet(false)`',
			},
			{
				call: '`setAwaitingForkContinuation(shouldAwait)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setAwaitingForkContinuation' }],
				effect: 'Stores whether complete-set minting must wait for continuation initialization.',
				preconditions: 'No lifecycle or value-change guard.',
				signals: '`AwaitingForkContinuationSet`, including for a repeated value',
			},
			{
				call: '`setSystemState(newState)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setSystemState' }],
				effect: 'Replaces the pool lifecycle state directly.',
				preconditions: 'No transition or value-change guard.',
				signals: '`SystemStateSet`, including for a repeated state',
			},
			{
				call: '`configureVault(vault, repBackingUnits, capacityOwnershipAttoRep, vaultFeeIndex, targetHealthFactorBps, newVaultBadDebtAttoEth, newTotalBadDebtAttoEth)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'configureVault' }],
				effect: 'Replaces the vault REP backing units, price-independent capacity ownership, fee index, target health factor, vault bad debt, and aggregate pool bad debt, clears pooled fee-index remainder when capacity ownership changes, and registers the nonzero vault address regardless of the supplied state.',
				preconditions: '`vault` is nonzero; no lifecycle or value-change guard.',
				signals: 'Always `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including when all supplied values repeat current state',
			},
			{
				call: '`setTotalRepBackingUnits(newDenominator)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setTotalRepBackingUnits' }],
				effect: 'Replaces the REP backing units denominator.',
				preconditions: 'No lifecycle or value-change guard.',
				signals: '`TotalRepBackingUnitsSet`, including for zero or a repeated value',
			},
			{
				call: '`setTotalSharesAttoShares(newTotalSharesAttoShares)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setTotalSharesAttoShares' }],
				effect: 'Replaces stored `shareTokenSupplyAttoShares`, the denominator used by `attoSharesToAttoEth` and complete-set redemption.',
				preconditions: 'No lifecycle or value-change guard.',
				signals: '`ShareTokenSupplySet`, including for zero or a repeated value',
			},
			{
				call: '`setPoolFinancials(newSettlementCollateralAttoEth, newTotalCapacityOwnershipAttoRep, newFeeEligibleCapacityOwnershipAttoRep, newTotalBadDebtAttoEth)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setPoolFinancials' }],
				effect: 'Replaces settlement collateral, both price-independent capacity-ownership totals, and aggregate pool bad debt, resets the fee timestamp to the current block, and clears fee-index rounding carry.',
				preconditions: 'Fee-eligible capacity ownership does not exceed total capacity ownership, and the supplied settlement collateral does not exceed the current price-converted minting capacity; no lifecycle or value-change guard.',
				signals: '`PoolAccountingCheckpoint`, including for repeated financial values',
			},
			{
				call: '`authorizeChildPool(pool)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'authorizeChildPool' }],
				effect: 'Asks the lineage share token to establish `pool` as the canonical authorized pool for its universe; reauthorizing the same pool is a no-op.',
				preconditions: 'This parent pool is already authorized; candidate reports this share token; candidate universe has no different canonical pool. No pool-lifecycle guard.',
				signals: '`AuthorizationUpdated` only on first authorization; no event when already authorized',
			},
			{
				call: '`transferEth(receiver, amountAttoEth)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'transferEth' }],
				effect: 'Reduces tracked settlement collateral by `amount`, checkpoints the reconciliation, and calls `receiver` with that ETH. At zero amount it reduces no settlement collateral but still emits the checkpoint and performs a zero-value call; callback rejection rolls back the transaction and checkpoint.',
				preconditions: 'Fee liabilities are covered; `amount` fits both unreserved pool ETH and tracked settlement collateral; `receiver` accepts the ETH call, including zero value.',
				signals: '`PoolAccountingCheckpoint`, including at zero amount; no dedicated ETH-transfer event',
			},
			{
				call: '`addFeeEligibleCapacityOwnershipAttoRep(vault, amountAttoRep)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'addFeeEligibleCapacityOwnershipAttoRep' }],
				effect: 'Adds newly auction-claimed capacity ownership to the live fee denominator, clears the pooled fee-index rounding remainder, then checkpoints elapsed fees and recalculates retention from collateral and unchanged total capacity ownership. The assignment itself does not change live minting capacity.',
				preconditions: 'The resulting fee-eligible capacity ownership cannot exceed total capacity ownership; no lifecycle, vault, positive-amount, or value-change guard.',
				signals: 'Retention-rate `PoolAccountingCheckpoint` first when the rate changes, then `VaultAccountingCheckpoint` and auction-claim `PoolAccountingCheckpoint`, including the latter two at zero amount; the calling forker emits `ClaimAuctionProceeds` only after the broader credit workflow completes',
			},
			{
				call: 'Direct ETH transfer to `receive()`',
				caller: "Forker, this pool's truth auction, or parent pool only",
				effect: 'Accepts protocol-routed ETH used by migration and auction settlement. Forced ETH remains raw, unaccounted surplus rather than settlement collateral or fees.',
				declarations: [{ kind: 'receive', name: 'receive' }],
				preconditions: 'Sender is one of the three authorized protocol addresses. Forced ETH bypasses this ordinary-call guard.',
				signals: 'No dedicated receive event; the calling protocol step emits its own event',
			},
		],
	},
	{
		compiledAbiFingerprint: '53bc009e3dfbd79b99b31c22b2128cf93b16b73059ce344190ce65b39400183c',
		name: 'SecurityPoolForker',
		purpose: 'Freezes parent pools, creates selected child pools, migrates vault and escalation state, and settles collateral-repair auctions.',
		readAbiFingerprint: '2d321031db910e3feec1b22c481203de331c894217e60456fa429472808aa4a4',
		readSurface:
			'Use `zoltar`, `forkData`, `getMigratedAttoRep`, `getForkActivationTime`, `isEscalationDepositClaimedDirectly`, `getEscalationDepositId`, `getDirectlyClaimedEscalationPrincipal`, `isEscalationWinnerHaircutPaidByFork`, `getEscalationMigrationEntitlementStatus`, `getOwnForkRepBuckets`, `getOwnForkMigrationStatus`, `getMigrationProxyAddress`, `getQuestionOutcome`, `attoRepToBackingUnits`, and `backingUnitsToAttoRep` to reconstruct fork progress and preview migration conversions.',
		readDeclarations: [
			{ name: 'forkData' },
			{ name: 'getMigratedAttoRep' },
			{ name: 'getForkActivationTime' },
			{ name: 'isEscalationDepositClaimedDirectly' },
			{ name: 'getEscalationDepositId' },
			{ name: 'getDirectlyClaimedEscalationPrincipal' },
			{ name: 'isEscalationWinnerHaircutPaidByFork' },
			{ name: 'getEscalationMigrationEntitlementStatus' },
			{ name: 'getOwnForkRepBuckets' },
			{ name: 'getOwnForkMigrationStatus' },
			{ name: 'getMigrationProxyAddress' },
			{ name: 'getQuestionOutcome' },
			{ name: 'attoRepToBackingUnits', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol' },
			{ name: 'backingUnitsToAttoRep', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol' },
		],
		readStorageDeclarations: [{ name: 'zoltar', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol' }],
		securityBoundaryHeading: 'Child-game trust boundary',
		securityBoundary:
			'Fork entrypoints and child setup may receive contracts through unauthenticated pool lineages. External-universe initiation requires the supplied pool to be authorized by its declared share token, but that relationship alone does not prove factory registration; own-game initiation does not perform that authorization check. Canonicality comes from the configured `SecurityPoolFactory` registry. A game relationship check is point-in-time: the reported nonzero game address must return the supplied pool or child from `securityPool()` when validated. This does not prove that an arbitrary game getter is immutable or that the address was factory-deployed. Child setup captures one reported game address, validates it before privileged use, and reuses that exact address for continuation backing and escrow work. When unresolved escalation requires a continuation and setup initially reports no game, initialization creates one; the forker then captures and validates it before continuation use. Combined vault migration passes the captured child/game pair into unresolved cleanup without reading the child getter again. Truth-auction completion performs a fresh point-in-time validation of the game reported then before checking continuation readiness. Genuine factory-deployed `EscalationGame` instances store their pool immutably, but safety on unauthenticated paths does not assume arbitrary contracts do.',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
		interactions: [
			{
				call: '`initiateSecurityPoolFork(securityPool)`',
				caller: 'Anyone',
				effect: 'Freezes the supplied pool after an external universe fork, drains its pool and game REP, and records a migration snapshot keyed by that address. The snapshot is canonical only when the supplied pool is already registered by the configured `SecurityPoolFactory`.',
				declarations: [{ name: 'initiateSecurityPoolFork' }],
				preconditions:
					'Pool operational with no inherited fixed outcome; the pool is authorized by its declared share token; its universe already forked; fork state not initialized; if an escalation game exists, it reports the supplied pool from `securityPool()` when validated and the universe fork occurred before that game settled. Declared-token authorization is not configured-factory registration; see the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`SecurityPoolForkSnapshot` and `ParentRepLocked`; additionally `DisputeStakedRepDrainedAtFork` when unresolved escalation exists',
			},
			{
				call: '`forkZoltarWithOwnEscalationGame(securityPool)`',
				caller: 'Anyone',
				effect: "Uses the supplied pool game's non-decision to fork Zoltar, freezes that pool, and records own-fork REP buckets and snapshot state keyed by its address. The snapshot is canonical only when the supplied pool is already registered by the configured `SecurityPoolFactory`.",
				declarations: [{ name: 'forkZoltarWithOwnEscalationGame' }],
				preconditions:
					'Pool operational with no inherited fixed outcome; its escalation game reports the supplied pool from `securityPool()` when validated and `canTriggerOwnFork()` is true because it recorded a local non-decision or inherited a threshold tie without a game-level fixed outcome; universe not already forked. The game-local predicate does not bypass the pool guard. Unlike external-universe initiation, this entrypoint does not require declared-share-token authorization; neither path authenticates the supplied address against the configured pool factory. See the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`SecurityPoolForkSnapshot`, `ParentRepLocked`, and Zoltar fork events; additionally `DisputeStakedRepDrainedAtFork` when unresolved escalation exists',
			},
			{
				call: '`migrateRepToZoltar(securityPool, outcomeIndices)`',
				caller: 'Anyone',
				effect: "For a positive migration amount and nonempty list, ensures that the forker's recorded pool migration amount has been split into each selected child REP branch. A zero migration amount or empty list returns after the proxy and pool-state guards without per-outcome validation or events.",
				declarations: [{ name: 'migrateRepToZoltar' }],
				preconditions:
					'Migration proxy exists and the pool is `PoolForked`. Only a positive migration amount with at least one selected outcome checks the eight-week window, existing child `ForkMigration` state, outcome validity, and cumulative split bound. A zero amount skips those checks even when outcome values are supplied.',
				signals: '`MigrationRepSplit` and `ChildRepSplit` when a selected branch requires a new split; no event for a zero amount, empty list, or already-satisfied branch',
			},
			{
				call: '`createChildUniverse(securityPool, outcomeIndex)`',
				caller: 'Anyone',
				effect:
					"Loads an already deployed child universe and REP token or deploys them when absent, then lazily deploys the selected child pool, coordinator, and auction; authorizes and links the child; captures and validates the child's escalation game; and initializes any continuation snapshot and materializes or sweeps child backing through that validated game.",
				declarations: [{ name: 'createChildUniverse' }],
				preconditions:
					"Parent in migration window; selected fork outcome is well formed; child pool is not already deployed. The returned auction is nonzero, deployed, and has never been trusted by this forker; the child's fork-data slot is unused; and the child reports the expected parent, universe, source factory, forker, and auction. The selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary). These relationship checks do not independently prove configured-factory registration.",
				signals:
					'`DeployChild` only when child REP was absent; always `SecurityPoolRegistered`, `DeploySecurityPool`, `AuthorizationUpdated`, `ChildPoolLinked`, and `TotalRepBackingUnitsSet`; `AwaitingForkContinuationSet`, `EscalationGameSet`, `GameContinuedFromFork`, `ForkCarryCheckpoint`, `MigrationRepSplit`, `ChildDisputeStakedRepMaterialized`, and `PoolHeldRepSweptToChild` as continuation and backing state requires',
			},
			{
				call: '`migrateVault(securityPool, outcomeIndex)`',
				caller: 'Vault owner for their non-escrowed position',
				declarations: [{ name: 'migrateVault' }],
				effect:
					"Converts the caller's parent REP backing-unit claim to REP at the fork snapshot and credits that REP amount as child-local backing units; transfers REP-denominated capacity ownership, target health factor, and vault bad debt into one child pool; checkpoints but retains claimable fees in the parent vault; and separately routes proportional pool-level settlement collateral while preserving aggregate bad debt. Repeat calls can have no additional REP backing units, capacity ownership, or vault bad debt to move.",
				preconditions: "Migration window open; the selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary). The optional unresolved parent escalation-deposit accounting cleanup wrapper calls this function first to migrate transferable vault state.",
				signals: '`VaultBadDebtMigrated` and `VaultMigrationCheckpoint`',
			},
			{
				call: '`migrateVaultWithUnresolvedEscalation(securityPool, vault, childOutcomeIndex)`',
				caller: 'The named vault owner',
				effect:
					"First runs ordinary migration for the same vault, which may transfer REP backing units, capacity ownership, target health factor, and vault bad debt to the selected child while preserving aggregate bad debt; checkpoint but retain claimable fees in the parent vault; and separately route proportional pool-level settlement collateral. It returns the selected child and its captured, validated escalation game to the unresolved-accounting cleanup phase, which reuses those exact addresses without reading the child's game again. The cleanup then clears that vault's unresolved parent escalation-deposit accounting in constant-size work and records it; the cleanup neither funds dispute-staked REP backing nor authorizes carried proofs.",
				declarations: [{ name: 'migrateVaultWithUnresolvedEscalation' }],
				preconditions: "Migration window open; caller equals `vault`; selected child not already recorded for this optional cleanup; the selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary).",
				signals: 'Vault migration events, including `VaultBadDebtMigrated`, plus `EscalationMigrationEntitlementInitialized` on first export and `EscalationMigrationEntitlementMaterialized` for the selected child',
			},
			{
				call: '`claimForkedEscalationDeposits(...)`',
				caller: 'The named vault owner',
				effect:
					"First gets or lazily deploys the selected child universe, REP token, pool, coordinator, and auction, then captures and validates the child's escalation game and uses that same game for continuation backing and escrow payment. A nonempty list claims winning own-fork parent deposits and records their stable identities against descendant replay. An empty list still performs child setup and emits a zero-valued claim summary.",
				declarations: [{ name: 'claimForkedEscalationDeposits' }],
				preconditions:
					'Caller equals `vault`; unresolved escalation existed when the pool initiated its own fork and the parent game still satisfies `canTriggerOwnFork()` by having either a local non-decision or an inherited threshold tie without a fixed outcome; selected child can be created or loaded, remains in `ForkMigration`, has a continuation game that passes the [child-game trust boundary](#child-game-trust-boundary), and is inside the eight-week claim window. A nonempty list additionally requires the matching winning outcome, unclaimed deposit identities, and every deposit to commit `vault` as its immutable depositor.',
				signals:
					'`DeployChild`, `SecurityPoolRegistered`, `DeploySecurityPool`, `AuthorizationUpdated`, `ChildPoolLinked`, `TotalRepBackingUnitsSet`, `AwaitingForkContinuationSet`, `EscalationGameSet`, `GameContinuedFromFork`, `ForkCarryCheckpoint`, `MigrationRepSplit`, `ChildDisputeStakedRepMaterialized`, and `PoolHeldRepSweptToChild` as setup requires; per claimed deposit, `CarryDepositConsumed` and `ClaimDeposit`; escrow record/export events when REP is paid; always `ClaimForkedEscalationDepositsToWallet`, including for an empty list',
			},
			{
				call: '`startTruthAuction(securityPool)`',
				caller: 'Anyone',
				effect: "Copies the frozen parent's remaining economic claim supply into the child, closes migration accounting, and either reopens a fully backed child or starts its repair auction.",
				declarations: [{ name: 'startTruthAuction' }],
				preconditions: 'Child migration window ended; pool is in fork migration; required child REP is available. If unresolved escalation existed at fork, any game reported during immediate completion passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`ShareTokenSupplySet` and `TruthAuctionStarted`; immediate no-auction completion also emits `TruthAuctionFinalized`, pool accounting checkpoints, and `ForkContinuationResumed` for an unresolved continuation',
			},
			{
				call: '`finalizeTruthAuction(securityPool)`',
				caller: 'Anyone',
				effect: 'Finalizes the ended auction, accounts migration-routed settlement collateral plus accepted bid ETH, activates the child at that settlement-collateral level, and fixes bidder REP-backing-unit and capacity-ownership rates. A nonzero repair contribution is rejected.',
				declarations: [{ name: 'finalizeTruthAuction' }],
				preconditions:
					'Truth auction started, its one-week window has passed, `msg.value` is zero, and migrated collateral plus accepted bid ETH does not exceed current price-converted minting capacity. If unresolved escalation existed at fork, the game reported at completion passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`TruthAuctionFinalized`, auction `AuctionFinalized`, and pool accounting checkpoints; `TruthAuctionHaircutApplied` when purchased REP removes a positive escalation allocation; `ForkContinuationResumed` for an unresolved continuation',
			},
			{
				call: '`settleAuctionBids(securityPool, vault, claimTickIndices, refundTickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'settleAuctionBids' }],
				effect:
					'Before finalization, refunds only provably losing bids. After finalization, combines claim and refund indexes into one settlement withdrawal and credits each fixed-position REP backing and capacity-ownership result. It also assigns the bidder vault its cumulative share of auctioned bad debt: intermediate cumulative shares round down and the final capacity claim receives the exact residual, so claim order cannot change the total. A winning dust bid may receive capacity ownership even when its REP allocation rounds to zero. A positive ETH push is gas-bounded and defers on rejection, revert, or gas exhaustion.',
				preconditions: 'At least one index; before finalization the claim list must be empty and refund indexes must be eligible; after finalization all indexes must belong to the named vault owner and remain unsettled.',
				signals: 'Underlying auction `BidSettled`; `EthRefundDeferred` when the named bidder rejects a positive refund; `ClaimAuctionProceeds` with cumulative claimed and total auctioned bad debt when REP backing, capacity ownership, or bad debt is credited',
			},
			{
				call: '`claimAuctionProceeds(securityPool, vault, tickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'claimAuctionProceeds' }],
				effect:
					'For a nonempty list, withdraws finalized bid settlements, converts purchased REP into child REP backing units, independently credits the bid positional capacity-ownership allocation, and assigns the bidder vault its cumulative share of auctioned bad debt. Intermediate cumulative shares round down and the final capacity claim receives the exact residual, so claim order cannot change the total. A winning dust bid can receive positive capacity ownership when its REP allocation rounds to zero. A positive ETH push is gas-bounded and defers on rejection, revert, or gas exhaustion, so recipient code cannot block the subsequent credit. For an empty list, the underlying auction withdrawal returns three zeros and the wrapper exits after the finalization guard without validating bids or the named beneficiary, calling it, changing state, or emitting events.',
				preconditions: 'Auction finalized. A nonempty list additionally requires every index to belong to the named vault owner and remain unsettled.',
				signals: 'For processed bids, underlying auction `BidSettled`; `EthRefundDeferred` when the named bidder rejects a positive refund; `ClaimAuctionProceeds` with cumulative claimed and total auctioned bad debt when REP backing, capacity ownership, or bad debt is credited; no event for an empty list',
			},
			{
				call: '`initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame)`',
				caller: 'This `SecurityPoolForker` contract only, through its migration delegate callback',
				effect:
					'Allows delegated migration code to initialize a child continuation while preserving the forker as the authoritative caller and the already captured child-game identity. When unresolved escalation requires a continuation and no game existed, it captures and validates the game created by initialization before any continuation use.',
				declarations: [{ name: 'initializeChildForkedEscalationGameIfNeeded' }],
				preconditions: 'External caller is the forker itself; parent and child match the active migration path; a supplied nonzero game passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`ChildDisputeStakedRepMaterialized` and escalation-continuation events when initialization is required',
			},
			{
				call: 'Direct ETH transfer to `receive()`',
				caller: 'A child-pool truth auction trusted by this forker during `ChildPoolLinked`',
				effect: 'Accepts auction ETH during forker-controlled auction finalization.',
				declarations: [{ kind: 'receive', name: 'receive' }],
				preconditions: '`trustedAuctionAddresses[msg.sender]` was set when the forker linked the child and emitted `ChildPoolLinked`; configured-factory registration determines whether that lineage is canonical.',
				signals: 'No dedicated receive event; auction `AuctionFinalized` is followed by forker `TruthAuctionFinalized` and pool accounting checkpoints',
			},
		],
	},
	{
		compiledAbiFingerprint: 'aa111e15b811c762945753415ef818ed6f85ec81553ab7ede082aca87869ad64',
		name: 'EscalationGame',
		purpose: 'Escrows outcome REP, raises the running resolution cost, detects non-decision, and settles local or carried deposits.',
		readAbiFingerprint: 'ed587e847ca84dfb0faa31896f294197b8e84a13c229b3bab68447f262dae58d',
		readSurface:
			'Base getters are `securityPool`, `repToken`, `activationTime`, `nonDecisionThresholdAttoRep`, `startBondAttoRep`, `nonDecisionTimestamp`, `nonDecisionState`, `forkContinuation`, `forkElapsedAtStart`, `forkResumedAt`, `fixedQuestionOutcome`, `nodes`, `disputeStakedRepByVaultAttoRep`, `totalDisputeStakedAttoRep`, `truthAuctionRepBeforeAttoRep`, `truthAuctionRepRemainingAttoRep`, `cumulativeClaimRetention`, and `cumulativeClaimRetentionExponent`. The claim delegate fallback exposes `rootClaimSourceGame`, `applyInheritedClaimRetention`, and `applyInheritedSourceStorageBasis`. The source-storage-basis read allocates retained carry by cumulative-prefix differences so leaf allocations sum to the aggregate checkpoint. `disputeStakedRepByVaultAttoRep` is locally attributed current-game escrow used for health; inherited carry remains aggregate commitment state until proof settlement. Use `previewDepositOnOutcome`, `computeIterativeAttritionCostAttoRep`, `computeTimeSinceStartFromAttritionCostAttoRep`, `totalCostAttoRep`, `getEscalationGameEndDate`, `getQuestionResolution`, `getFinalQuestionResolution`, `hasReachedNonDecision`, `canTriggerOwnFork`, `getBindingCapitalAttoRep`, `getOutcomeBalancesAttoRep`, `getDepositsByOutcome`, `getDepositsByOutcomeLength`, `forkCarrySnapshotInitialized`, `getOutcomeState`, `getForkCarrySnapshot`, `getForkCarryRoots`, `isForkCarryFundingComplete`, `getCarryLeafPageByOutcome`, `getProofConsumedCarriedDepositIndexesByOutcome`, `getLocalUnresolvedPrincipalByVaultAndOutcome`, and `getForkedEscrowByVaultAndOutcome` for calculations, lifecycle authorization, pages, carry state, and escrow. Ordinary users route deposits and withdrawals through `SecurityPool`.',
		readDeclarations: [
			{ name: 'previewDepositOnOutcome' },
			{ name: 'disputeStakedRepByVaultAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol' },
			{ name: 'rootClaimSourceGame', sourcePath: 'solidity/contracts/peripherals/EscalationGameClaimDelegate.sol' },
			{ name: 'applyInheritedClaimRetention', sourcePath: 'solidity/contracts/peripherals/EscalationGameClaimDelegate.sol' },
			{ name: 'applyInheritedSourceStorageBasis', sourcePath: 'solidity/contracts/peripherals/EscalationGameClaimDelegate.sol' },
			{ name: 'computeIterativeAttritionCostAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'computeTimeSinceStartFromAttritionCostAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'totalCostAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getEscalationGameEndDate', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getQuestionResolution', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getFinalQuestionResolution', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'hasReachedNonDecision', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'canTriggerOwnFork', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getBindingCapitalAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getOutcomeBalancesAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getDepositsByOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
			{ name: 'getDepositsByOutcomeLength', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' },
			{ name: 'forkCarrySnapshotInitialized', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'getOutcomeState', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'getForkCarrySnapshot', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'getForkCarryRoots', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'isForkCarryFundingComplete', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'getCarryLeafPageByOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'getProofConsumedCarriedDepositIndexesByOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' },
			{ name: 'getLocalUnresolvedPrincipalByVaultAndOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
			{ name: 'getForkedEscrowByVaultAndOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' },
		],
		readStorageDeclarations: [
			{ name: 'securityPool', sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol' },
			{ name: 'repToken', sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol' },
			{ name: 'activationTime', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nonDecisionThresholdAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'startBondAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nonDecisionTimestamp', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nonDecisionState', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'forkContinuation', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'forkElapsedAtStart', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'forkResumedAt', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nodes', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'totalDisputeStakedAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'truthAuctionRepBeforeAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'truthAuctionRepRemainingAttoRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'cumulativeClaimRetention', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'cumulativeClaimRetentionExponent', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'fixedQuestionOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
		],
		sourcePath: 'solidity/contracts/peripherals/EscalationGame.sol',
		interactions: [
			{
				call: '`start(startBondAttoRep, nonDecisionThresholdAttoRep)`',
				caller: '`EscalationGameFactory` contract during atomic deployment',
				effect: 'Initializes a local game and sets activation three days after deployment. For ordinary pool games, the factory lowers an oversized configured bond to `nonDecisionThresholdAttoRep - 1` before this call.',
				declarations: [{ name: 'start' }],
				preconditions: 'Game not already started; threshold exceeds the positive start bond. Positive attoREP values are valid.',
				signals: '`GameStarted`',
			},
			{
				call: '`startFromFork(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBackingAttoRep)`',
				caller: 'Immutable owner (`EscalationGameFactory`) during atomic continuation deployment',
				effect: 'Initializes a paused continuation with inherited elapsed time, an optional fixed matching child outcome, and immutable fork-time haircut/backing accounting. It does not start the remaining clock until `resumeFromFork`.',
				declarations: [{ name: 'startFromFork' }],
				preconditions: 'Game not started; threshold exceeds the positive start bond; inherited elapsed time is no greater than seven weeks. Positive attoREP values are valid.',
				signals: '`GameContinuedFromFork`',
			},
			{
				call: '`resumeFromFork()`',
				caller: 'Owning `SecurityPool` only',
				effect:
					'Records the resume timestamp once the immutable carry commitment is installed and funded. The new deadline is `max(rebasedCurveEnd, forkResumedAt + 3 days)`, so even an exhausted inherited clock receives a fresh response period. After that deadline, `getFinalQuestionResolution` returns the fixed outcome when the continuation has one.',
				declarations: [{ name: 'resumeFromFork' }],
				preconditions:
					'Fork-continuation mode; not previously resumed; immutable carry snapshot installed; aggregate REP funding complete. An unrelated fork requires one-to-one backing of effective unresolved principal. For an own-fork continuation, recorded initial backing must be at least `sourcePrincipalAtForkAttoRep - ⌊sourcePrincipalAtForkAttoRep / 5⌋`, where `sourcePrincipalAtForkAttoRep` is the aggregate raw unresolved principal installed by the snapshot before effective direct-claim deductions. The live balance must cover that initial backing minus child REP already exported by valid direct pre-resume claims.',
				signals: '`ForkContinuationResumed`',
			},
			{
				call: '`applyTruthAuctionHaircut(repToRemove)`',
				caller: "The child pool's `SecurityPoolForker` only",
				declarations: [{ name: 'applyTruthAuctionHaircut' }],
				effect: 'Transfers the sold child REP to the pool, applies one retention ratio to escrow and outcome balances, and rebases elapsed curve time. The fork remains final and the game remains paused until the pool resumes it.',
				preconditions: "Paused fork continuation; no prior auction haircut; the requested amount is below the game's live REP balance.",
				signals: '`TruthAuctionHaircutApplied` and REP `Transfer`',
			},
			{
				call: '`recordDepositFromSecurityPool(...)`',
				caller: 'Owning `SecurityPool` only',
				effect: 'Appends an accepted local deposit, updates outcome and vault escrow, and records its carry leaf.',
				declarations: [{ name: 'recordDepositFromSecurityPool' }],
				preconditions: 'Explicit non-decision state is `None`; game unresolved; valid outcome; preview and accepted cumulative amount match; room remains below threshold.',
				signals: '`LocalDepositAppended`, `DepositOnOutcome`, optionally `NonDecisionReached`',
			},
			{
				call: '`withdrawDeposit(uint256 depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` only',
				declarations: [{ name: 'withdrawDeposit', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect: "Consumes one local deposit after resolution. A winner pays the deposit's immutable depositor after its haircut; a loser only retires its escrow accounting.",
				preconditions: 'Explicit non-decision state is `None`; non-`None` supplied outcome; game final; game and pool final outcomes match; valid unsettled local deposit index.',
				signals: '`CarryDepositConsumed` and `VaultEscrowUpdated`; for a winner, `ClaimDeposit`, positive REP payout `Transfer`, and haircut burn signals when nonzero',
			},
			{
				call: '`initializeForkCarrySnapshotWithResolutionBalances(...)`',
				caller: 'Owning `SecurityPool` only',
				declarations: [{ name: 'initializeForkCarrySnapshotWithResolutionBalances', sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol' }],
				effect: 'Installs the immutable inherited peaks, leaf counts, carry totals, resolution balances, and normalized nullifier roots; zero snapshot ID selects the computed ID. Two or more threshold-full inherited balances set `nonDecisionState` to `InheritedThresholdTie` without creating a local timestamp.',
				preconditions: 'Fork-continuation mode; no prior snapshot; each leaf count fits the MMR; supplied nonzero snapshot ID equals the hash of the normalized data.',
				signals: '`ForkCarryCheckpoint`; additionally `InheritedThresholdTie` when the installed balances meet the non-decision threshold',
			},
			{
				call: '`claimDepositForWinning(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'claimDepositForWinning', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect: "Consumes a selected local deposit as a winner, consumes its vault escrow, burns the computed haircut when nonzero, and transfers the remaining positive REP payout to the deposit's immutable depositor.",
				preconditions: 'Non-`None` supplied outcome and valid unsettled local deposit with sufficient escrow. This entrypoint itself does not check final resolution or that the supplied outcome won; its trusted caller selects that path.',
				signals: '`CarryDepositConsumed`, `VaultEscrowUpdated`, `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and haircut burn signals only when their amounts are positive',
			},
			{
				call: '`claimDepositForWinningWithoutTransfer(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'claimDepositForWinningWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect:
					"Consumes a selected local deposit and its vault escrow. The depositor's raw escrow backing decreases by the inverse-retention claim units corresponding to the deposit's original principal: the principal itself with no local auction checkpoint, or `⌈originalPrincipal × truthAuctionRepBeforeAttoRep / truthAuctionRepRemainingAttoRep⌉` after a local haircut. Other unconsumed deposits by the same depositor remain backed. The game returns the computed winner amount to the trusted caller but deliberately neither transfers REP nor burns the computed haircut.",
				preconditions: 'Valid in-range supplied outcome and unsettled local deposit with sufficient escrow. Unlike the transferring form, it has no explicit non-`None` guard; neither form checks final resolution or that the outcome won.',
				signals: '`CarryDepositConsumed`, `VaultEscrowUpdated`, and `ClaimDeposit` with `transferredRep = false`; no REP transfer or haircut burn',
			},
			{
				call: '`exportUnresolvedDeposit(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportUnresolvedDeposit', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect: 'Returns deposit identity and amount to the trusted caller while consuming the local deposit from unresolved/escrow accounting without transferring REP.',
				preconditions: 'Non-`None` outcome and a valid unsettled local deposit. Final resolution is not required.',
				signals: '`CarryDepositConsumed` and `VaultEscrowUpdated`; no `ClaimDeposit` or REP transfer',
			},
			{
				call: '`withdrawDeposit(CarriedDepositProof proof, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'withdrawDeposit', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect: 'Consumes an inherited proof, transfers any positive winning payout, and burns the positive haircut unless the fork already paid it.',
				preconditions: 'Non-`None` supplied outcome; game final and matching the pool final outcome; supplied outcome is the winner; parent deposit was not directly claimed; valid unconsumed Merkle/nullifier proof.',
				signals: '`CarryDepositConsumed` and `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and haircut burn signals only when positive',
			},
			{
				call: '`exportVaultUnresolvedTotals(vault, repReceiver)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportVaultUnresolvedTotals', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' }],
				effect: "Marks the vault's local unresolved totals exported exactly once, clears each outcome amount, consumes aggregate unresolved and escrow accounting when positive, and transfers the positive total to `repReceiver`.",
				preconditions: '`vault` is nonzero and has not exported before. There is no explicit nonzero-receiver guard: a zero receiver succeeds when the total is zero but the token rejects it when a positive transfer is attempted.',
				signals: 'Always `VaultUnresolvedTotalsExported`, including when every amount is zero; `VaultEscrowUpdated` and REP `Transfer` only for a positive total',
			},
			{
				call: '`exportVaultUnresolvedTotalsWithoutTransfer(vault)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportVaultUnresolvedTotalsWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' }],
				effect: "Marks the vault's local unresolved totals exported exactly once, clears each outcome amount, and consumes aggregate unresolved and escrow accounting when positive, but leaves token movement to its caller.",
				preconditions: '`vault` is nonzero and has not exported before.',
				signals: 'Always `VaultUnresolvedTotalsExported` with `transferredRep = false`, including when every amount is zero; `VaultEscrowUpdated` only for a positive total; no REP transfer',
			},
			{
				call: '`drainAllRep(receiver)`',
				caller: 'Owning `SecurityPool` only',
				declarations: [{ name: 'drainAllRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect: "Transfers the game's full REP balance to `receiver`. A zero balance returns zero without a transfer or event.",
				preconditions: '`receiver` is nonzero; no positive-balance requirement. The protocol reaches this call from the owning pool after `activateForkMode` enters `PoolForked`.',
				signals: 'REP `Transfer` for a positive balance; no event at zero balance',
			},
			{
				call: '`recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'recordForkedEscrowForOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' }],
				effect:
					'Accumulates source principal and child REP escrow for the depositor and outcome. The depositor remains the immutable payout owner; inherited claims remain in the carry commitment and are not copied into child-local ownership state. When both amounts are zero, returns without changing state or emitting an event.',
				preconditions: 'Outcome is not `None`; depositor is nonzero. Source principal and child REP may independently be zero; when both are zero, the call is a no-op.',
				signals: '`ForkedEscrowRecorded` for a nonzero record; no event when both amounts are zero',
			},
			{
				call: '`exportForkedEscrowByOutcome(vault, repReceiver)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportForkedEscrowByOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' }],
				effect: 'Marks every remaining per-outcome escrow amount exported and transfers its positive child REP. When all outcomes were already empty or exported, returns zero arrays without state change, token transfer, or event.',
				preconditions: '`vault` and `repReceiver` are nonzero.',
				signals: '`ForkedEscrowExported` when any source principal or child REP remains; REP `Transfer` when positive child REP is transferred; no event for an already-empty export',
			},
			{
				call: '`exportForkedEscrowByOutcomeWithoutTransfer(vault)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportForkedEscrowByOutcomeWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' }],
				effect: 'Marks every remaining per-outcome escrow amount exported without transferring child REP. When all outcomes were already empty or exported, returns zero arrays without state change or event.',
				preconditions: '`vault` is nonzero.',
				signals: '`ForkedEscrowExported` with `transferredRep = false` when any source principal or child REP remains; no REP transfer; no event for an already-empty export',
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
		compiledAbiFingerprint: '24fef7375af443bf5477c0c4afa6d6ce6ef852f82a8b17d46bd1cea15bc3c264',
		name: 'LiquidationApprovalRegistry',
		purpose: 'Stores coordinator-local, bounded authorization for a receiver vault to accept liquidation debt from an exact operator.',
		readAbiFingerprint: '04465d90cef2bd37454bf8496fffcaccf07f0ec5808f31ffd6481d4cdc46f810',
		readSurface:
			'Use `coordinator` to identify the validating coordinator and implied security pool. `LIQUIDATION_APPROVAL_TYPEHASH`, `DOMAIN_SEPARATOR`, and `liquidationApprovalDigest` define the chain- and registry-bound EIP-712 message. `getLiquidationApproval` reports parameters plus available, reserved, consumed, and revoked state; `minimumLiquidationApprovalNonce` reports receiver invalidation state; `liquidationReservations` and `minimumHealthFactorBps` expose operation reservation state and its execution-time health floor.',
		readDeclarations: [{ name: 'DOMAIN_SEPARATOR' }, { name: 'liquidationApprovalDigest' }, { name: 'getLiquidationApproval' }, { name: 'minimumHealthFactorBps' }],
		readStorageDeclarations: [{ name: 'coordinator' }, { name: 'LIQUIDATION_APPROVAL_TYPEHASH' }, { name: 'minimumLiquidationApprovalNonce' }, { name: 'liquidationReservations' }],
		sourcePath: 'solidity/contracts/peripherals/LiquidationApprovalRegistry.sol',
		interactions: [
			{
				call: '`initialize(coordinator)`',
				caller: 'Anyone while the registry remains uninitialized; normal factory deployment initializes the clone atomically',
				effect: 'Binds this registry clone to one coordinator and therefore one security pool.',
				declarations: [{ name: 'initialize' }],
				preconditions: 'Coordinator is nonzero and the registry has not been initialized.',
				signals: 'No event; the public `coordinator` getter records the binding.',
			},
			{
				call: '`setLiquidationApproval(params)`',
				caller: 'The receiver vault named by `params`',
				effect: 'Installs explicit onchain bounded approval state and consumes the receiver-scoped nonce.',
				declarations: [{ name: 'setLiquidationApproval' }],
				preconditions: 'Correct local pool; nonzero receiver and operator; positive cumulative and per-operation limits with per-operation no greater than cumulative; health factor at least 10,000 BPS; live ordered validity window; unused, non-invalidated nonce.',
				signals: '`LiquidationApprovalSet`',
			},
			{
				call: '`permitLiquidationApproval(params, signature)`',
				caller: 'Anyone relaying the receiver vault signature',
				effect: 'Validates an EIP-712 EOA or ERC-1271 signature immediately, installs explicit approval state, and consumes the receiver-scoped nonce.',
				declarations: [{ name: 'permitLiquidationApproval' }],
				preconditions: 'Signature is valid for `params.receiverVault`; the chain ID, registry address, stable name/version, pool, receiver, operator, target scope, limits, health factor, window, and nonce are bound by the digest; direct-install validation rules also pass.',
				signals: '`LiquidationApprovalSet`',
			},
			{
				call: '`revokeLiquidationApproval(approvalId)`',
				caller: 'Approval receiver vault only',
				effect: 'Prevents new reservations while leaving reservations already attached to staged operations intact.',
				declarations: [{ name: 'revokeLiquidationApproval' }],
				preconditions: 'Approval exists and is not already revoked.',
				signals: '`LiquidationApprovalRevoked` with available, reserved, and consumed totals',
			},
			{
				call: '`invalidateLiquidationApprovalNonce(newNonce)`',
				caller: 'Receiver vault invalidating its own older nonce range',
				effect: 'Raises the minimum nonce accepted for new approval installation or reservation.',
				declarations: [{ name: 'invalidateLiquidationApprovalNonce' }],
				preconditions: 'New nonce is greater than the receiver current minimum.',
				signals: '`LiquidationApprovalNonceInvalidated`',
			},
			{
				call: '`reserve(operationId, approvalId, receiverVault, targetVault, operator, requestedDebtAttoEth, snapshotTargetDebtAttoEth, latestExecutionTimestamp)`',
				caller: 'Bound coordinator only',
				effect: 'Moves quota from available to pending reserved at staging, bounded by requested debt, target snapshot debt, per-operation limit, and available cumulative quota.',
				declarations: [{ name: 'reserve' }],
				preconditions: 'Approval matches local pool, receiver, exact operator, and exact or wildcard target; it is active, unrevoked, non-invalidated, valid through latest execution, and has positive reservable quota.',
				signals: '`LiquidationApprovalReserved`',
			},
			{
				call: '`release(operationId)`',
				caller: 'Bound coordinator only',
				effect: 'Returns an unsettled delegated reservation to available quota. A missing, self-route, or already settled reservation is a no-op.',
				declarations: [{ name: 'release' }],
				preconditions: 'Coordinator terminal cleanup path.',
				signals: '`LiquidationApprovalReleased` when quota is returned',
			},
			{
				call: '`consume(operationId, debtMovedAttoEth)`',
				caller: 'Bound coordinator only',
				effect: 'Permanently consumes exactly moved debt, releases unused reservation, and settles the reservation once.',
				declarations: [{ name: 'consume' }],
				preconditions: 'For a delegated reservation, it is unsettled and moved debt does not exceed reserved debt. A self route is a no-op.',
				signals: '`LiquidationApprovalConsumed`',
			},
		],
	},
	{
		compiledAbiFingerprint: '60cd10890a685efe179e17e93a783c660542bd6368f86fed87f46de03695b243',
		name: 'OpenOraclePriceCoordinator',
		purpose: 'Obtains a fresh REP-per-ETH price and coordinates withdrawals, delegated liquidation routing, approval reservations, and terminal cleanup.',
		readAbiFingerprint: '288a73d13de5a0f593226105eb11eb177bf085ac2ee708a31645c3d7c4eb7237',
		readSurface:
			'Configuration getters are `MAX_PENDING_SETTLEMENT_OPERATIONS`, `OPEN_INTEREST_DIVIDER`, `reputationToken`, `securityPool`, `openOracle`, `weth`, `liquidationApprovalRegistry`, `gasConsumedOpenOracleReportPrice`, `gasConsumedSettlement`, `gasUnitsForOneDispute`, `initialReportPriorityFeeAttoEthPerGas`, `targetPriceErrorForDispute`, `openOracleSecurityMultiplierBps`, `settlementTime`, `disputeDelay`, `protocolFee`, `feePercentage`, `multiplier`, `timeType`, `trackDisputes`, `protocolFeeRecipient`, `escalationHaltMultiplierBps`, `maxSettlementBaseFeeMultiplierBps`, and `minLiquidationPriceDistanceBps`. Current report and operation getters are `pendingReportId`, `pendingReportSponsor`, `pendingOperationSlotId`, `lastSettlementTimestamp`, `lastPrice`, `pendingReportMaxSettlementBaseFeeAttoEthPerGas`, `stagedOperationCounter`, and `stagedOperations`. Use `isPriceValid`, `minimumToken1ReportAttoEth`, `getRequestPriceCostAttoEth`, `getQueuedOperationCostAttoEth`, `getSettlementCallbackGasLimit`, `getPendingOperationSlot`, `getActiveStagedOperationCount`, `getActiveStagedOperations`, `getPendingSettlementOperationCount`, and `getPendingSettlementOperationIds` for derived or paged state.',
		securityBoundary:
			'Report and staged-operation liveness depends on [A16 timely inclusion](./security-model.html#assumption-a16), [A17 corrector capability](./security-model.html#assumption-a17), [A18 independent correction incentive](./security-model.html#assumption-a18), [A19 observable correctable price](./security-model.html#assumption-a19), and [A06 lifecycle executors](./security-model.html#assumption-a06). When `lastPrice` is zero, the official client currently needs an offchain market quote to propose the first report; quote availability is a client limitation rather than a protocol security assumption. Proposals copied from a nonzero cached price do not use that quote path.',
		readDeclarations: [
			{ name: 'isPriceValid' },
			{ name: 'minimumToken1ReportAttoEth' },
			{ name: 'getRequestPriceCostAttoEth' },
			{ name: 'getQueuedOperationCostAttoEth' },
			{ name: 'getSettlementCallbackGasLimit' },
			{ name: 'getPendingOperationSlot' },
			{ name: 'getActiveStagedOperationCount' },
			{ name: 'getPendingSettlementOperationCount' },
			{ name: 'getPendingSettlementOperationIds' },
			{ name: 'getActiveStagedOperations' },
		],
		readStorageDeclarations: [
			{ name: 'MAX_PENDING_SETTLEMENT_OPERATIONS' },
			{ name: 'OPEN_INTEREST_DIVIDER' },
			{ name: 'pendingReportId' },
			{ name: 'pendingReportSponsor' },
			{ name: 'pendingOperationSlotId' },
			{ name: 'lastSettlementTimestamp' },
			{ name: 'lastPrice' },
			{ name: 'reputationToken' },
			{ name: 'securityPool' },
			{ name: 'openOracle' },
			{ name: 'weth' },
			{ name: 'gasConsumedOpenOracleReportPrice' },
			{ name: 'gasConsumedSettlement' },
			{ name: 'gasUnitsForOneDispute' },
			{ name: 'initialReportPriorityFeeAttoEthPerGas' },
			{ name: 'targetPriceErrorForDispute' },
			{ name: 'openOracleSecurityMultiplierBps' },
			{ name: 'settlementTime' },
			{ name: 'disputeDelay' },
			{ name: 'protocolFee' },
			{ name: 'feePercentage' },
			{ name: 'multiplier' },
			{ name: 'timeType' },
			{ name: 'trackDisputes' },
			{ name: 'protocolFeeRecipient' },
			{ name: 'escalationHaltMultiplierBps' },
			{ name: 'maxSettlementBaseFeeMultiplierBps' },
			{ name: 'minLiquidationPriceDistanceBps' },
			{ name: 'pendingReportMaxSettlementBaseFeeAttoEthPerGas' },
			{ name: 'stagedOperationCounter' },
			{ name: 'stagedOperations' },
			{ name: 'liquidationApprovalRegistry' },
		],
		sourcePath: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
		interactions: [
			{
				call: '`requestPriceIfNeededAndStageLiquidation(targetVault, receiverVault, requestedDebtAttoEth, approvalId, ...)`',
				caller: 'Liquidation operator; a delegated receiver must have approved this exact operator',
				effect: 'Stages explicit operator, receiver, and target roles and reserves bounded receiver quota before any oracle work. The self-receiving operator path uses a zero approval ID.',
				declarations: [{ name: 'requestPriceIfNeededAndStageLiquidation' }],
				preconditions: 'Receiver differs from target; delegated approval matches pool, receiver, operator, and target scope, has available cumulative and per-operation quota, and remains valid through latest execution.',
				signals: '`LiquidationRouteStaged`; `LiquidationApprovalReserved` on a delegated route; staged-operation lifecycle events',
			},
			{
				call: '`requestPriceIfNeededAndStageOperation(...)` with funding when stale',
				caller: 'Vault owner for self withdrawal; legacy self-receiving liquidation callers remain supported. While a report is pending, only that report sponsor may stage more operations.',
				effect:
					'Records the operation, executes immediately with a fresh price, or attaches it to a bounded pending settlement batch and opens a report when required. If unused ETH is positive, the final caller refund uses a low-level callback; rejection rolls back the entire transaction, including any queueing, immediate execution, or newly opened report.',
				declarations: [{ name: 'requestPriceIfNeededAndStageOperation' }],
				preconditions:
					'`securityPool.isEscalationResolved()` is false; valid target, nonzero amount, and timeout from 1 second through 5 minutes. Bounty, buffered report funding, matching REP, and token approvals are required only when this call opens a new report. The caller must accept any positive unused-ETH refund.',
				signals: '`StagedOperationQueued`, possibly `PriceRequested`, then `ExecutedStagedOperation`; authoritative `CoordinatorStateCheckpoint` records',
			},
			{
				call: '`requestPrice(proposedRepPerEthPrice, requestedInitialAttoWeth)` with report funding',
				caller: 'Anyone when no fresh price or report is pending',
				effect: 'Opens and atomically funds a fresh WETH/REP report without staging a new operation, then refunds any positive excess ETH through a low-level caller callback. Callback rejection rolls back the report and initial position.',
				declarations: [{ name: 'requestPrice' }],
				preconditions:
					'Cached price stale; no pending report; nonzero proposed REP/ETH price, ETH bounty, and funding and approvals for at least the configured priority report plus the larger of the base-fee and open-interest WETH reports, plus matching REP. Zero requested WETH uses the minimum; a larger request voluntarily increases the initial report. The caller must accept any positive excess-ETH refund.',
				signals: '`PriceRequested` and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`executeStagedOperation(operationId)`',
				caller: 'Anyone',
				effect:
					"Consumes an expired operation and releases its delegated reservation without requiring a valid price. Otherwise, consumes and attempts the active operation using the current fresh price. Price-report funding is independent of the operation's notional; the downstream operation applies its own protocol bounds.",
				declarations: [{ name: 'executeStagedOperation' }],
				preconditions: 'Operation exists. Expired cleanup requires no valid price; a non-expired operation requires a fresh coordinator price. Lifecycle failures are emitted rather than retried.',
				signals: '`ExecutedStagedOperation`, either `LiquidationApprovalConsumed` or `LiquidationApprovalReleased` for a delegated liquidation, and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`expireStagedOperation(operationId)`',
				caller: 'Anyone',
				effect: 'Permissionlessly consumes an expired operation and releases its liquidation reservation without requiring a valid oracle price.',
				declarations: [{ name: 'expireStagedOperation' }],
				preconditions: 'Operation exists and its settlement-plus-validity window has elapsed.',
				signals: '`ExecutedStagedOperation`, `LiquidationApprovalReleased` for a delegated liquidation, and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`recoverSettledPendingReport()`',
				caller: 'Anyone',
				effect: 'Clears a pending report whose normal callback path did not clear coordinator state, consumes every live operation attached to that report, and releases each delegated-liquidation reservation. Operations that were active but outside the bounded pending callback batch remain active.',
				declarations: [{ name: 'recoverSettledPendingReport' }],
				preconditions: 'A pending report ID exists and its stored OpenOracle `storedGame(reportId).settlementTimestamp` is nonzero.',
				signals: '`PendingReportRecovered`, failed `ExecutedStagedOperation` for each live attached operation, `LiquidationApprovalReleased` for each attached delegated liquidation, and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`openOracleCallback(...)`',
				caller: 'Configured `OpenOracle` only',
				effect: 'A valid settlement updates the price and auto-executes the bounded pending batch. A terminally rejected settlement consumes the pending batch and releases every liquidation reservation.',
				declarations: [{ name: 'openOracleCallback' }],
				preconditions: 'Callback report matches the pending report; excessive settlement basefee, a saturated `uint24` report counter, an uneconomic final history record at its recorded base fee plus configured priority fee, or zero values reject the price after clearing pending report state.',
				signals: '`PriceReported` or `PriceReportRejected`; operation execution events; authoritative `CoordinatorStateCheckpoint` records',
			},
			{
				call: '`setLiquidationApprovalRegistry(registry)`',
				caller: 'Coordinator deployment factory only',
				effect: 'Binds the coordinator-local approval registry once.',
				declarations: [{ name: 'setLiquidationApprovalRegistry' }],
				preconditions: 'Registry is nonzero and no registry was previously installed.',
				signals: 'No event; deterministic factory deployment and the public getter identify the registry.',
			},
			{
				call: '`setSecurityPool(pool)`',
				caller: 'Anyone while `securityPool` remains zero; normal factory deployment calls atomically',
				effect: 'A nonzero value binds the pool permanently. A zero value emits and checkpoints zero but leaves the setter callable. Normal factory deployment supplies the nonzero canonical pool before returning the coordinator.',
				declarations: [{ name: 'setSecurityPool' }],
				preconditions: 'Current `securityPool` is zero; the argument itself is not required to be nonzero.',
				signals: '`SecurityPoolSet` and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`setRepEthPrice(price)`',
				caller: 'Configured nonzero `SecurityPool` only',
				effect: "Seeds the coordinator's price value, including zero, for inherited child state.",
				declarations: [{ name: 'setRepEthPrice' }],
				preconditions: 'Caller equals the configured pool.',
				signals: '`RepEthPriceSet` and `CoordinatorStateCheckpoint`',
			},
		],
	},
	{
		compiledAbiFingerprint: 'b4d43db4a275c3118a700ca255a7f63d42dfdca1fb1e7c554d681e589a76ac85',
		name: 'ShareToken',
		purpose: "Stores universe-aware ERC-1155 outcome shares and materializes a holder's persistent source entitlement in selected fork branches.",
		readAbiFingerprint: '6093653de73a0e5fa1e400d77bbded71a92de1197f58bd89da82a657887f349e',
		readSurface:
			'Base and relationship getters are `name`, `symbol`, `zoltar`, `canonicalPoolByUniverse`, `_balances`, `_supplies`, and `_operatorApprovals`. Standard ERC-1155 reads are `supportsInterface`, `balanceOf`, `totalSupply`, `balanceOfBatch`, and `isApprovedForAll`; protocol-specific reads are `isAuthorized`, `totalSupplyForOutcome`, `maximumOutcomeSupply`, `balanceOfOutcome`, `balanceOfShares`, `getMigratedShareAmountAttoShares`, `getTokenId`, `getTokenIds`, and `unpackTokenId`.',
		readDeclarations: [
			{ name: 'supportsInterface', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'balanceOf', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'totalSupply', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'balanceOfBatch', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'isApprovedForAll', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'isAuthorized' },
			{ name: 'totalSupplyForOutcome' },
			{ name: 'maximumOutcomeSupply' },
			{ name: 'balanceOfOutcome' },
			{ name: 'balanceOfShares' },
			{ name: 'getMigratedShareAmountAttoShares' },
			{ name: 'getTokenId' },
			{ name: 'getTokenIds' },
			{ name: 'unpackTokenId' },
		],
		readStorageDeclarations: [
			{ name: 'name' },
			{ name: 'symbol' },
			{ name: 'zoltar' },
			{ name: 'canonicalPoolByUniverse' },
			{ name: '_balances', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: '_supplies', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: '_operatorApprovals', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
		],
		sourcePath: 'solidity/contracts/peripherals/tokens/ShareToken.sol',
		interactions: [
			{
				call: '`setApprovalForAll(operator, approved)`',
				caller: 'Any token account setting its own operator approval',
				effect: "Sets or clears the operator's authority over all of the caller's outcome-token balances.",
				declarations: [{ name: 'setApprovalForAll', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' }],
				preconditions: 'The operator differs from the caller.',
				signals: '`ApprovalForAll`',
			},
			{
				call: 'Both `safeTransferFrom(...)` overloads',
				caller: 'Share holder or approved ERC-1155 operator',
				effect: 'Transfers one outcome-token balance without changing supply.',
				declarations: [{ name: 'safeTransferFrom', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' }],
				preconditions:
					'Caller holds the source balance or has operator approval; the source account has not materialized that token into any child branch; destination is nonzero; the source balance is sufficient; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract recipient accepts the ERC-1155 callback.',
				signals: '`TransferSingle`',
			},
			{
				call: 'Both `safeBatchTransferFrom(...)` overloads',
				caller: 'Share holder or approved ERC-1155 operator for a nonempty batch; any caller for an empty batch',
				effect: 'A nonempty batch transfers each listed outcome-token balance without changing supply. Equal empty ID and value arrays return as a no-op without an event.',
				declarations: [{ name: 'safeBatchTransferFrom', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' }],
				preconditions:
					'ID and value array lengths match. A nonempty batch also requires holder or operator authority, no listed source token that the source account has already materialized into a child branch, a nonzero destination, sufficient source balances, and, under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), an accepting ERC-1155 callback from a contract recipient; the empty-batch no-op performs none of those checks.',
				signals: '`TransferBatch` for a nonempty batch; no event for an empty batch',
			},
			{
				call: '`migrate(fromId, targetOutcomeIndexes)`',
				caller: 'Holder of the source token ID',
				effect:
					"If needed, first freezes the operational source pool and records its fork snapshot. A single-target call may lazily create that child while the branch-creation window is open. It keeps and locks the holder's source entitlement, then mints each selected child-universe token ID up to the current source balance. Later source additions materialize only the unminted delta. A contract holder receives the ERC-1155 single-receiver callback for each mint; rejection rolls back the mint and preceding fork or child setup.",
				declarations: [{ name: 'migrate' }],
				preconditions:
					'Source universe forked; canonical source pool is `Operational` or `PoolForked`, and an `Operational` source has no inherited fixed outcome because auto-fork activation rejects one; positive source balance; nonempty, strictly increasing, well-formed outcomes; every target in a multi-target call already has a canonical child pool; after the branch-creation window, a single target must also already exist; at least one selected child has an unmaterialized balance; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract holder accepts `onERC1155Received` for every target mint.',
				signals:
					'`PoolForkModeActivated`, `PoolAccountingCheckpoint`, `SecurityPoolForkSnapshot`, `ParentRepLocked`, and optionally `DisputeStakedRepDrainedAtFork` when auto-forking; `SecurityPoolRegistered`, `DeploySecurityPool`, `AuthorizationUpdated`, and `ChildPoolLinked` when lazily deploying, plus `DeployChild`, `ChildRepSplit`, `PoolHeldRepSweptToChild`, `EscalationGameSet`, `GameContinuedFromFork`, `ForkCarryCheckpoint`, and `ChildDisputeStakedRepMaterialized` as applicable; then one ERC-1155 mint `TransferSingle` and `Migrate` per materialized target on successful callbacks',
			},
			{
				call: '`authorize(securityPoolCandidate)`',
				caller: 'Initially authorized `SecurityPoolFactory` for an origin pool; an authorized parent `SecurityPool` for a child pool',
				effect: 'Establishes the candidate as `canonicalPoolByUniverse` for its universe and adds it to the set allowed to mint, burn, and authorize descendants. Reauthorizing the same candidate is a no-op.',
				declarations: [{ name: 'authorize' }],
				preconditions: 'Caller is already authorized; the candidate reports this exact share token; its universe has no different canonical pool.',
				signals: '`AuthorizationUpdated` on first authorization; no event when the same candidate is already authorized',
			},
			{
				call: '`mintCompleteSets(universeId, account, amountAttoShares)`',
				caller: 'An authorized `SecurityPool`',
				effect: "Mints `amount` each of Invalid, Yes, and No to `account`, then invokes its ERC-1155 batch-receiver callback when it is a contract. Rejection rolls back the mint and the authorized pool's surrounding transaction.",
				declarations: [{ name: 'mintCompleteSets' }],
				preconditions: 'Caller is authorized; `account` is nonzero; `amount` is positive; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract account accepts `onERC1155BatchReceived`.',
				signals: '`TransferBatch` on a successful callback',
			},
			{
				call: '`burnCompleteSets(universeId, account, amountAttoShares)`',
				caller: 'An authorized `SecurityPool`',
				effect: 'Burns `amount` each of Invalid, Yes, and No from `account`; global outcome supplies may differ.',
				declarations: [{ name: 'burnCompleteSets' }],
				preconditions: 'Caller is authorized; `account` is nonzero and has at least `amount` of every outcome.',
				signals: '`TransferBatch`',
			},
			{
				call: '`burnTokenIdAndGetRemainingSupply(tokenId, account)`',
				caller: 'An authorized `SecurityPool`',
				effect: "Burns `account`'s full balance of `tokenId` and returns the burned amount and that token ID's remaining supply.",
				declarations: [{ name: 'burnTokenIdAndGetRemainingSupply' }],
				preconditions: '`account` is nonzero; caller is authorized.',
				signals: '`TransferSingle`, including when the burned balance is zero',
			},
		],
	},
	{
		compiledAbiFingerprint: '0f7cbe10566e33d0de1300b8613ef64fff72b11845bff8c4f2aa470d1ee1eb16',
		name: 'UniformPriceDualCapBatchAuction',
		purpose:
			'Collects ETH bids under ETH-raise and REP-sale caps, computes one clearing result, and supports paged settlement. AVL, cumulative-allocation, and refund-prefix mechanics live in [UniformPriceDualCapBatchAuctionStorage](../../solidity/contracts/peripherals/UniformPriceDualCapBatchAuctionStorage.sol), an internal storage library.',
		readAbiFingerprint: 'e4ad6ab91244711a2008716cfbdf62b6237d39321eefa984a4fdc7856267b8bc',
		readSurface:
			'Auction summary getters are `maxAttoRepBeingSold`, `attoEthRaiseCap`, `finalized`, `clearingTick`, `ethFilledAtClearingAttoEth`, `attoEthRaised`, `totalAttoRepPurchased`, `auctionStarted`, `minBidSizeAttoEth`, `owner`, `underfunded`, `underfundedThreshold`, `underfundedWinningAttoEth`, and `activeTickCount`. `pendingEthRefundsAttoEth` reports ETH whose gas-bounded push failed during settlement and can still be pulled. Use `computeClearing`, `previewFinalization`, `tickToPrice`, `getTickSummary`, `getTickCount`, `getTickPage`, `getActiveTickPage`, `getBidCountAtTick`, `getBidPageAtTick`, `getBidderBidCount`, and `getBidderBidPage` before finalizing or submitting settlement indexes.',
		readDeclarations: [
			{ name: 'computeClearing' },
			{ name: 'previewFinalization' },
			{ name: 'tickToPrice' },
			{ name: 'getTickSummary' },
			{ name: 'getTickCount' },
			{ name: 'getTickPage' },
			{ name: 'getActiveTickPage' },
			{ name: 'getBidCountAtTick' },
			{ name: 'getBidPageAtTick' },
			{ name: 'getBidderBidCount' },
			{ name: 'getBidderBidPage' },
		],
		readStorageDeclarations: [
			{ name: 'maxAttoRepBeingSold' },
			{ name: 'attoEthRaiseCap' },
			{ name: 'finalized' },
			{ name: 'clearingTick' },
			{ name: 'ethFilledAtClearingAttoEth' },
			{ name: 'attoEthRaised' },
			{ name: 'totalAttoRepPurchased' },
			{ name: 'auctionStarted' },
			{ name: 'minBidSizeAttoEth' },
			{ name: 'owner' },
			{ name: 'underfunded' },
			{ name: 'underfundedThreshold' },
			{ name: 'underfundedWinningAttoEth' },
			{ name: 'activeTickCount' },
			{ name: 'pendingEthRefundsAttoEth' },
		],
		sourcePath: 'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol',
		interactions: [
			{
				call: '`startAuction(attoEthRaiseCap, maxAttoRepBeingSold)`',
				caller: 'Auction owner (`SecurityPoolForker`) only',
				effect: 'Starts the one-week auction and fixes its two caps and minimum bid.',
				declarations: [{ name: 'startAuction' }],
				preconditions: 'Auction not previously started; both caps are positive; the REP cap does not exceed 11 million REP; the ETH cap fits in `uint128`; the block timestamp fits in `uint48`.',
				signals: '`AuctionStarted`',
			},
			{
				call: '`submitBid(tick)` with ETH',
				caller: 'Any bidder',
				effect: "Adds ETH demand at the selected positive-price tick while extending that tick's append-only cumulative bid and refund history, including when a fully refunded tick becomes active again.",
				declarations: [{ name: 'submitBid' }],
				preconditions: 'Auction active and unfinalized; before one-week deadline; bid meets `minBidSizeAttoEth`; tick maps to nonzero price; the individual bid and the resulting cumulative ETH at that tick each fit in `uint128`.',
				signals: '`BidSubmitted`',
			},
			{
				call: '`refundLosingBids(tickIndices)`',
				caller: 'Bidder for its own bids',
				declarations: [{ name: 'refundLosingBids' }],
				effect:
					"A nonempty list marks the caller's bids already provably below the current clearing tick and attempts an immediate gas-bounded ETH refund. Rejected, reverted, or gas-exhausted pushes are recorded in `pendingEthRefundsAttoEth` without restoring the bid. An empty list changes no bids and makes no external call.",
				preconditions: 'Auction started and unfinalized; auction has reached a clearing price. Nonempty indexes additionally belong to the caller and are strictly losing and unrefunded.',
				signals: '`BidSettled` per refunded bid; `EthRefundDeferred` when a positive push fails',
			},
			{
				call: '`refundLosingBidsFor(bidder, tickIndices)`',
				caller: 'Auction owner (`SecurityPoolForker`) only; public callers use `settleAuctionBids`',
				declarations: [{ name: 'refundLosingBidsFor' }],
				effect:
					"A nonempty list marks and attempts a gas-bounded refund of a named bidder's bids already provably below the current clearing tick. Rejected, reverted, or gas-exhausted pushes are recorded in `pendingEthRefundsAttoEth` without restoring the bid. An empty list changes no bids and makes no external call.",
				preconditions: 'Named bidder is nonzero; auction started and unfinalized; auction has reached a clearing price. Nonempty indexes additionally belong to that bidder and are strictly losing and unrefunded.',
				signals: '`BidSettled` per refunded bid; `EthRefundDeferred` when a positive push fails',
			},
			{
				call: '`finalize()`',
				caller: 'Auction owner (`SecurityPoolForker`) only; users reach it through `finalizeTruthAuction`',
				effect: 'Fixes the clearing mode, clearing tick, ETH totals, and aggregate REP allocation, then calls the owner with the resulting proceeds, including when zero. A rejected call reverts finalization and its event.',
				declarations: [{ name: 'finalize' }],
				preconditions: 'Auction started, not finalized, and one-week deadline reached; owner accepts the proceeds ETH call, including zero value.',
				signals: '`AuctionFinalized`',
			},
			{
				call: '`withdrawBids(withdrawFor, tickIndices, proRataTotal)`',
				caller: 'Auction owner only',
				effect:
					'For a nonempty list, returns refunds, purchased REP, and a companion pro-rata allocation for the selected beneficiary bids so the forker can credit REP backing units and capacity ownership. Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making each payout independent of claim order. A rejected, reverted, or gas-exhausted positive refund push is gas-bounded and deferred rather than reverting or starving the REP and capacity-ownership settlement. An empty list returns three zeros without changing bids, emitting events, or calling the beneficiary.',
				declarations: [{ name: 'withdrawBids' }],
				preconditions: 'Auction finalized; caller is owner. Nonempty indexes belong to `withdrawFor` and remain unsettled.',
				signals: '`BidSettled` per processed bid; `EthRefundDeferred` when a positive push fails',
			},
			{
				call: '`withdrawPendingEthRefund()`',
				caller: 'Bidder with deferred ETH',
				effect: "Clears the caller's complete deferred refund and emits its withdrawal before transferring without the push-refund gas cap, so callback-created deferrals follow the clear in log order. A rejected pull reverts the transfer, clear, and event.",
				declarations: [{ name: 'withdrawPendingEthRefund' }],
				preconditions: 'Caller has a positive `pendingEthRefundsAttoEth` balance and currently accepts ETH.',
				signals: '`PendingEthRefundWithdrawn`',
			},
		],
	},
]

const content = await generateReferenceContent()
assert.match(content, /^<!-- Generated by scripts\/generate-contract-interaction-reference\.mts\. Do not edit directly\. -->/, 'contract reference must identify its canonical generator')
const html = await renderReferencePage('Contract interactions', content, outputPath)

if (Bun.argv.includes('--check')) {
	const outputFile = Bun.file(outputPath)
	assert.equal(await outputFile.exists(), true, `${outputPath} is missing; run bun run docs:generate-contract-reference`)
	assert.equal(await outputFile.text(), html, `${outputPath} is stale; run bun run docs:generate-contract-reference`)
} else {
	await writeFile(outputPath, html)
}

async function generateReferenceContent(): Promise<string> {
	const sourceByPath = new Map<string, string>()
	const compiledAbiFingerprintByContract = new Map<string, string>()
	const readAbiFingerprintByContract = new Map<string, string>()
	const representedReadNamesBySource = new Map<string, Set<string>>()
	const representedStorageNamesBySource = new Map<string, Set<string>>()
	const representedEntrypointKeys = new Set<string>()
	const referencedEventNames = new Set<string>()
	const getSource = async (sourcePath: string): Promise<string> => {
		const cachedSource = sourceByPath.get(sourcePath)
		if (cachedSource !== undefined) return cachedSource
		const source = await readFile(sourcePath, 'utf8')
		sourceByPath.set(sourcePath, source)
		return source
	}
	const compiledArtifacts: unknown = JSON.parse(await readFile('solidity/artifacts/Contracts.json', 'utf8'))
	for (const contractReference of contractReferences) {
		const compiledAbi = getCompiledContractAbi(compiledArtifacts, contractReference.sourcePath, contractReference.name)
		const actualFingerprint = computeCompiledAbiFingerprint(compiledAbi)
		assert.equal(actualFingerprint, contractReference.compiledAbiFingerprint, `${contractReference.name} compiled ABI changed; review every inherited function, event, getter, tuple component, and interaction row, then update its pinned fingerprint`)
		compiledAbiFingerprintByContract.set(contractReference.name, actualFingerprint)
	}
	for (const sourcePath of Object.keys(entrypointSignaturesBySource)) {
		assert.ok(sourcePath in stateChangingAbiFingerprintBySource, `${sourcePath} must have a state-changing ABI fingerprint`)
	}
	for (const [sourcePath, expectedFingerprint] of Object.entries(stateChangingAbiFingerprintBySource)) {
		const source = await getSource(sourcePath)
		const signaturesByName = entrypointSignaturesBySource[sourcePath] ?? {}
		assert.deepEqual(getPublicStateChangingDeclarationNames(source), Object.keys(signaturesByName).sort(), `${sourcePath} state-changing public entrypoints must exactly match the interaction metadata`)
		const actualFingerprint = computeStateChangingAbiFingerprint(getPublicStateChangingDeclarations(source))
		assert.equal(actualFingerprint, expectedFingerprint, `${sourcePath} state-changing ABI changed; review the interaction rows and update its pinned fingerprint`)
	}
	for (const eventSchema of documentedEventSchemas) {
		assertEventSchema(await getSource(eventSchema.sourcePath), eventSchema, eventSchema.sourcePath)
	}
	for (const mirror of delegateEventDeclarationMirrors) {
		const canonicalSourcePath = eventSourceByName[mirror.name]
		assert.ok(canonicalSourcePath, `No canonical event declaration is configured for delegate mirror ${mirror.name}`)
		assertMirroredEventSchema(await getSource(canonicalSourcePath), await getSource(mirror.sourcePath), mirror.name, canonicalSourcePath, mirror.sourcePath)
	}
	for (const emission of assemblyEventEmissions) {
		const canonicalSourcePath = eventSourceByName[emission.name]
		assert.ok(canonicalSourcePath, `No canonical event declaration is configured for assembly emission ${emission.name}`)
		assertEventDeclaration(await getSource(canonicalSourcePath), { name: emission.name }, canonicalSourcePath)
		assertAssemblyEventEmission(await getSource(emission.sourcePath), emission, emission.sourcePath)
	}
	for (const delegateCall of assemblyDelegateCalls) {
		assertAssemblyDelegateCall(await getSource(delegateCall.sourcePath), await getSource(delegateCall.targetSourcePath), delegateCall)
	}
	for (const contractReference of contractReferences) {
		const readDeclarations: string[] = []
		for (const declaration of contractReference.readDeclarations) {
			const declarationSourcePath = declaration.sourcePath ?? contractReference.sourcePath
			readDeclarations.push(...assertReadDeclaration(await getSource(declarationSourcePath), declaration, declarationSourcePath))
			assert.ok(new RegExp(`\\\`${declaration.name}(?:\\\`|\\()`).test(contractReference.readSurface), `${contractReference.name} read surface must name validated getter ${declaration.name}`)
			addNameBySource(representedReadNamesBySource, declarationSourcePath, declaration.name)
		}
		for (const declaration of contractReference.readStorageDeclarations ?? []) {
			const declarationSourcePath = declaration.sourcePath ?? contractReference.sourcePath
			readDeclarations.push(assertPublicStorageDeclaration(await getSource(declarationSourcePath), declaration.name, declarationSourcePath))
			assert.ok(new RegExp(`\\\`${declaration.name}\\\``).test(contractReference.readSurface), `${contractReference.name} read surface must name validated storage getter ${declaration.name}`)
			addNameBySource(representedStorageNamesBySource, declarationSourcePath, declaration.name)
		}
		const readAbiFingerprint = computeReadAbiFingerprint(readDeclarations)
		assert.equal(readAbiFingerprint, contractReference.readAbiFingerprint, `${contractReference.name} read ABI changed; review the read surface and update its pinned fingerprint`)
		readAbiFingerprintByContract.set(contractReference.name, readAbiFingerprint)
		for (const interaction of contractReference.interactions) {
			assert.equal(interaction.declarations.length, 1, `${contractReference.name} interaction rows must describe exactly one entrypoint name; split materially different guards, effects, and signals into separate rows`)
			for (const declaration of interaction.declarations) {
				const declarationSourcePath = declaration.sourcePath ?? contractReference.sourcePath
				const source = await getSource(declarationSourcePath)
				const configuredSourceSignatures = entrypointSignaturesBySource[declarationSourcePath]
				assert.ok(configuredSourceSignatures, `No entrypoint signature metadata exists for ${declarationSourcePath}`)
				const expectedSignatures = configuredSourceSignatures[declaration.name]
				assert.ok(expectedSignatures, `No entrypoint signatures are configured for ${declarationSourcePath}#${declaration.name}`)
				assertEntrypointSignatures(source, declaration, expectedSignatures, declarationSourcePath)
				assert.ok(new RegExp(`\\\`${declaration.name}(?:\\\`|\\()`).test(interaction.call), `${contractReference.name} interaction call must name validated entrypoint ${declaration.name}`)
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
	for (const [sourcePath, representedNames] of representedReadNamesBySource) {
		const excludedNames = new Set(readDeclarationExclusionsBySource[sourcePath] ?? [])
		const actualNames = getPublicReadDeclarationNames(await getSource(sourcePath)).filter(name => !excludedNames.has(name))
		assert.deepEqual(actualNames, Array.from(representedNames).sort(), `${sourcePath} public read functions must exactly match the documented read surface`)
	}
	for (const [sourcePath, representedNames] of representedStorageNamesBySource) {
		assert.deepEqual(getPublicStorageDeclarationNames(await getSource(sourcePath)), Array.from(representedNames).sort(), `${sourcePath} public storage getters must exactly match the documented read surface`)
	}
	const configuredEntrypointKeys = Object.entries(entrypointSignaturesBySource).flatMap(([sourcePath, signaturesByName]) => Object.keys(signaturesByName).map(name => `${sourcePath}#${name}`))
	assert.deepEqual(Array.from(representedEntrypointKeys).sort(), configuredEntrypointKeys.sort(), 'Entrypoint signature metadata must exactly match the declarations represented by interaction rows')
	assert.deepEqual(Array.from(referencedEventNames).sort(), Object.keys(eventSourceByName).sort(), 'Event source metadata must exactly match the events named in interaction signals')
	const referencedEventDeclarations: string[] = []
	for (const [eventName, sourcePath] of Object.entries(eventSourceByName)) {
		referencedEventDeclarations.push(assertEventDeclaration(await getSource(sourcePath), { name: eventName }, sourcePath))
	}
	const actualEventAbiFingerprint = computeEventAbiFingerprint(referencedEventDeclarations)
	assert.equal(actualEventAbiFingerprint, referencedEventAbiFingerprint, 'A referenced event ABI changed; review event semantics and update the pinned fingerprint')

	const sections = contractReferences.map(contractReference => {
		const sourceLink = `../../${contractReference.sourcePath}`
		const rows = contractReference.interactions
			.map(
				interaction => `<tr>
	<td>${renderRichText(interaction.call)}</td>
	<td>${renderRichText(interaction.caller)}</td>
	<td>${renderRichText(interaction.preconditions)}</td>
	<td>${renderRichText(interaction.effect)}</td>
	<td>${renderRichText(interaction.signals)}</td>
</tr>`,
			)
			.join('\n')
		const readAbiFingerprint = readAbiFingerprintByContract.get(contractReference.name)
		assert.ok(readAbiFingerprint, `Missing read ABI fingerprint for ${contractReference.name}`)
		const compiledAbiFingerprint = compiledAbiFingerprintByContract.get(contractReference.name)
		assert.ok(compiledAbiFingerprint, `Missing compiled ABI fingerprint for ${contractReference.name}`)
		const securityBoundaryHeading = contractReference.securityBoundaryHeading === undefined ? '' : `<h3 id="${headingId(contractReference.securityBoundaryHeading)}">${escapeHtml(contractReference.securityBoundaryHeading)}</h3>`
		const securityBoundary = contractReference.securityBoundary === undefined ? '' : `<p>${renderRichText(contractReference.securityBoundary)}</p>`
		return `<h2 id="${headingId(contractReference.name)}">${escapeHtml(contractReference.name)}</h2>
	<p>${renderRichText(contractReference.purpose)} <a href="${escapeHtml(sourceLink)}">Source</a></p>
	<p>Read surface: ${renderRichText(contractReference.readSurface)}</p>
	${securityBoundaryHeading}
	${securityBoundary}
	<!-- Validated read ABI fingerprint: ${readAbiFingerprint} -->
	<!-- Validated complete compiled ABI fingerprint: ${compiledAbiFingerprint} -->
	<table>
		<thead>
			<tr>
				<th>Transaction</th>
				<th>Caller</th>
				<th>Main prerequisites</th>
				<th>State or asset effect</th>
				<th>Primary signals</th>
			</tr>
		</thead>
		<tbody>
${rows}
		</tbody>
	</table>`
	})

	const quickIndex = contractReferences.map(contractReference => `<li><a href="#${headingId(contractReference.name)}">${escapeHtml(contractReference.name)}</a></li>`).join('')
	return `<!-- Generated by scripts/generate-contract-interaction-reference.mts. Do not edit directly. -->
	<header>
		<h1>Contract interactions</h1>
					<p class="lede">For developers and operators: find the contract that handles each state change, who can call it, and what the call does.</p>
		<nav aria-label="Contract quick index"><strong>Quick index</strong><ul>${quickIndex}</ul></nav>
	</header>
	${sections.join('\n')}`
}

function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function renderRichText(value: string): string {
	let output = ''
	let offset = 0
	for (const match of value.matchAll(/`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g)) {
		const index = match.index
		output += escapeHtml(value.slice(offset, index))
		const code = match[1]
		const label = match[2]
		const href = match[3]
		if (code !== undefined) output += `<code>${escapeHtml(code)}</code>`
		else {
			assert(label !== undefined && href !== undefined, 'rich-text link must provide a label and destination')
			output += `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
		}
		offset = index + match[0].length
	}
	return output + escapeHtml(value.slice(offset))
}

function headingId(value: string): string {
	return value
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '')
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

function assertReadDeclaration(source: string, declaration: ContractDeclaration, sourceLabel: string): string[] {
	assert.notEqual(declaration.kind, 'receive', `${sourceLabel} receive cannot be documented as a read`)
	const declarationPattern = new RegExp(`^\\s*function\\s+${declaration.name}\\s*\\(([\\s\\S]*?)\\)\\s*([^;{]*)[;{]`, 'gm')
	const declarations = Array.from(source.matchAll(declarationPattern)).filter(match => /\b(?:external|public)\b/.test(match[2] ?? ''))
	assert.ok(declarations.length > 0, `${sourceLabel} no longer declares public read ${declaration.name}; update the interaction reference`)
	return declarations.map(match => {
		const suffix = (match[2] ?? '').replace(/\s+/g, ' ').trim()
		assert.match(suffix, /\b(?:view|pure)\b/, `${sourceLabel} ${declaration.name} is no longer view or pure; move it to an interaction row`)
		return `function ${declaration.name}(${(match[1] ?? '').replace(/\s+/g, ' ').trim()}) ${suffix}`
	})
}

function assertPublicStorageDeclaration(source: string, storageName: string, sourceLabel: string): string {
	const declarationPattern = new RegExp(`^\\s*([^;{}]*\\bpublic(?:\\s+(?:constant|immutable|override))*\\s+${storageName}(?:\\s*=\\s*[^;]+)?);`, 'm')
	const match = source.match(declarationPattern)
	assert.ok(match, `${sourceLabel} no longer declares public storage getter ${storageName}; update the interaction reference`)
	return (match[1] ?? '').replace(/\s+/g, ' ').trim()
}

function getFunctionDeclarations(source: string, name: string): Array<{ parameterTypes: string[]; payable: boolean; visibility: string }> {
	const declarationPattern = new RegExp(`^\\s*function\\s+${name}\\s*\\(([\\s\\S]*?)\\)\\s*(external|public|internal|private)\\b([^;{]*)[;{]`, 'gm')
	return Array.from(source.matchAll(declarationPattern), match => ({
		parameterTypes: parseParameterTypes(match[1] ?? ''),
		payable: /\bpayable\b/.test(match[3] ?? ''),
		visibility: match[2] ?? '',
	}))
}

function getPublicStateChangingDeclarationNames(source: string): string[] {
	return Array.from(
		new Set(
			getPublicStateChangingDeclarations(source).map(declaration => {
				const match = declaration.match(/^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/)
				const name = match?.[1]
				if (name === undefined) throw new Error(`Expected a function name in ${declaration}`)
				return name
			}),
		),
	).sort()
}

function getPublicStateChangingDeclarations(source: string): string[] {
	const declarations = Array.from(source.matchAll(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*([^;{]*)[;{]/gm))
		.filter(match => /\b(?:external|public)\b/.test(match[3] ?? '') && !/\b(?:pure|view)\b/.test(match[3] ?? ''))
		.map(match => {
			const name = match[1]
			if (name === undefined) throw new Error('Expected a Solidity function-name capture')
			return `function ${name}(${normalizeSolidityParameters(match[2] ?? '')}) ${(match[3] ?? '').replace(/\s+/g, ' ').trim()}`
		})
	const receiveDeclarations = Array.from(source.matchAll(/^\s*receive\s*\(\s*\)\s*([^;{]*)[;{]/gm))
		.filter(match => /\b(?:external|public)\b/.test(match[1] ?? ''))
		.map(match => `receive() ${(match[1] ?? '').replace(/\s+/g, ' ').trim()}`)
	return [...declarations, ...receiveDeclarations].sort()
}

function getPublicReadDeclarationNames(source: string): string[] {
	return Array.from(
		new Set(
			Array.from(source.matchAll(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([\s\S]*?\)\s*([^;{]*)[;{]/gm))
				.filter(match => /\b(?:external|public)\b/.test(match[2] ?? '') && /\b(?:pure|view)\b/.test(match[2] ?? ''))
				.map(match => {
					const name = match[1]
					if (name === undefined) throw new Error('Expected a Solidity read-function-name capture')
					return name
				}),
		),
	).sort()
}

function getPublicStorageDeclarationNames(source: string): string[] {
	return Array.from(
		new Set(
			Array.from(source.matchAll(/^\s*(?:mapping\s*\([^;]+\)|[A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]*\])*)\s+public(?:\s+(?:constant|immutable|override))*\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)).map(match => {
				const name = match[1]
				if (name === undefined) throw new Error('Expected a Solidity public-storage-name capture')
				return name
			}),
		),
	).sort()
}

function addNameBySource(namesBySource: Map<string, Set<string>>, sourcePath: string, name: string): void {
	const names = namesBySource.get(sourcePath) ?? new Set<string>()
	names.add(name)
	namesBySource.set(sourcePath, names)
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

function assertEventDeclaration(source: string, event: ContractDeclaration, sourceLabel: string): string {
	const eventPattern = new RegExp(`^\\s*event\\s+${event.name}\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'gm')
	const matches = Array.from(source.matchAll(eventPattern))
	assert.equal(matches.length, 1, `${sourceLabel} must declare exactly one event ${event.name}; update the interaction reference`)
	return `event ${event.name}(${normalizeSolidityParameters(matches[0]?.[1] ?? '')})`
}

function assertEventSchema(source: string, event: { name: string; parameters: string }, sourceLabel: string): void {
	const eventPattern = new RegExp(`^\\s*event\\s+${event.name}\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'm')
	const match = source.match(eventPattern)
	assert.ok(match, `${sourceLabel} no longer declares event ${event.name}; update the event reference`)
	assert.equal(normalizeSolidityParameters(match[1] ?? ''), event.parameters, `${sourceLabel} event schema for ${event.name} changed; update the event reference`)
}

function assertMirroredEventSchema(canonicalSource: string, mirrorSource: string, eventName: string, canonicalSourceLabel: string, mirrorSourceLabel: string): void {
	const canonicalDeclaration = assertEventDeclaration(canonicalSource, { name: eventName }, canonicalSourceLabel)
	const mirrorDeclaration = assertEventDeclaration(mirrorSource, { name: eventName }, mirrorSourceLabel)
	assert.equal(mirrorDeclaration, canonicalDeclaration, `${mirrorSourceLabel} delegate-emitted ${eventName} schema must match ${canonicalSourceLabel}`)
}

function assertAssemblyEventEmission(source: string, emission: { dataArguments: string; indexedArguments: string; name: string; signature: string; signatureConstant: string }, sourceLabel: string): void {
	const compactSource = source.replace(/\s+/g, '')
	assert.ok(compactSource.includes(`bytes32privateconstant${emission.signatureConstant}=keccak256('${emission.signature}');`), `${sourceLabel} assembly event signature for ${emission.name} changed`)
	assert.ok(compactSource.includes(`bytesmemoryeventData=abi.encode(${emission.dataArguments.replace(/\s+/g, '')});`), `${sourceLabel} assembly event data for ${emission.name} changed`)
	const indexedArguments = emission.indexedArguments === '' ? '' : `,${emission.indexedArguments.replace(/\s+/g, '')}`
	const topicCount = emission.indexedArguments === '' ? 1 : emission.indexedArguments.split(',').length + 1
	assert.ok(compactSource.includes(`log${topicCount}(add(eventData,0x20),mload(eventData),eventSignature${indexedArguments})`), `${sourceLabel} assembly event topics for ${emission.name} changed`)
}

function assertAssemblyDelegateCall(source: string, targetSource: string, delegateCall: AssemblyDelegateCall): void {
	assertEntrypointSignatures(targetSource, { name: delegateCall.targetFunctionName }, [delegateCall.targetEntrypointSignature], delegateCall.targetSourcePath)
	const targetDeclarations = getFunctionDeclarations(targetSource, delegateCall.targetFunctionName).filter(declaration => declaration.visibility === 'external' || declaration.visibility === 'public')
	assert.equal(targetDeclarations.length, 1, `${delegateCall.targetSourcePath} must declare exactly one public ${delegateCall.targetFunctionName} target`)
	assert.equal(targetDeclarations[0]?.payable, true, `${delegateCall.targetSourcePath} ${delegateCall.targetFunctionName} must remain payable for value-bearing delegatecall flows`)
	assert.equal(keccak256(delegateCall.abiSignature).slice(0, 10), delegateCall.selector, `${delegateCall.targetSourcePath} ABI selector for ${delegateCall.targetFunctionName} changed`)
	const compactSource = source.replace(/\s+/g, '')
	assert.ok(compactSource.includes(`mstore(pointer,shl(224,${delegateCall.selector}))`), `${delegateCall.sourcePath} hard-coded selector for ${delegateCall.targetFunctionName} changed`)
	for (const { argument, offset } of delegateCall.argumentOffsets) {
		assert.ok(compactSource.includes(`mstore(add(pointer,${offset}),${argument})`), `${delegateCall.sourcePath} calldata argument ${argument} for ${delegateCall.targetFunctionName} changed`)
	}
	assert.ok(compactSource.includes(`delegatecall(gas(),eventEmitter,pointer,${delegateCall.calldataLength},0,0)`), `${delegateCall.sourcePath} calldata length or target for ${delegateCall.targetFunctionName} changed`)
}

function normalizeSolidityParameters(parameters: string): string {
	return parameters
		.replace(/\s+/g, ' ')
		.replace(/\s*,\s*/g, ',')
		.trim()
}

function computeReadAbiFingerprint(declarations: string[]): string {
	return createHash('sha256')
		.update([...declarations].sort().join('\n'))
		.digest('hex')
}

function computeStateChangingAbiFingerprint(declarations: string[]): string {
	return createHash('sha256')
		.update([...declarations].sort().join('\n'))
		.digest('hex')
}

async function getProductionSoliditySourceFingerprint(): Promise<string> {
	const sourcePaths = (await listSoliditySourcePaths('solidity/contracts')).filter(sourcePath => !sourcePath.startsWith('solidity/contracts/test/'))
	const sources = await Promise.all(sourcePaths.map(async sourcePath => ({ source: await readFile(sourcePath, 'utf8'), sourcePath })))
	return computeSourceContentFingerprint(sources)
}

async function listSoliditySourcePaths(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	const paths = await Promise.all(
		entries.map(entry => {
			const path = `${directory}/${entry.name}`
			if (entry.isDirectory()) return listSoliditySourcePaths(path)
			return Promise.resolve(path.endsWith('.sol') ? [path] : [])
		}),
	)
	return paths.flat().sort()
}

function computeSourceContentFingerprint(sources: Array<{ source: string; sourcePath: string }>): string {
	const hash = createHash('sha256')
	for (const { source, sourcePath } of [...sources].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))) {
		hash.update(sourcePath)
		hash.update('\0')
		hash.update(source.replaceAll('\r\n', '\n'))
		hash.update('\0')
	}
	return hash.digest('hex')
}

function computeEventAbiFingerprint(declarations: string[]): string {
	return createHash('sha256')
		.update([...declarations].sort().join('\n'))
		.digest('hex')
}

function getCompiledContractAbi(compiledArtifacts: unknown, sourcePath: string, contractName: string): unknown[] {
	assert.ok(isRecord(compiledArtifacts), 'solidity/artifacts/Contracts.json must contain an object')
	const contracts = compiledArtifacts['contracts']
	assert.ok(isRecord(contracts), 'solidity/artifacts/Contracts.json must contain contract outputs')
	const artifactSourcePath = sourcePath.replace(/^solidity\//, '')
	const sourceContracts = contracts[artifactSourcePath]
	assert.ok(isRecord(sourceContracts), `Compiled artifacts are missing ${artifactSourcePath}`)
	const contract = sourceContracts[contractName]
	assert.ok(isRecord(contract), `Compiled artifacts are missing ${artifactSourcePath}#${contractName}`)
	const abi = contract['abi']
	assert.ok(Array.isArray(abi), `Compiled artifact ${artifactSourcePath}#${contractName} is missing its ABI`)
	return abi
}

function computeCompiledAbiFingerprint(abi: unknown[]): string {
	return createHash('sha256')
		.update(
			abi
				.map(entry => canonicalizeJson(entry))
				.sort()
				.join('\n'),
		)
		.digest('hex')
}

function canonicalizeJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(item => canonicalizeJson(item)).join(',')}]`
	assert.ok(isRecord(value), 'Compiled ABI contains an unsupported JSON value')
	return `{${Object.keys(value)
		.sort()
		.map(key => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
		.join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
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
	assert.deepEqual(assertReadDeclaration('function available(uint256 key) external view returns (address account) {}', { name: 'available' }, 'read fixture'), ['function available(uint256 key) external view returns (address account)'])
	assert.throws(() => assertReadDeclaration('function hidden() internal view {}', { name: 'hidden' }, 'read fixture'), /read fixture no longer declares public read hidden/)
	assert.throws(() => assertReadDeclaration('function changed() external returns (uint256) {}', { name: 'changed' }, 'read mutability fixture'), /changed is no longer view or pure/)
	assert.notDeepEqual(assertReadDeclaration('function available(address key) external view returns (address account) {}', { name: 'available' }, 'read parameter fixture'), ['function available(uint256 key) external view returns (address account)'])
	assert.notDeepEqual(assertReadDeclaration('function available(uint256 key) external view returns (uint256 value) {}', { name: 'available' }, 'read return fixture'), ['function available(uint256 key) external view returns (address account)'])
	assert.notEqual(computeReadAbiFingerprint(['function available(uint256 key) external view returns (uint256 value)']), computeReadAbiFingerprint(['function available(uint256 key) external view returns (address account)']))
	assert.throws(() => assertPublicStorageDeclaration('uint256 internal removed;', 'removed', 'storage fixture'), /no longer declares public storage getter removed/)
	assert.deepEqual(getPublicReadDeclarationNames('function inspect() public view returns (uint256) { return 1; }\nfunction calculate() external pure returns (uint256) { return 2; }\nfunction mutate() external {}'), ['calculate', 'inspect'])
	assert.deepEqual(getPublicStorageDeclarationNames('uint256 public immutable count;\nmapping(address => uint256) public balances;\nuint256 private hidden;'), ['balances', 'count'])
	assert.doesNotThrow(() => assertEventSchema('event Exact(address indexed account, uint256 value);', { name: 'Exact', parameters: 'address indexed account,uint256 value' }, 'event schema fixture'))
	assert.throws(() => assertEventSchema('event Changed(address account, uint256 value);', { name: 'Changed', parameters: 'address indexed account,uint256 value' }, 'event indexing fixture'), /event schema for Changed changed/)
	const checkpointEvent = assertEventDeclaration('event PoolAccountingCheckpoint(address indexed vault, uint256 value);', { name: 'PoolAccountingCheckpoint' }, 'checkpoint fixture')
	const checkpointIndexingDrift = assertEventDeclaration('event PoolAccountingCheckpoint(address vault, uint256 value);', { name: 'PoolAccountingCheckpoint' }, 'checkpoint indexing fixture')
	const checkpointOrderDrift = assertEventDeclaration('event PoolAccountingCheckpoint(uint256 value, address indexed vault);', { name: 'PoolAccountingCheckpoint' }, 'checkpoint order fixture')
	const auctionEvent = assertEventDeclaration('event AuctionFinalized(int256 indexed clearingTick, uint256 grossEthAccepted);', { name: 'AuctionFinalized' }, 'auction fixture')
	const auctionTypeDrift = assertEventDeclaration('event AuctionFinalized(uint256 indexed clearingTick, uint256 grossEthAccepted);', { name: 'AuctionFinalized' }, 'auction type fixture')
	assert.notEqual(computeEventAbiFingerprint([checkpointEvent]), computeEventAbiFingerprint([checkpointIndexingDrift]))
	assert.notEqual(computeEventAbiFingerprint([checkpointEvent]), computeEventAbiFingerprint([checkpointOrderDrift]))
	assert.notEqual(computeEventAbiFingerprint([auctionEvent]), computeEventAbiFingerprint([auctionTypeDrift]))
	const compiledAbiFixture = [{ inputs: [], name: 'inspect', outputs: [{ components: [{ name: 'amount', type: 'uint256' }], name: 'record', type: 'tuple' }], stateMutability: 'view', type: 'function' }]
	assert.notEqual(computeCompiledAbiFingerprint(compiledAbiFixture), computeCompiledAbiFingerprint([...compiledAbiFixture, { anonymous: false, inputs: [], name: 'InheritedEvent', type: 'event' }]))
	assert.notEqual(
		computeCompiledAbiFingerprint(compiledAbiFixture),
		computeCompiledAbiFingerprint([
			{
				inputs: [],
				name: 'inspect',
				outputs: [
					{
						components: [
							{ name: 'account', type: 'address' },
							{ name: 'amount', type: 'uint256' },
						],
						name: 'record',
						type: 'tuple',
					},
				],
				stateMutability: 'view',
				type: 'function',
			},
		]),
	)
	assert.throws(
		() => assertMirroredEventSchema('event PoolAccountingCheckpoint(address indexed vault);', 'event PoolAccountingCheckpoint(address vault);', 'PoolAccountingCheckpoint', 'interface fixture', 'delegate fixture'),
		/delegate fixture delegate-emitted PoolAccountingCheckpoint schema must match interface fixture/,
	)
	const assemblyEventFixture = `
		bytes32 private constant CHECKPOINT_SIGNATURE = keccak256(
			'Checkpoint(address,uint256)'
		);
		bytes memory eventData = abi.encode(value);
		bytes32 eventSignature = CHECKPOINT_SIGNATURE;
		assembly ('memory-safe') {
			log2(add(eventData, 0x20), mload(eventData), eventSignature, account)
		}
	`
	const assemblyEventMetadata = {
		dataArguments: 'value',
		indexedArguments: 'account',
		name: 'Checkpoint',
		signature: 'Checkpoint(address,uint256)',
		signatureConstant: 'CHECKPOINT_SIGNATURE',
	}
	assert.doesNotThrow(() => assertAssemblyEventEmission(assemblyEventFixture, assemblyEventMetadata, 'assembly fixture'))
	assert.throws(() => assertAssemblyEventEmission(assemblyEventFixture.replace('Checkpoint(address,uint256)', 'Checkpoint(uint256,address)'), assemblyEventMetadata, 'assembly signature fixture'), /assembly event signature for Checkpoint changed/)
	assert.throws(() => assertAssemblyEventEmission(assemblyEventFixture.replace('abi.encode(value)', 'abi.encode(otherValue)'), assemblyEventMetadata, 'assembly data fixture'), /assembly event data for Checkpoint changed/)
	assert.throws(() => assertAssemblyEventEmission(assemblyEventFixture.replace('eventSignature, account', 'eventSignature, otherAccount'), assemblyEventMetadata, 'assembly topic fixture'), /assembly event topics for Checkpoint changed/)
	const assemblyDelegateCallFixture = `
		function emitForkSnapshotEvents(
			ISecurityPool parent,
			address migrationProxy,
			address sourceGame,
			uint256 totalPoolHeldRepAtForkAttoRep,
			uint256 disputeStakedRepAtForkAttoRep,
			uint256 resultingLockedAttoRep
		) external payable {}
		assembly ('memory-safe') {
			let pointer := mload(0x40)
			mstore(pointer, shl(224, 0x408d33da))
			mstore(add(pointer, 0x04), parent)
			mstore(add(pointer, 0x24), migrationProxy)
			mstore(add(pointer, 0x44), sourceGame)
			mstore(add(pointer, 0x64), totalPoolHeldRepAtForkAttoRep)
			mstore(add(pointer, 0x84), disputeStakedRepAtForkAttoRep)
			mstore(add(pointer, 0xa4), resultingLockedAttoRep)
			delegatecall(gas(), eventEmitter, pointer, 0xc4, 0, 0)
		}
	`
	const assemblyDelegateCallMetadata = assemblyDelegateCalls[0]
	if (assemblyDelegateCallMetadata === undefined) throw new Error('Expected assembly delegate-call metadata')
	assert.doesNotThrow(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture, assemblyDelegateCallFixture, assemblyDelegateCallMetadata))
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture.replace('0x408d33da', '0x408d33db'), assemblyDelegateCallFixture, assemblyDelegateCallMetadata), /hard-coded selector for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture.replace('0xa4), resultingLockedAttoRep', '0xa4), otherRep'), assemblyDelegateCallFixture, assemblyDelegateCallMetadata), /calldata argument resultingLockedAttoRep for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture.replace('pointer, 0xc4', 'pointer, 0xa4'), assemblyDelegateCallFixture, assemblyDelegateCallMetadata), /calldata length or target for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture, assemblyDelegateCallFixture.replace('uint256 resultingLockedAttoRep', 'address resultingLockedAttoRep'), assemblyDelegateCallMetadata), /entrypoint signatures for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture, assemblyDelegateCallFixture.replace('external payable', 'external'), assemblyDelegateCallMetadata), /emitForkSnapshotEvents must remain payable/)
	assert.deepEqual(getPublicStateChangingDeclarationNames('function mutate(uint256 value) external returns (uint256) { return value; }\nfunction inspect() public view returns (uint256) { return 1; }\nreceive() external payable {}'), ['mutate', 'receive'])
	assert.notEqual(computeStateChangingAbiFingerprint(getPublicStateChangingDeclarations('function mutate() external payable {}')), computeStateChangingAbiFingerprint(getPublicStateChangingDeclarations('function mutate() external {}')))
	assert.notEqual(computeStateChangingAbiFingerprint(getPublicStateChangingDeclarations('function mutate() external returns (uint256) {}')), computeStateChangingAbiFingerprint(getPublicStateChangingDeclarations('function mutate() external returns (address) {}')))
	assert.notEqual(computeSourceContentFingerprint([{ sourcePath: 'Fixture.sol', source: 'function mutate(uint256 value) external { require(value > 0); }' }]), computeSourceContentFingerprint([{ sourcePath: 'Fixture.sol', source: 'function mutate(uint256 value) external { require(value > 1); }' }]))
	assert.notEqual(
		computeSourceContentFingerprint([{ sourcePath: 'Fixture.sol', source: 'function mutate() external {}' }]),
		computeSourceContentFingerprint([
			{ sourcePath: 'Fixture.sol', source: 'function mutate() external {}' },
			{ sourcePath: 'NewSupport.sol', source: 'library NewSupport {}' },
		]),
	)
	assert.deepEqual(getPublicStateChangingDeclarations('abstract contract Empty {}'), [])
	assert.notDeepEqual(getPublicStateChangingDeclarations('abstract contract Empty {\nfunction added() external {}\n}'), [])
	assert.throws(() => assertEventDeclaration('function SystemStateSet() external {}', { name: 'SystemStateSet' }, 'event fixture'), /event fixture must declare exactly one event SystemStateSet/)
	assert.throws(() => assertEventDeclaration('event UniverseForked(uint256 value);', { name: 'DeployChild' }, 'intended event source'), /intended event source must declare exactly one event DeployChild/)
}
