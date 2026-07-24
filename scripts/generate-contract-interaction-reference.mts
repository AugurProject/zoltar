import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { keccak256 } from '../shared/ts/ethereum'
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

const outputPath = 'docs/contract-interaction-reference.md'
const expectedProductionSoliditySourceFingerprint = 'cde16e42c8cae575d597e85c5cf03ddae501ffc060f015d9c2fb3130d162a4fd'

const eventSourceByName: Record<string, string> = {
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
	ChildEscalationRepMaterialized: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	ChildPoolLinked: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	ChildPoolRepSwept: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	ChildRepSplit: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	ClaimAuctionProceeds: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	ClaimDeposit: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ClaimForkedEscalationDepositsToWallet: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	CompleteSetCreated: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	CompleteSetRedeemed: 'solidity/contracts/peripherals/interfaces/ISecurityPool.sol',
	CoordinatorStateCheckpoint: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	DeployChild: 'solidity/contracts/Zoltar.sol',
	DeploySecurityPool: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
	DepositOnOutcome: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	DepositRep: 'solidity/contracts/peripherals/SecurityPool.sol',
	DepositToEscalationGame: 'solidity/contracts/peripherals/SecurityPool.sol',
	EscalationGameSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	EscalationMigrationEntitlementInitialized: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	EscalationMigrationEntitlementMaterialized: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	EscalationRepDrainedAtFork: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	ExecutedStagedOperation: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ForkContinuationResumed: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ForkCarryCheckpoint: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	ForkedEscrowExported: 'solidity/contracts/peripherals/EscalationGameState.sol',
	ForkedEscrowRecorded: 'solidity/contracts/peripherals/EscalationGameState.sol',
	GameContinuedFromFork: 'solidity/contracts/peripherals/EscalationGameState.sol',
	GameStarted: 'solidity/contracts/peripherals/EscalationGameState.sol',
	InheritedThresholdTie: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	LocalDepositAppended: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	Migrate: 'solidity/contracts/peripherals/tokens/ShareToken.sol',
	VaultMigrationCheckpoint: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	MigrationRepAdded: 'solidity/contracts/Zoltar.sol',
	MigrationRepSplit: 'solidity/contracts/Zoltar.sol',
	Mint: 'solidity/contracts/ReputationToken.sol',
	NonDecisionReached: 'solidity/contracts/peripherals/interfaces/IEscalationGame.sol',
	OwnershipDenominatorSet: 'solidity/contracts/peripherals/SecurityPool.sol',
	PendingOperationRecoveryConsumed: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PendingReportRecovered: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	ParentRepLocked: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	PerformWithdrawRep: 'solidity/contracts/peripherals/SecurityPool.sol',
	PoolForkModeActivated: 'solidity/contracts/peripherals/SecurityPool.sol',
	PriceReportRejected: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PriceReported: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	PriceRequested: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
	QuestionCreated: 'solidity/contracts/ZoltarQuestionData.sol',
	RedeemRep: 'solidity/contracts/peripherals/SecurityPool.sol',
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
		parameters: 'uint248 indexed universeId,uint256 forkTime,uint256 forkQuestionId,uint256 forkingOutcomeIndex,ReputationToken reputationToken,uint248 indexed parentUniverseId,uint256 universeTheoreticalSupply',
		sourcePath: 'solidity/contracts/Zoltar.sol',
	},
	{
		name: 'DeployChild',
		parameters: 'address deployer,uint248 indexed universeId,uint256 indexed outcomeIndex,uint248 indexed childUniverseId,ReputationToken childReputationToken,uint256 childUniverseTheoreticalSupply',
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
			'ISecurityPool indexed securityPool,UniformPriceDualCapBatchAuction truthAuction,OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,IShareToken shareToken,ISecurityPool indexed parent,uint248 indexed universeId,uint256 questionId,uint256 securityMultiplier,uint256 currentRetentionRate,uint256 completeSetCollateralAmount',
		sourcePath: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
	},
	{
		name: 'ChildPoolLinked',
		parameters: 'ISecurityPool indexed parent,uint256 indexed outcomeIndex,ISecurityPool indexed child,UniformPriceDualCapBatchAuction truthAuction',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	},
	{
		name: 'ChildRepSplit',
		parameters: 'ISecurityPool indexed parent,uint256 indexed outcomeIndex,uint256 childPoolRepSplit,uint256 pendingChildRep',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
	},
	{
		name: 'ChildEscalationRepMaterialized',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,address indexed childGame,uint256 outcomeIndex,uint256 repAmount,uint256 resultingEscalationRepBalance',
		sourcePath: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'ChildPoolRepSwept',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,uint256 indexed outcomeIndex,uint256 repAmount,uint256 resultingChildPoolRepBalance',
		sourcePath: 'solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'EscalationMigrationEntitlementInitialized',
		parameters: 'ISecurityPool indexed parent,address indexed vault,uint256[3] sourcePrincipalByOutcome,uint256[3] currentRepByOutcome,uint256 totalCurrentRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	},
	{
		name: 'EscalationMigrationEntitlementMaterialized',
		parameters: 'ISecurityPool indexed parent,address indexed vault,uint256 indexed childOutcomeIndex,ISecurityPool child,uint256 childRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameForker.sol',
	},
	{ name: 'TheoreticalSupplySet', parameters: 'uint256 totalTheoreticalSupply', sourcePath: 'solidity/contracts/ReputationToken.sol' },
	{ name: 'Mint', parameters: 'address indexed account,uint256 value', sourcePath: 'solidity/contracts/ReputationToken.sol' },
	{
		name: 'Burn',
		parameters: 'address indexed account,uint256 value,uint256 totalTheoreticalSupply',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
	{
		name: 'AwaitingForkContinuationSet',
		parameters: 'bool awaitingForkContinuation',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
	},
	{
		name: 'OwnershipDenominatorSet',
		parameters: 'uint256 poolOwnershipDenominator',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
	},
	{
		name: 'ShareTokenSupplySet',
		parameters: 'uint256 shareTokenSupply',
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
	},
	{ name: 'SystemStateSet', parameters: 'SystemState systemState', sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol' },
	{
		name: 'VaultEscrowUpdated',
		parameters: 'address indexed vault,uint256 escrowedRepByVault,uint256 totalEscrowedRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowRecorded',
		parameters: 'address indexed depositor,BinaryOutcomes.BinaryOutcome indexed outcome,uint256 sourcePrincipalTotal,uint256 childRepTotal,uint256 escrowedRepByVault,uint256 totalEscrowedRep,uint256 outcomeBalance',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'VaultUnresolvedTotalsExported',
		parameters: 'address indexed vault,address repReceiver,uint256[3] principalByOutcome,uint256 principalToTransfer,bool transferredRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowExported',
		parameters: 'address indexed vault,address repReceiver,uint256[3] sourcePrincipalByOutcome,uint256[3] childRepByOutcome,uint256 totalChildRepToTransfer,bool transferredRep',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowClaimed',
		parameters: 'address indexed depositor,BinaryOutcomes.BinaryOutcome indexed outcome,uint256 sourcePrincipalClaimed,uint256 childRepClaimed',
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
		dataArguments: 'carryRoots, nullifierRoots, leafCounts, unresolvedTotals, resolutionBalances',
		indexedArguments: 'sourceGame, snapshotId',
		name: 'ForkCarryCheckpoint',
		signature: 'ForkCarryCheckpoint(address,bytes32,bytes32[3],bytes32[3],uint256[3],uint256[3],uint256[3])',
		signatureConstant: 'FORK_CARRY_CHECKPOINT_SIGNATURE',
		sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol',
	},
	{
		dataArguments: 'BinaryOutcomes.BinaryOutcome(outcomeIndex), amount, reason, carryTotal, _getCurrentNullifierRoot(outcomeIndex), carryRoot',
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
			{ argument: 'poolRepAtFork', offset: '0x64' },
			{ argument: 'escalationRepAtFork', offset: '0x84' },
			{ argument: 'resultingLockedRep', offset: '0xa4' },
		],
		calldataLength: '0xc4',
		selector: '0x408d33da',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
		targetEntrypointSignature: 'external(ISecurityPool,address,address,uint256,uint256,uint256)',
		targetFunctionName: 'emitForkSnapshotEvents',
		targetSourcePath: 'solidity/contracts/peripherals/SecurityPoolEventEmitter.sol',
	},
]

const referencedEventAbiFingerprint = 'a2d09004dfe746b8f024675f4a617d5b2d8f9bb164515874854179cb2b36ea31'

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
		setMaxTheoreticalSupply: ['external(uint256)'],
	},
	'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol': {
		deployChildSecurityPool: ['external(ISecurityPool,IShareToken,uint248,uint256,uint256,uint256,uint256)'],
		deployOriginSecurityPool: ['external(uint248,uint256,uint256)'],
	},
	'solidity/contracts/peripherals/EscalationGame.sol': {
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
		openOracleCallback: ['external(uint256,uint256,uint256,uint256,address,address)'],
		recoverSettledPendingReport: ['public()'],
		requestPrice: ['public(uint256,uint256)'],
		requestPriceIfNeededAndStageOperation: ['public(OperationType,address,uint256,uint256,uint256,uint256)'],
		setRepEthPrice: ['public(uint256)'],
		setSecurityPool: ['public(ISecurityPool)'],
	},
	'solidity/contracts/peripherals/SecurityPool.sol': {
		activateForkMode: ['external()'],
		addFeeEligibleSecurityBondAllowance: ['external(address,uint256)'],
		authorizeChildPool: ['external(ISecurityPool)'],
		burnEscalationWinnerHaircut: ['external(uint256)'],
		configureVault: ['external(address,uint256,uint256,uint256)'],
		createCompleteSet: ['external()'],
		depositRep: ['external(uint256)'],
		depositToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[64][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
		initializeForkedEscalationGame: ['external(uint256,uint256,uint256,BinaryOutcomes.BinaryOutcome)'],
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
	'solidity/contracts/ReputationToken.sol': '0d2445ed40b55f81c68026363738ae2cd5290aa001b56e069cb31b73d321d3f0',
	'solidity/contracts/Zoltar.sol': '2c00ff05d4ec7476a23ee5a86e3934d28b59a039da7d634c4422435696508ae2',
	'solidity/contracts/ZoltarQuestionData.sol': '904b4369195f070fa3b04bbcbc1acba529810ffa2da4667569cd9168ac568d65',
	'solidity/contracts/peripherals/EscalationGame.sol': 'bd11ab4636cc26c0092a696a54516504701d0b11a893df7b702babdf57984f19',
	'solidity/contracts/peripherals/EscalationGameCalculations.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/EscalationGameCarry.sol': '7fd8be73b61c6624fb644d2b5818fa414e582e9ed4eea54eceee533f4a022d47',
	'solidity/contracts/peripherals/EscalationGameEscrow.sol': 'b3755415ee7ff2d0457653e9c9e6a6cca56435ed3b76008ab5446c315f837452',
	'solidity/contracts/peripherals/EscalationGameSettlement.sol': '60c97762c2d882dcb82dd15fa4059f1fc440c9829df809a7932429121a03d83f',
	'solidity/contracts/peripherals/EscalationGameState.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/EscalationGameStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol': 'd6e92001bdc028def593ed95c37a8c23bab0a9006d0a5c9164f9a9f92b84ad49',
	'solidity/contracts/peripherals/SecurityPool.sol': 'a78945a5ce200e814e22a3a6146e77c2f9fa959a1a98a592d23b581fa649467a',
	'solidity/contracts/peripherals/SecurityPoolForker.sol': '282c464a68623405a6241816a1c5fcef4b80e9db39e42e89d77177d8a4f10eae',
	'solidity/contracts/peripherals/SecurityPoolForkerBase.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/SecurityPoolForkerStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol': '2c1768ca6df9cc73f7cd8743eb1955f628d8452135ad20a6afa84266f87da6ff',
	'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol': '341a6e1b0e28f1ced56f751ca7fe41e52b1cc48535b3dbfa5c971f80c292ff6f',
	'solidity/contracts/peripherals/tokens/ERC1155.sol': '7bb87695bc3df8fa177c545209ed58d2e4571c19c869b5598bb0a829e764b218',
	'solidity/contracts/peripherals/tokens/ShareToken.sol': '45fffaf3a3150648f3f43a9129d2a5af0ddc4e261de52a6ad379fa804e44672d',
}

const readDeclarationExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol': ['finalizedGame'],
	'solidity/contracts/peripherals/SecurityPool.sol': ['eventEmitter', 'factory'],
}

assertDeclarationCheckerRegression()
await ensureContractArtifactsAreCurrent()
const productionSoliditySourceFingerprint = await getProductionSoliditySourceFingerprint()
assert.equal(productionSoliditySourceFingerprint, expectedProductionSoliditySourceFingerprint, 'Production Solidity source changed; re-audit every affected contract behavior against the documentation, then update the pinned source fingerprint')

const contractReferences: ContractReference[] = [
	{
		compiledAbiFingerprint: '5158fa721a2d0c38a3c04c8e2b0e4060904c33dfe65122f20028f13db2fdf4f7',
		name: 'ZoltarQuestionData',
		purpose: 'Creates immutable, content-addressed scalar or categorical questions and exposes their display metadata.',
		readAbiFingerprint: '5359875c236b41ea3d1b7af175b02ce8c7f00b5d5bf655869b7103ce363168df',
		readSurface:
			'Use `getQuestionId` before submission; `questionCreatedTimestamp`, `questions`, and `outcomeLabels` for direct lookup; `questionIds`, `getQuestionCount`, and `getQuestions` for indexed or paged discovery; and `getQuestionEndDate`, `getOutcomeLabels`, `splitUint256IntoTwoWithInvalid`, `hasNonZeroScalarReservedBits`, `isMalformedAnswerOption`, and `getAnswerOptionName` when validating or displaying answers.',
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
		readStorageDeclarations: [{ name: 'questionCreatedTimestamp' }, { name: 'questions' }, { name: 'outcomeLabels' }, { name: 'questionIds' }],
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
		compiledAbiFingerprint: 'f7c46fef11823d944ae835cca01905b07e06e4396b834caf1c30fdd6736e2c87',
		name: 'Zoltar',
		purpose: 'Registers universe forks, charges the fork admission haircut, and mints branch-specific child REP.',
		readAbiFingerprint: '84e9d44350c2a27cc521f9525e34f385e810e0093aa0626ad64bcb490a925fe9',
		readSurface:
			'Use `universes`, `deployedChildOutcomeIndexes`, `forkThresholdDivisor`, `forkBurnDivisor`, `zoltarQuestionData`, `getForkTime`, `forkQuestionMatches`, `getRepToken`, `getForkThreshold`, `getNonDecisionThreshold`, `getUniverseTheoreticalSupply`, `getChildUniverseId`, `getDeployedChildUniverses`, and `getMigrationRepBalance` to reconstruct universe and migration state.',
		readDeclarations: [
			{ name: 'getForkTime' },
			{ name: 'forkQuestionMatches' },
			{ name: 'getRepToken' },
			{ name: 'getForkThreshold' },
			{ name: 'getNonDecisionThreshold' },
			{ name: 'getUniverseTheoreticalSupply' },
			{ name: 'getChildUniverseId' },
			{ name: 'getDeployedChildUniverses' },
			{ name: 'getMigrationRepBalance' },
		],
		readStorageDeclarations: [{ name: 'universes' }, { name: 'deployedChildOutcomeIndexes' }, { name: 'forkThresholdDivisor' }, { name: 'forkBurnDivisor' }, { name: 'zoltarQuestionData' }],
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
				call: '`burnRep(universeId, amount)`',
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
				effect:
					'Mints `amount` of child REP into every selected branch, deploying missing children lazily. An empty outcome list returns after the universe-fork guard without outcome validation, deployment, minting, or events. A nonempty zero-amount call still validates every outcome, may deploy missing children, performs zero-value child REP mints, and records a zero split for every branch.',
				declarations: [{ name: 'splitMigrationRep' }],
				preconditions: "Universe forked. A nonempty list additionally requires every outcome to be well formed and the cumulative amount per child not to exceed the caller's migration balance.",
				signals: '`TheoreticalSupplySet` and `DeployChild` when needed; child REP `Transfer` and `Mint`, then `MigrationRepSplit`, per selected branch, including at zero amount; no event for an empty list',
			},
		],
	},
	{
		compiledAbiFingerprint: 'a7c983224bd1738e3cf9300f139edfa6968519466c71d881c65242d2013ed6c1',
		name: 'ReputationToken',
		purpose: 'Implements universe-specific ERC-20 REP and enforces the supply ceiling maintained by Zoltar.',
		readAbiFingerprint: '16a3e564da0ed3bc8da54a65d8051e810d27f8f50db525f5f1d176301168efd7',
		readSurface: 'Use `getTotalTheoreticalSupply`, `zoltar`, and the standard ERC-20 `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, and `allowance` reads.',
		readDeclarations: [
			{ name: 'getTotalTheoreticalSupply' },
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
				call: '`setMaxTheoreticalSupply(totalTheoreticalSupply)`',
				caller: '`Zoltar` only',
				effect: 'Sets the child token theoretical-supply ceiling used to bound subsequent migration mints.',
				declarations: [{ name: 'setMaxTheoreticalSupply' }],
				preconditions: 'Called by Zoltar as part of child-universe creation.',
				signals: '`TheoreticalSupplySet`',
			},
			{
				call: '`mint(account, value)`',
				caller: '`Zoltar` only',
				effect: 'Mints branch REP to an account.',
				declarations: [{ name: 'mint' }],
				preconditions: '`account` is nonzero; resulting ERC-20 supply does not exceed theoretical supply.',
				signals: '`Mint` and ERC-20 `Transfer`',
			},
			{
				call: '`burn(account, value)`',
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
		compiledAbiFingerprint: '63f58449dfc5115e0e8e13d90498a9c0a8b9bea022260817bcd46329dd7e7998',
		name: 'SecurityPoolFactory',
		purpose: 'Creates and canonically registers origin and child security pools with their share token, oracle coordinator, and optional truth auction.',
		readAbiFingerprint: '2a851398716178a195c1119681a111452b0cf421d177ddd0151b6d5bb8648396',
		readSurface:
			'Use `initialEscalationGameDeposit` for the immutable deployment parameter and `securityPoolDeploymentCount` with the strict `securityPoolDeploymentsRange(startIndex, count)` pager, which reverts rather than truncating when the requested range exceeds the array. Use `getOriginId`, `getPoolId`, `getSecurityPool`, `getSecurityPoolOriginId`, and `getSecurityPoolHasInheritedForkOutcome` for canonical lookup.',
		readDeclarations: [{ name: 'securityPoolDeploymentCount' }, { name: 'securityPoolDeploymentsRange' }, { name: 'getOriginId' }, { name: 'getPoolId' }, { name: 'getSecurityPool' }, { name: 'getSecurityPoolOriginId' }, { name: 'getSecurityPoolHasInheritedForkOutcome' }],
		readStorageDeclarations: [{ name: 'initialEscalationGameDeposit' }],
		sourcePath: 'solidity/contracts/peripherals/factories/SecurityPoolFactory.sol',
		interactions: [
			{
				call: '`deployOriginSecurityPool(universeId, questionId, securityMultiplier)`',
				caller: 'Anyone',
				effect: 'Creates the canonical origin pool, its lineage-wide share token, and its price coordinator, then wires and registers them atomically.',
				declarations: [{ name: 'deployOriginSecurityPool' }],
				preconditions: '`securityMultiplier > 1`; question exists and has exactly the categorical labels `Yes`, then `No`; universe is unforked and has a REP token; the origin/universe slot has not already been claimed.',
				signals: '`SecurityPoolRegistered`, then `DeploySecurityPool`',
			},
			{
				call: '`deployChildSecurityPool(parent, shareToken, universeId, questionId, securityMultiplier, currentRetentionRate, completeSetCollateralAmount)`',
				caller: '`SecurityPoolForker` only',
				effect: 'Creates and registers a canonical child pool with a coordinator and forker-owned truth auction while retaining the parent lineage share token.',
				declarations: [{ name: 'deployChildSecurityPool' }],
				preconditions: 'Parent is the canonical pool for its lineage; supplied share token equals the parent share token; target origin/universe slot is unclaimed; deployment arguments satisfy downstream constructors and wiring.',
				signals: '`SecurityPoolRegistered`, then `DeploySecurityPool`',
			},
		],
	},
	{
		compiledAbiFingerprint: 'a89b8774585a67959e34124765e2ad1065eb3d2895a0a2fc38368cd14556d6b1',
		name: 'SecurityPool',
		purpose: 'Holds ETH collateral and REP underwriting, accounts for vaults and fees, mints shares, and routes local escalation.',
		readAbiFingerprint: '06857683318415b32aa066f45f57ec80cd841048bb855f1ca4bd10f6ed723ae3',
		readSurface:
			'Immutable relationship and configuration getters are `questionId`, `universeId`, `initialEscalationGameDeposit`, `zoltar`, `parent`, `shareToken`, `repToken`, `priceOracleManagerAndOperatorQueuer`, `openOracle`, `escalationGameFactory`, `questionData`, `securityPoolForker`, `truthAuction`, `securityPoolFactory`, and `securityMultiplier`; the current game is `escalationGame`. Accounting and lifecycle getters are `totalSecurityBondAllowance`, `completeSetCollateralAmount`, `poolOwnershipDenominator`, `shareTokenSupply`, `totalFeesOwedToVaults`, `lastUpdatedFeeAccumulator`, `feeIndex`, `currentRetentionRate`, `awaitingForkContinuation`, `securityVaults`, and `systemState`. Use `securityPoolEventEmitter`, `getVaultCount`, `getActiveVaultCount`, `getVaults`, `getActiveVaults`, `sharesToCash`, `cashToShares`, `repToPoolOwnership`, `repToPoolOwnershipRoundUp`, `poolOwnershipToRep`, `getTotalRepBalance`, `totalAccruedFees`, `getPoolAccountingSnapshot`, `getVaultFeeRemainder`, and `isEscalationResolved` for derived or paged state. `isEscalationResolved()` is true only when a local escalation game is configured and the forker routes a non-`None` outcome; an operational fixed-outcome child without a local game returns false. `SystemState` determines which transaction paths remain open.',
		readDeclarations: [
			{ name: 'securityPoolEventEmitter' },
			{ name: 'getVaultCount' },
			{ name: 'getActiveVaultCount' },
			{ name: 'getVaults' },
			{ name: 'getActiveVaults' },
			{ name: 'sharesToCash' },
			{ name: 'cashToShares' },
			{ name: 'repToPoolOwnership' },
			{ name: 'repToPoolOwnershipRoundUp' },
			{ name: 'poolOwnershipToRep' },
			{ name: 'getTotalRepBalance' },
			{ name: 'totalAccruedFees' },
			{ name: 'getPoolAccountingSnapshot' },
			{ name: 'getVaultFeeRemainder' },
			{ name: 'isEscalationResolved' },
		],
		readStorageDeclarations: [
			{ name: 'questionId' },
			{ name: 'universeId' },
			{ name: 'initialEscalationGameDeposit' },
			{ name: 'zoltar' },
			{ name: 'parent' },
			{ name: 'shareToken' },
			{ name: 'repToken' },
			{ name: 'priceOracleManagerAndOperatorQueuer' },
			{ name: 'openOracle' },
			{ name: 'escalationGameFactory' },
			{ name: 'escalationGame' },
			{ name: 'questionData' },
			{ name: 'securityPoolForker' },
			{ name: 'truthAuction' },
			{ name: 'securityPoolFactory' },
			{ name: 'totalSecurityBondAllowance' },
			{ name: 'completeSetCollateralAmount' },
			{ name: 'poolOwnershipDenominator' },
			{ name: 'securityMultiplier' },
			{ name: 'shareTokenSupply' },
			{ name: 'totalFeesOwedToVaults' },
			{ name: 'lastUpdatedFeeAccumulator' },
			{ name: 'feeIndex' },
			{ name: 'currentRetentionRate' },
			{ name: 'awaitingForkContinuation' },
			{ name: 'securityVaults' },
			{ name: 'systemState' },
		],
		sourcePath: 'solidity/contracts/peripherals/SecurityPool.sol',
		interactions: [
			{
				call: '`burnEscalationWinnerHaircut(amount)`',
				caller: "This pool's `EscalationGame` only",
				effect: 'Burns the winning-deposit haircut from REP already escrowed in the game.',
				declarations: [{ name: 'burnEscalationWinnerHaircut' }],
				preconditions: 'Caller is the configured escalation game; amount is positive and the game has already transferred enough REP to the pool.',
				signals: '`RepBurned` and ERC-20 `Transfer`; child REP also emits `Burn`',
			},
			{
				call: '`depositRep(repAmount)`',
				caller: 'Vault owner',
				effect: 'Transfers REP into the pool and credits proportional pool ownership.',
				declarations: [{ name: 'depositRep' }],
				preconditions: 'Operational and unforked; `isEscalationResolved()` is false; resulting vault REP meets the minimum.',
				signals: '`DepositRep`',
			},
			{
				call: '`redeemFees(vault)`',
				caller: 'Anyone; any nonzero ETH payment is always sent to `vault`',
				effect: "First accrues the vault's fees. If resulting unpaid fees are zero, returns without payment; otherwise clears and pays the full amount.",
				declarations: [{ name: 'redeemFees' }],
				preconditions: 'A nonzero payment path requires `vault` to accept ETH.',
				signals: 'Accrual checkpoints only when accrual state changes; both `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint` for a nonzero redemption; no event when fees and accrual state are unchanged',
			},
			{
				call: '`createCompleteSet()` with ETH',
				caller: 'Trader',
				effect: 'Adds collateral and mints one `Invalid`, `Yes`, and `No` share per complete-set unit, then invokes the ERC-1155 batch-receiver callback for a contract trader. Callback rejection rolls back the ETH, pool accounting, events, and share mint.',
				declarations: [{ name: 'createCompleteSet' }],
				preconditions: 'Operational and unforked; `isEscalationResolved()` is false; not awaiting continuation; positive ETH converts to at least one complete-set unit; bond capacity covers the new collateral; a contract trader accepts `onERC1155BatchReceived`.',
				signals: '`CompleteSetCreated`, `PoolAccountingCheckpoint`, then ERC-1155 `TransferBatch` on a successful callback',
			},
			{
				call: '`redeemCompleteSet(completeSetAmount)`',
				caller: 'Anyone; positive redemption requires the caller to hold the complete set',
				effect:
					"Burns equal balances of all three outcomes and pays `completeSetAmount * completeSetCollateralAmount / shareTokenSupply` using the pool's remaining economic claim supply as its collateral denominator. Complete-set issuance adds to that denominator, while complete-set and winning-share redemption consume it; fork-time source entitlements materialize without changing it because their claims are already reserved. Zero passes the token and accounting checks and follows the normal zero-value event, checkpoint, and ETH-send path; rejection of that ETH call reverts the transaction.",
				declarations: [{ name: 'redeemCompleteSet' }],
				preconditions: 'Operational and unforked; caller owns every outcome amount requested; caller accepts the resulting ETH call, including zero value. Zero is accepted without a token balance.',
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
				call: '`redeemRep(vault)`',
				caller: 'Anyone; REP is always sent to `vault`',
				effect: "Burns the vault's pool-ownership claim and returns its proportional REP.",
				declarations: [{ name: 'redeemRep' }],
				preconditions: 'Operational pool with a final outcome; the specified `vault` has no escalation escrow and has redeemable REP.',
				signals: '`RedeemRep`',
			},
			{
				call: '`depositToEscalationGame(outcome, maxAmount)`',
				caller: 'Vault owner',
				effect: 'Deploys the local game on the first deposit, removes enough vault ownership, and escrows accepted REP on the selected outcome.',
				declarations: [{ name: 'depositToEscalationGame' }],
				preconditions: 'Question end has passed; pool operational in an unforked universe, without an inherited fixed outcome, and not awaiting continuation; outcome and amount accepted; remaining vault and pool backing stay solvent; fresh price when allowance is nonzero.',
				signals: '`EscalationGameSet` on first deposit; `DepositToEscalationGame`',
			},
			{
				call: '`withdrawFromEscalationGame(outcome, depositIndexes)`',
				caller: 'Anyone; a nonempty list must select deposits belonging to one beneficiary vault',
				effect: 'A nonempty list settles local deposits and routes any winning REP to their recorded depositor. An empty list returns after the outer lifecycle checks without settlement, state change, or event.',
				declarations: [{ name: 'withdrawFromEscalationGame' }],
				preconditions:
					'Game configured; operational pool; valid final outcome. If an external fork interrupted the game, parent withdrawal stays locked: winners settle in the child by carried proof, inherited losers require no transaction, and parent-lock cleanup is optional. A nonempty list additionally requires valid local indexes and one common depositor.',
				signals: 'Per processed deposit, escalation-game `CarryDepositConsumed`; additionally `ClaimDeposit` for a winning payout. No event for an empty list',
			},
			{
				call: '`withdrawForkedEscalationDeposits(outcome, proofs)`',
				caller: 'Anyone; a nonempty list must name one beneficiary vault across all proofs',
				effect: 'A nonempty list verifies and consumes carried proofs, then pays winning child REP to the recorded depositor. An empty list returns after the outer lifecycle checks without proof verification, state change, or event.',
				declarations: [{ name: 'withdrawForkedEscalationDeposits' }],
				preconditions: 'Game configured; operational child pool; valid final outcome. A nonempty list additionally requires an initialized continuation game, valid unconsumed winning proofs, and one common depositor.',
				signals: 'Per processed proof, escalation-game `CarryDepositConsumed` and `ClaimDeposit`. No event for an empty list',
			},
			{
				call: '`updateCollateralAmount()`',
				caller: 'Anyone',
				effect:
					"Accrues elapsed fees through question end while this pool's universe remains unforked; after that universe forks, its fork timestamp replaces question end as this pool epoch's cutoff, including a later question-end-to-fork interval. The cutoff is local to this pool: an activated child starts a separate fee epoch. It moves whole credited fees from collateral into the unallocated reserve and advances the accumulator. With positive elapsed time but zero fee-eligible allowance it clears denominator-specific remainder and advances the timestamp without charging fees.",
				declarations: [{ name: 'updateCollateralAmount' }],
				preconditions: 'No caller or lifecycle restriction. It returns unchanged when the accumulator is already at or beyond the clamped timestamp.',
				signals: '`PoolAccountingCheckpoint` whenever positive elapsed time is processed, including the zero-allowance branch; no event for an unchanged timestamp',
			},
			{
				call: '`updateRetentionRate()`',
				caller: 'Anyone',
				effect: 'Recalculates the retention rate from current collateral and total bond allowance.',
				declarations: [{ name: 'updateRetentionRate' }],
				preconditions: 'No caller restriction. It returns unchanged when allowance is zero, the pool is not `Operational`, or the calculated rate equals the stored rate.',
				signals: '`PoolAccountingCheckpoint` only when the stored retention rate changes; no event for a no-op',
			},
			{
				call: '`updateVaultFees(vault)`',
				caller: 'Anyone for any address',
				effect: 'First updates pool accrual, then advances the vault fee index and fractional remainder, moves whole assigned fees from reserve to the vault, updates active-vault membership, and returns leftover reserve to collateral once a forked pool has checkpointed all eligible allowance.',
				declarations: [{ name: 'updateVaultFees' }],
				preconditions: 'No caller, nonzero-vault, or lifecycle restriction.',
				signals: 'Accrual `PoolAccountingCheckpoint` when due; `VaultAccountingCheckpoint` when the vault index, remainder, or fee debt changes; an additional `PoolAccountingCheckpoint` when pool accounting changes; no event when neither accrual nor vault or pool accounting changes',
			},
			{
				call: '`performWithdrawRep(vault, repAmount)`',
				caller: "This pool's `OpenOraclePriceCoordinator` only",
				effect: 'Removes the requested proportional ownership, or the full ownership when the requested remainder would fall below the REP minimum, and transfers the resulting REP to `vault`.',
				declarations: [{ name: 'performWithdrawRep' }],
				preconditions: 'Fresh coordinator price; operational pool in an unforked universe; `isEscalationResolved()` is false; no vault REP escrow; sufficient vault and pool bond coverage after withdrawal.',
				signals: 'REP `Transfer`, `PerformWithdrawRep`, and `VaultAccountingCheckpoint`, including a zero-value transfer/event path if the trusted coordinator supplies zero',
			},
			{
				call: '`performLiquidation(...)`',
				caller: "This pool's `OpenOraclePriceCoordinator` only",
				effect: 'Moves bounded debt and pool ownership from the unsafe target to the caller vault using the staged snapshot, updates both active-vault positions, and preserves the minimum REP/debt floors or performs the documented full-close sweep.',
				declarations: [{ name: 'performLiquidation' }],
				preconditions: 'Fresh coordinator price; operational pool in an unforked universe; `isEscalationResolved()` is false; target snapshot is unsafe; computed debt is positive and profitable; caller remains backed; both resulting vaults satisfy minimum floors.',
				signals: 'Fee-accrual checkpoints as needed, then `VaultLiquidated`, both vault `VaultAccountingCheckpoint` events, and `PoolAccountingCheckpoint`',
			},
			{
				call: '`performSetSecurityBondsAllowance(callerVault, amount)`',
				caller: "This pool's `OpenOraclePriceCoordinator` only",
				effect: 'Accrues the vault, replaces its total and fee-eligible allowance contribution, clears allowance-denominator rounding carry, updates active membership, and recalculates retention.',
				declarations: [{ name: 'performSetSecurityBondsAllowance' }],
				preconditions: 'Fresh coordinator price; operational pool in an unforked universe; `isEscalationResolved()` is false; vault and pool remain strictly allowance-backed; collateral stays within capacity; new allowance is zero or meets the minimum debt.',
				signals: 'Accrual checkpoints as needed; retention `PoolAccountingCheckpoint` if its rate changes; always final `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including when replacing an allowance with the same value',
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
				signals: 'Pool REP `Transfer` always, including at zero; configured-game REP `Transfer` only for a positive game balance; accrual checkpoint when due; always `PoolForkModeActivated` and fork-activation `PoolAccountingCheckpoint`',
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
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'resumeForkedEscalationGame' }],
				effect: "Sets the configured continuation game's resume timestamp and starts its remaining escalation clock.",
				preconditions: 'A configured fork-continuation game that has not already resumed.',
				signals: '`ForkContinuationResumed`',
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
				call: '`configureVault(vault, poolOwnership, securityBondAllowance, vaultFeeIndex)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'configureVault' }],
				effect: 'Tracks the vault, replaces its ownership, allowance, and fee index, clears pooled fee-index remainder when allowance changes, and updates active-vault ordering.',
				preconditions: '`vault` is nonzero; no lifecycle or value-change guard.',
				signals: 'Always `VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including when all supplied values repeat current state',
			},
			{
				call: '`setOwnershipDenominator(newDenominator)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setOwnershipDenominator' }],
				effect: 'Replaces the pool ownership denominator.',
				preconditions: 'No lifecycle or value-change guard.',
				signals: '`OwnershipDenominatorSet`, including for zero or a repeated value',
			},
			{
				call: '`setTotalShares(newTotalShares)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setTotalShares' }],
				effect: 'Replaces stored `shareTokenSupply`, the denominator used by `sharesToCash` and complete-set redemption.',
				preconditions: 'No lifecycle or value-change guard.',
				signals: '`ShareTokenSupplySet`, including for zero or a repeated value',
			},
			{
				call: '`setPoolFinancials(newCollateral, newTotalBondAllowance, newFeeEligibleBondAllowance)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'setPoolFinancials' }],
				effect: 'Replaces collateral and both allowance totals, resets the fee timestamp to the current block, and clears fee-index rounding carry.',
				preconditions: 'Total allowance covers collateral and fee-eligible allowance does not exceed total allowance; no lifecycle or value-change guard.',
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
				call: '`transferEth(receiver, amount)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'transferEth' }],
				effect: 'Reduces tracked collateral by `amount`, checkpoints the reconciliation, and calls `receiver` with that ETH. At zero amount it reduces no collateral but still emits the checkpoint and performs a zero-value call; callback rejection rolls back the transaction and checkpoint.',
				preconditions: 'Fee liabilities are covered; `amount` fits both free pool balance and tracked collateral; `receiver` accepts the ETH call, including zero value.',
				signals: '`PoolAccountingCheckpoint`, including at zero amount; no dedicated ETH-transfer event',
			},
			{
				call: '`addFeeEligibleSecurityBondAllowance(vault, amount)`',
				caller: '`SecurityPoolForker` only',
				declarations: [{ name: 'addFeeEligibleSecurityBondAllowance' }],
				effect: 'Adds newly auction-claimed security-bond allowance to the live fee denominator and clears the pooled fee-index rounding remainder.',
				preconditions: 'The resulting fee-eligible allowance cannot exceed total security-bond allowance; no lifecycle, vault, positive-amount, or value-change guard.',
				signals: '`VaultAccountingCheckpoint` and `PoolAccountingCheckpoint`, including at zero amount; the calling forker emits `ClaimAuctionProceeds` only after the broader credit workflow completes',
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
		compiledAbiFingerprint: '8c7458fdb53493a7885c09e85c0b971cad80664f957b1912189abc9340a8c1a9',
		name: 'SecurityPoolForker',
		purpose: 'Freezes parent pools, creates selected child pools, migrates vault and escalation state, and settles collateral-repair auctions.',
		readAbiFingerprint: 'aa79d2d795e90ce0f0347186328bacbb1d5e28bbf7792359569ae44fead526f2',
		readSurface:
			'Use `zoltar`, `forkData`, `getMigratedRep`, `getForkActivationTime`, `isEscalationDepositClaimedDirectly`, `getEscalationDepositId`, `getDirectlyClaimedEscalationPrincipal`, `isEscalationWinnerHaircutPaidByFork`, `getEscalationMigrationEntitlementStatus`, `getOwnForkRepBuckets`, `getOwnForkMigrationStatus`, `getMigrationProxyAddress`, `getQuestionOutcome`, `repToPoolOwnership`, and `poolOwnershipToRep` to reconstruct fork progress and preview migration conversions.',
		readDeclarations: [
			{ name: 'forkData' },
			{ name: 'getMigratedRep' },
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
			{ name: 'repToPoolOwnership', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol' },
			{ name: 'poolOwnershipToRep', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol' },
		],
		readStorageDeclarations: [{ name: 'zoltar', sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerBase.sol' }],
		securityBoundary:
			'### Child-game trust boundary\n\nFork entrypoints and child setup may receive contracts through unauthenticated pool lineages. A game relationship check is point-in-time: the reported nonzero game address must return the supplied pool or child from `securityPool()` when validated. This does not prove that an arbitrary game getter is immutable or that the address was factory-deployed. Child setup captures one reported game address, validates it before privileged use, and reuses that exact address for continuation backing and escrow work. When unresolved escalation requires a continuation and setup initially reports no game, initialization creates one; the forker then captures and validates it before continuation use. Combined vault migration passes the captured child/game pair into unresolved cleanup without reading the child getter again. Truth-auction completion performs a fresh point-in-time validation of the game reported then before checking continuation readiness. Genuine factory-deployed `EscalationGame` instances store their pool immutably, but safety on unauthenticated paths does not assume arbitrary contracts do.',
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForker.sol',
		interactions: [
			{
				call: '`initiateSecurityPoolFork(securityPool)`',
				caller: 'Anyone',
				effect: 'Freezes the supplied pool after an external universe fork, drains its pool and game REP, and records a migration snapshot keyed by that address. The snapshot is canonical only when the supplied pool is already registered by the configured `SecurityPoolFactory`.',
				declarations: [{ name: 'initiateSecurityPoolFork' }],
				preconditions:
					'Pool operational with no inherited fixed outcome; its universe already forked; fork state not initialized; if an escalation game exists, it reports the supplied pool from `securityPool()` when validated and the universe fork occurred before that game settled. This entrypoint does not authenticate the supplied address against a pool factory; see the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`SecurityPoolForkSnapshot` and `ParentRepLocked`; additionally `EscalationRepDrainedAtFork` when unresolved escalation exists',
			},
			{
				call: '`forkZoltarWithOwnEscalationGame(securityPool)`',
				caller: 'Anyone',
				effect: "Uses the supplied pool game's non-decision to fork Zoltar, freezes that pool, and records own-fork REP buckets and snapshot state keyed by its address. The snapshot is canonical only when the supplied pool is already registered by the configured `SecurityPoolFactory`.",
				declarations: [{ name: 'forkZoltarWithOwnEscalationGame' }],
				preconditions:
					'Pool operational with no inherited fixed outcome; its escalation game reports the supplied pool from `securityPool()` when validated and `canTriggerOwnFork()` is true because it recorded a local non-decision or inherited a threshold tie without a game-level fixed outcome; universe not already forked. The game-local predicate does not bypass the pool guard. This entrypoint does not authenticate the supplied address against a pool factory; see the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`SecurityPoolForkSnapshot`, `ParentRepLocked`, and Zoltar fork events; additionally `EscalationRepDrainedAtFork` when unresolved escalation exists',
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
				preconditions: "Parent in migration window; selected fork outcome is well formed; child pool is not already deployed; the selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary).",
				signals:
					'`DeployChild` only when child REP was absent; always `SecurityPoolRegistered`, `DeploySecurityPool`, `AuthorizationUpdated`, `ChildPoolLinked`, and `OwnershipDenominatorSet`; `AwaitingForkContinuationSet`, `EscalationGameSet`, `GameContinuedFromFork`, `ForkCarryCheckpoint`, `MigrationRepSplit`, `ChildEscalationRepMaterialized`, and `ChildPoolRepSwept` as continuation and backing state requires',
			},
			{
				call: '`migrateVault(securityPool, outcomeIndex)`',
				caller: 'Vault owner for its unlocked position',
				declarations: [{ name: 'migrateVault' }],
				effect: "Moves the caller's currently unlocked REP ownership, allowance, fees, and collateral into one child pool. Repeat calls can have no additional unlocked state to move.",
				preconditions: "Migration window open; the selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary). The optional unresolved-lock cleanup wrapper calls this function first to migrate any unlocked state.",
				signals: '`VaultMigrationCheckpoint`',
			},
			{
				call: '`migrateVaultWithUnresolvedEscalation(securityPool, vault, childOutcomeIndex)`',
				caller: 'The named vault',
				effect:
					"First runs ordinary migration for the same vault, which may move its unlocked ownership, allowance, fees, and collateral to the selected child. It returns the selected child and its captured, validated escalation game to the unresolved-cleanup phase, which reuses those exact addresses without reading the child's game again. The cleanup then clears that vault's parent unresolved-lock accounting in constant-size work and records it; the cleanup neither funds escalation backing nor authorizes carried proofs.",
				declarations: [{ name: 'migrateVaultWithUnresolvedEscalation' }],
				preconditions: "Migration window open; caller equals `vault`; selected child not already recorded for this optional cleanup; the selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary).",
				signals: 'Vault migration events plus `EscalationMigrationEntitlementInitialized` on first export and `EscalationMigrationEntitlementMaterialized` for the selected child',
			},
			{
				call: '`claimForkedEscalationDeposits(...)`',
				caller: 'The named vault',
				effect:
					"First gets or lazily deploys the selected child universe, REP token, pool, coordinator, and auction, then captures and validates the child's escalation game and uses that same game for continuation backing and escrow payment. A nonempty list claims winning own-fork parent deposits and records their stable identities against descendant replay. An empty list still performs child setup and emits a zero-valued claim summary.",
				declarations: [{ name: 'claimForkedEscalationDeposits' }],
				preconditions:
					'Caller equals `vault`; unresolved escalation existed when the pool initiated its own fork and the parent game still satisfies `canTriggerOwnFork()` by having either a local non-decision or an inherited threshold tie without a fixed outcome; selected child can be created or loaded, remains in `ForkMigration`, has a continuation game that passes the [child-game trust boundary](#child-game-trust-boundary), and is inside the eight-week claim window. A nonempty list additionally requires the matching winning outcome, deposits belonging to `vault`, and unclaimed deposit identities.',
				signals:
					'`DeployChild`, `SecurityPoolRegistered`, `DeploySecurityPool`, `AuthorizationUpdated`, `ChildPoolLinked`, `OwnershipDenominatorSet`, `AwaitingForkContinuationSet`, `EscalationGameSet`, `GameContinuedFromFork`, `ForkCarryCheckpoint`, `MigrationRepSplit`, `ChildEscalationRepMaterialized`, and `ChildPoolRepSwept` as setup requires; per claimed deposit, `CarryDepositConsumed` and `ClaimDeposit`; escrow record/export events when REP is paid; always `ClaimForkedEscalationDepositsToWallet`, including for an empty list',
			},
			{
				call: '`startTruthAuction(securityPool)`',
				caller: 'Anyone',
				effect: "Copies the frozen parent's remaining economic claim supply into the child, closes migration accounting, and either reopens a fully backed child or starts its repair auction.",
				declarations: [{ name: 'startTruthAuction' }],
				preconditions: 'Child migration window ended; pool is in fork migration; required child REP is available. If unresolved escalation existed at fork, any game reported during immediate completion passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`ShareTokenSupplySet` and `TruthAuctionStarted`; immediate no-auction paths also emit `TruthAuctionFinalized` and pool accounting checkpoints',
			},
			{
				call: '`finalizeTruthAuction(securityPool)`',
				caller: 'Anyone',
				effect: 'Finalizes the ended auction, accounts migration-routed collateral plus accepted bid ETH, activates the child at that collateral level, and fixes bidder ownership and allowance rates. A nonzero repair contribution is rejected.',
				declarations: [{ name: 'finalizeTruthAuction' }],
				preconditions: 'Truth auction started, its one-week window has passed, and `msg.value` is zero. If unresolved escalation existed at fork, the game reported at completion passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`TruthAuctionFinalized`, auction `AuctionFinalized`, and pool accounting checkpoints',
			},
			{
				call: '`settleAuctionBids(securityPool, vault, claimTickIndices, refundTickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'settleAuctionBids' }],
				effect: 'Before finalization, refunds only provably losing bids. After finalization, combines claim and refund indexes into one settlement withdrawal and credits each fixed-position REP and allowance result; a winning dust bid may receive allowance even when its REP share rounds to zero.',
				preconditions: 'At least one index; before finalization the claim list must be empty and refund indexes must be eligible; after finalization all indexes must belong to the named vault and remain unsettled.',
				signals: 'Underlying auction `BidSettled`; `ClaimAuctionProceeds` when REP or allowance is credited',
			},
			{
				call: '`claimAuctionProceeds(securityPool, vault, tickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'claimAuctionProceeds' }],
				effect:
					'For a nonempty list, withdraws finalized bid settlements, converts purchased REP into child-pool ownership, and independently credits the bid positional allowance share. A winning dust bid can receive positive allowance when its REP share rounds to zero. For an empty list, the underlying auction withdrawal returns three zeros and the wrapper exits after the finalization guard without validating bids or the named beneficiary, calling it, changing state, or emitting events.',
				preconditions: 'Auction finalized. A nonempty list additionally requires every index to belong to the named vault and remain unsettled.',
				signals: 'For processed bids, underlying auction `BidSettled`; `ClaimAuctionProceeds` when REP or allowance is credited; no event for an empty list',
			},
			{
				call: '`initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame)`',
				caller: 'This `SecurityPoolForker` contract only, through its migration delegate callback',
				effect:
					'Allows delegated migration code to initialize a child continuation while preserving the forker as the authoritative caller and the already captured child-game identity. When unresolved escalation requires a continuation and no game existed, it captures and validates the game created by initialization before any continuation use.',
				declarations: [{ name: 'initializeChildForkedEscalationGameIfNeeded' }],
				preconditions: 'External caller is the forker itself; parent and child match the active migration path; a supplied nonzero game passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`ChildEscalationRepMaterialized` and escalation-continuation events when initialization is required',
			},
			{
				call: 'Direct ETH transfer to `receive()`',
				caller: 'The canonical child-pool truth auction registered by this forker during `ChildPoolLinked`',
				effect: 'Accepts auction ETH during forker-controlled auction finalization.',
				declarations: [{ kind: 'receive', name: 'receive' }],
				preconditions: '`trustedAuctionAddresses[msg.sender]` was set when the forker linked that canonical child pool and emitted `ChildPoolLinked`.',
				signals: 'No dedicated receive event; auction `AuctionFinalized` is followed by forker `TruthAuctionFinalized` and pool accounting checkpoints',
			},
		],
	},
	{
		compiledAbiFingerprint: '944f05572e55db85409418510e1ef477a80943359d153df5641fb15ce0508d68',
		name: 'EscalationGame',
		purpose: 'Escrows outcome REP, raises the running resolution cost, detects non-decision, and settles local or carried deposits.',
		readAbiFingerprint: 'ed805db82536ad060437fa3f82ceb85839349441a6fede83e2fd40ee761e13d5',
		readSurface:
			'Base getters are `securityPool`, `repToken`, `activationTime`, `nonDecisionThreshold`, `startBond`, `nonDecisionTimestamp`, `nonDecisionState`, `forkContinuation`, `forkElapsedAtStart`, `forkResumedAt`, `fixedQuestionOutcome`, `nodes`, `escrowedRepByVault`, and `totalEscrowedRep`. Use `previewDepositOnOutcome`, `computeIterativeAttritionCost`, `computeTimeSinceStartFromAttritionCost`, `totalCost`, `getEscalationGameEndDate`, `getQuestionResolution`, `getFinalQuestionResolution`, `hasReachedNonDecision`, `canTriggerOwnFork`, `getBindingCapital`, `getOutcomeBalances`, `getDepositsByOutcome`, `getDepositsByOutcomeLength`, `forkCarrySnapshotInitialized`, `getOutcomeState`, `getForkCarrySnapshot`, `getForkCarryRoots`, `isForkCarryFundingComplete`, `getCarryLeafPageByOutcome`, `getProofConsumedCarriedDepositIndexesByOutcome`, `getLocalUnresolvedPrincipalByVaultAndOutcome`, and `getForkedEscrowByVaultAndOutcome` for calculations, lifecycle authorization, pages, carry state, and escrow. Ordinary users route deposits and withdrawals through `SecurityPool`.',
		readDeclarations: [
			{ name: 'previewDepositOnOutcome' },
			{ name: 'computeIterativeAttritionCost', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'computeTimeSinceStartFromAttritionCost', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'totalCost', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getEscalationGameEndDate', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getQuestionResolution', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getFinalQuestionResolution', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'hasReachedNonDecision', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'canTriggerOwnFork', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getBindingCapital', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
			{ name: 'getOutcomeBalances', sourcePath: 'solidity/contracts/peripherals/EscalationGameCalculations.sol' },
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
			{ name: 'nonDecisionThreshold', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'startBond', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nonDecisionTimestamp', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nonDecisionState', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'forkContinuation', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'forkElapsedAtStart', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'forkResumedAt', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'nodes', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'escrowedRepByVault', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'totalEscrowedRep', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
			{ name: 'fixedQuestionOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameStorage.sol' },
		],
		sourcePath: 'solidity/contracts/peripherals/EscalationGame.sol',
		interactions: [
			{
				call: '`start(startBond, nonDecisionThreshold)`',
				caller: '`EscalationGameFactory` contract during atomic deployment',
				effect: 'Initializes a local game and sets activation three days after deployment.',
				declarations: [{ name: 'start' }],
				preconditions: 'Game not already started; threshold exceeds the positive start bond; both are at least 1 REP.',
				signals: '`GameStarted`',
			},
			{
				call: '`startFromFork(startBond, nonDecisionThreshold, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBacking)`',
				caller: 'Immutable owner (`EscalationGameFactory`) during atomic continuation deployment',
				effect: 'Initializes a paused continuation with inherited elapsed time, an optional fixed matching child outcome, and immutable fork-time haircut/backing accounting. It does not start the remaining clock until `resumeFromFork`.',
				declarations: [{ name: 'startFromFork' }],
				preconditions: 'Game not started; threshold exceeds the positive start bond; both are at least 1 REP; inherited elapsed time is no greater than seven weeks.',
				signals: '`GameContinuedFromFork`',
			},
			{
				call: '`resumeFromFork()`',
				caller: 'Owning `SecurityPool` in the supported workflow; the immutable owner is also admitted, but its factory contract exposes no relay',
				effect: 'Records the resume timestamp and starts the remaining continuation clock. After the deadline, `getFinalQuestionResolution` returns the fixed outcome when one is present.',
				declarations: [{ name: 'resumeFromFork' }],
				preconditions: 'Fork-continuation mode and not previously resumed.',
				signals: '`ForkContinuationResumed`',
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
				effect: 'Consumes one local deposit after resolution. A winner is paid after its haircut; a loser only retires its escrow accounting.',
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
				effect: 'Consumes a selected local deposit as a winner, consumes its vault escrow, burns the computed haircut when nonzero, and transfers the remaining positive REP payout to its recorded depositor.',
				preconditions: 'Non-`None` supplied outcome and valid unsettled local deposit with sufficient escrow. This entrypoint itself does not check final resolution or that the supplied outcome won; its trusted caller selects that path.',
				signals: '`CarryDepositConsumed`, `VaultEscrowUpdated`, `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and haircut burn signals only when their amounts are positive',
			},
			{
				call: '`claimDepositForWinningWithoutTransfer(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'claimDepositForWinningWithoutTransfer', sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol' }],
				effect: 'Consumes a selected local deposit and its vault escrow and returns the computed winner amount to the trusted caller, but deliberately neither transfers REP nor burns the computed haircut.',
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
				call: '`recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipal, childRepAmount)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'recordForkedEscrowForOutcome', sourcePath: 'solidity/contracts/peripherals/EscalationGameEscrow.sol' }],
				effect: 'Accumulates source principal and child REP escrow for the vault and outcome. When both amounts are zero, returns without changing state or emitting an event.',
				preconditions: 'Outcome is not `None`; depositor is nonzero. A nonzero call additionally requires positive source principal.',
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
		compiledAbiFingerprint: '77123164dedd551357fc458328598db7d57ffedf791db0943c040894b395cd83',
		name: 'OpenOraclePriceCoordinator',
		purpose: 'Obtains a fresh REP-per-ETH price and gates withdrawal, allowance, and liquidation operations behind it.',
		readAbiFingerprint: 'f86d47172374a06e4f6a9eb2e47f8cca1d7c314b30183bd1c4e3d0495e5d6ce4',
		readSurface:
			'Configuration getters are `MAX_PENDING_SETTLEMENT_OPERATIONS`, `OPEN_INTEREST_DIVIDER`, `reputationToken`, `securityPool`, `openOracle`, `weth`, `gasConsumedOpenOracleReportPrice`, `gasConsumedSettlement`, `gasUnitsForOneDispute`, `targetPriceErrorForDispute`, `openOracleSecurityMultiplierBps`, `settlementTime`, `disputeDelay`, `protocolFee`, `feePercentage`, `multiplier`, `timeType`, `trackDisputes`, `protocolFeeRecipient`, `escalationHaltMultiplierBps`, `maxSettlementBaseFeeMultiplierBps`, and `minLiquidationPriceDistanceBps`. Current report and operation getters are `pendingReportId`, `pendingReportSponsor`, `pendingOperationSlotId`, `lastSettlementTimestamp`, `lastPrice`, `pendingReportMaxSettlementBaseFee`, `stagedOperationCounter`, and `stagedOperations`. Use `isPriceValid`, `minimumToken1Report`, `getRequestPriceEthCost`, `getQueuedOperationEthCost`, `getSettlementCallbackGasLimit`, `getPendingOperationSlot`, `getActiveStagedOperationCount`, `getActiveStagedOperations`, `getPendingSettlementOperationCount`, and `getPendingSettlementOperationIds` for derived or paged state.',
		readDeclarations: [
			{ name: 'isPriceValid' },
			{ name: 'minimumToken1Report' },
			{ name: 'getRequestPriceEthCost' },
			{ name: 'getQueuedOperationEthCost' },
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
			{ name: 'pendingReportMaxSettlementBaseFee' },
			{ name: 'stagedOperationCounter' },
			{ name: 'stagedOperations' },
		],
		sourcePath: 'solidity/contracts/peripherals/OpenOraclePriceCoordinator.sol',
		interactions: [
			{
				call: '`requestPriceIfNeededAndStageOperation(...)` with funding when stale',
				caller: 'Vault owner for self withdrawal/allowance; a different vault for liquidation. While a report is pending, only that report sponsor may stage more operations.',
				effect:
					'Records the operation, executes immediately with a fresh price, or attaches it to a bounded pending settlement batch and opens a report when required. If unused ETH is positive, the final caller refund uses a low-level callback; rejection rolls back the entire transaction, including any queueing, immediate execution, or newly opened report.',
				declarations: [{ name: 'requestPriceIfNeededAndStageOperation' }],
				preconditions:
					'`securityPool.isEscalationResolved()` is false; valid target and nonzero amount except zero allowance; timeout from 1 second through 5 minutes. Bounty, buffered funding for at least the dynamic WETH minimum and coordinator-derived REP side, and approvals are required only when this call opens a new report; the caller may request a larger initial WETH amount. Staging beside a pending report or queued rejected-report work does not open or fund another report. The caller must accept any positive unused-ETH refund.',
				signals: '`StagedOperationQueued`, possibly `PriceRequested`, then `ExecutedStagedOperation`; authoritative `CoordinatorStateCheckpoint` records',
			},
			{
				call: '`requestPrice(proposedRepPerEthPrice, requestedInitialWeth)` with report funding',
				caller: 'Anyone when no fresh price or report is pending',
				effect: 'Opens and atomically funds a fresh WETH/REP report without staging a new operation, then refunds any positive excess ETH through a low-level caller callback. Callback rejection rolls back the report and initial position.',
				declarations: [{ name: 'requestPrice' }],
				preconditions:
					'Cached price stale; no pending report; nonzero proposed REP/ETH price, ETH bounty, and funding and approvals for at least the dynamic WETH minimum plus matching REP. Zero requested WETH uses the minimum; a larger request voluntarily increases the initial report. The caller must accept any positive excess-ETH refund.',
				signals: '`PriceRequested` and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`executeStagedOperation(operationId)`',
				caller: 'Anyone',
				effect: "Consumes and attempts one active staged operation using the current fresh price. Price-report funding is independent of the operation's notional; the downstream operation applies its own protocol bounds.",
				declarations: [{ name: 'executeStagedOperation' }],
				preconditions: 'Operation exists and coordinator price is fresh; lifecycle failures are emitted rather than retried.',
				signals: '`ExecutedStagedOperation` and `CoordinatorStateCheckpoint`',
			},
			{
				call: '`recoverSettledPendingReport()`',
				caller: 'Anyone',
				effect: 'Clears a pending report whose normal callback path did not clear coordinator state and consumes its pending-operation slot.',
				declarations: [{ name: 'recoverSettledPendingReport' }],
				preconditions: 'A pending report ID exists and its stored OpenOracle `finalizedGame(reportId).settlementTimestamp` is nonzero.',
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
		compiledAbiFingerprint: '57037ae78e2547bcb28e5a683091fe0a03301902f835b0b2600bcbd112fd5dda',
		name: 'ShareToken',
		purpose: "Stores universe-aware ERC-1155 outcome shares and materializes a holder's persistent source entitlement in selected fork branches.",
		readAbiFingerprint: '3b68e6bd8e3cea9398317397c9ab93da54e67d7aa234933be4b4cdcd95e884d9',
		readSurface:
			'Base and relationship getters are `name`, `symbol`, `zoltar`, `canonicalPoolByUniverse`, `_balances`, `_supplies`, and `_operatorApprovals`. Standard ERC-1155 reads are `supportsInterface`, `balanceOf`, `totalSupply`, `balanceOfBatch`, and `isApprovedForAll`; protocol-specific reads are `isAuthorized`, `getChildUniverseId`, `totalSupplyForOutcome`, `maximumOutcomeSupply`, `balanceOfOutcome`, `balanceOfShares`, `getMigratedShareAmount`, `getTokenId`, `getTokenIds`, and `unpackTokenId`.',
		readDeclarations: [
			{ name: 'supportsInterface', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'balanceOf', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'totalSupply', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'balanceOfBatch', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'isApprovedForAll', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' },
			{ name: 'isAuthorized' },
			{ name: 'getChildUniverseId' },
			{ name: 'totalSupplyForOutcome' },
			{ name: 'maximumOutcomeSupply' },
			{ name: 'balanceOfOutcome' },
			{ name: 'balanceOfShares' },
			{ name: 'getMigratedShareAmount' },
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
				preconditions: 'Caller owns the source balance or has operator approval; the source account has not materialized that token into any child branch; destination is nonzero; the source balance is sufficient; a contract recipient accepts the ERC-1155 callback.',
				signals: '`TransferSingle`',
			},
			{
				call: 'Both `safeBatchTransferFrom(...)` overloads',
				caller: 'Share holder or approved ERC-1155 operator for a nonempty batch; any caller for an empty batch',
				effect: 'A nonempty batch transfers each listed outcome-token balance without changing supply. Equal empty ID and value arrays return as a no-op without an event.',
				declarations: [{ name: 'safeBatchTransferFrom', sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol' }],
				preconditions:
					'ID and value array lengths match. A nonempty batch also requires holder or operator authority, no listed source token that the source account has already materialized into a child branch, a nonzero destination, sufficient source balances, and an accepting ERC-1155 callback from a contract recipient; the empty-batch no-op performs none of those checks.',
				signals: '`TransferBatch` for a nonempty batch; no event for an empty batch',
			},
			{
				call: '`migrate(fromId, targetOutcomeIndexes)`',
				caller: 'Holder of the source token ID',
				effect:
					"If needed, first freezes the operational source pool and records its fork snapshot. A single-target call may lazily create that child while the branch-creation window is open. It keeps and locks the holder's source entitlement, then mints each selected child-universe token ID up to the current source balance. Later source additions materialize only the unminted delta. A contract holder receives the ERC-1155 single-receiver callback for each mint; rejection rolls back the mint and preceding fork or child setup.",
				declarations: [{ name: 'migrate' }],
				preconditions:
					'Source universe forked; canonical source pool is `Operational` or `PoolForked`, and an `Operational` source has no inherited fixed outcome because auto-fork activation rejects one; positive source balance; nonempty, strictly increasing, well-formed outcomes; every target in a multi-target call already has a canonical child pool; after the branch-creation window, a single target must also already exist; at least one selected child has an unmaterialized balance; a contract holder accepts `onERC1155Received` for every target mint.',
				signals:
					'`PoolForkModeActivated`, `PoolAccountingCheckpoint`, `SecurityPoolForkSnapshot`, `ParentRepLocked`, and optionally `EscalationRepDrainedAtFork` when auto-forking; `SecurityPoolRegistered`, `DeploySecurityPool`, `AuthorizationUpdated`, and `ChildPoolLinked` when lazily deploying, plus `DeployChild`, `ChildRepSplit`, `ChildPoolRepSwept`, `EscalationGameSet`, `GameContinuedFromFork`, `ForkCarryCheckpoint`, and `ChildEscalationRepMaterialized` as applicable; then one ERC-1155 mint `TransferSingle` and `Migrate` per materialized target on successful callbacks',
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
				call: '`mintCompleteSets(universeId, account, amount)`',
				caller: 'An authorized `SecurityPool`',
				effect: "Mints `amount` each of Invalid, Yes, and No to `account`, then invokes its ERC-1155 batch-receiver callback when it is a contract. Rejection rolls back the mint and the authorized pool's surrounding transaction.",
				declarations: [{ name: 'mintCompleteSets' }],
				preconditions: 'Caller is authorized; `account` is nonzero; `amount` is positive; a contract account accepts `onERC1155BatchReceived`.',
				signals: '`TransferBatch` on a successful callback',
			},
			{
				call: '`burnCompleteSets(universeId, account, amount)`',
				caller: 'An authorized `SecurityPool`',
				effect: 'Burns `amount` each of Invalid, Yes, and No from `account`; global outcome supplies may differ.',
				declarations: [{ name: 'burnCompleteSets' }],
				preconditions: 'Caller is authorized; `account` is nonzero and owns at least `amount` of every outcome.',
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
		compiledAbiFingerprint: '665c49ae04480dac83863ace573f093aa6bc0815ee64a65c8deb37f388bfa2da',
		name: 'UniformPriceDualCapBatchAuction',
		purpose: 'Collects ETH bids under ETH-raise and REP-sale caps, computes one clearing result, and supports paged settlement.',
		readAbiFingerprint: '186753be736e928a7f869de0ce48c0e0d02d4000940ab96c8f656d7bdbae28ca',
		readSurface:
			'Auction summary getters are `maxRepBeingSold`, `ethRaiseCap`, `finalized`, `clearingTick`, `ethFilledAtClearing`, `ethRaised`, `totalRepPurchased`, `auctionStarted`, `minBidSize`, `owner`, `underfunded`, `underfundedThreshold`, `underfundedWinningEth`, and `activeTickCount`. Use `computeClearing`, `previewFinalization`, `tickToPrice`, `getTickSummary`, `getTickCount`, `getTickPage`, `getActiveTickPage`, `getBidCountAtTick`, `getBidPageAtTick`, `getBidderBidCount`, and `getBidderBidPage` before finalizing or submitting settlement indexes.',
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
			{ name: 'maxRepBeingSold' },
			{ name: 'ethRaiseCap' },
			{ name: 'finalized' },
			{ name: 'clearingTick' },
			{ name: 'ethFilledAtClearing' },
			{ name: 'ethRaised' },
			{ name: 'totalRepPurchased' },
			{ name: 'auctionStarted' },
			{ name: 'minBidSize' },
			{ name: 'owner' },
			{ name: 'underfunded' },
			{ name: 'underfundedThreshold' },
			{ name: 'underfundedWinningEth' },
			{ name: 'activeTickCount' },
		],
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
				effect: "Adds ETH demand at the selected positive-price tick while extending that tick's append-only cumulative bid and refund history, including when a fully refunded tick becomes active again.",
				declarations: [{ name: 'submitBid' }],
				preconditions: 'Auction active and unfinalized; before one-week deadline; bid meets `minBidSize`; tick maps to nonzero price.',
				signals: '`BidSubmitted`',
			},
			{
				call: '`refundLosingBids(tickIndices)`',
				caller: 'Bidder for its own bids',
				declarations: [{ name: 'refundLosingBids' }],
				effect: "A nonempty list marks and refunds the caller's bids already provably below the current clearing tick. An empty list changes no bids but still calls the bidder with zero ETH.",
				preconditions: 'Auction started and unfinalized; auction has reached a clearing price; bidder accepts the refund ETH call, including zero value. Nonempty indexes additionally belong to the caller and are strictly losing and unrefunded.',
				signals: '`BidSettled` per refunded bid; no event for an empty list',
			},
			{
				call: '`refundLosingBidsFor(bidder, tickIndices)`',
				caller: 'Auction owner (`SecurityPoolForker`) only; public callers use `settleAuctionBids`',
				declarations: [{ name: 'refundLosingBidsFor' }],
				effect: "A nonempty list marks and refunds a named bidder's bids already provably below the current clearing tick. An empty list changes no bids but still calls the bidder with zero ETH.",
				preconditions: 'Named bidder is nonzero; auction started and unfinalized; auction has reached a clearing price; bidder accepts the refund ETH call, including zero value. Nonempty indexes additionally belong to that bidder and are strictly losing and unrefunded.',
				signals: '`BidSettled` per refunded bid; no event for an empty list',
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
					'For a nonempty list, returns refunds, purchased REP, and a companion pro-rata allocation for the selected beneficiary bids so the forker can credit pool ownership and allowance. Withdrawal-time allocation assigns division dust from deterministic cumulative ETH positions, making each payout independent of claim order. An empty list returns three zeros without changing bids, emitting events, or calling the beneficiary.',
				declarations: [{ name: 'withdrawBids' }],
				preconditions: 'Auction finalized; caller is owner. Nonempty indexes belong to `withdrawFor` and remain unsettled; if their aggregate refund is positive, `withdrawFor` accepts that ETH call.',
				signals: '`BidSettled` per processed bid; no event for an empty list',
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
		const sourceLink = `../${contractReference.sourcePath}`
		const rows = contractReference.interactions.map(interaction => `| ${interaction.call} | ${interaction.caller} | ${interaction.preconditions} | ${interaction.effect} | ${interaction.signals} |`).join('\n')
		const readAbiFingerprint = readAbiFingerprintByContract.get(contractReference.name)
		assert.ok(readAbiFingerprint, `Missing read ABI fingerprint for ${contractReference.name}`)
		const compiledAbiFingerprint = compiledAbiFingerprintByContract.get(contractReference.name)
		assert.ok(compiledAbiFingerprint, `Missing compiled ABI fingerprint for ${contractReference.name}`)
		const securityBoundary = contractReference.securityBoundary === undefined ? '' : `\n\n${contractReference.securityBoundary}`
		return `## ${contractReference.name}\n\n${contractReference.purpose} [Source](${sourceLink})\n\nRead surface: ${contractReference.readSurface}${securityBoundary}\n\n<!-- Validated read ABI fingerprint: ${readAbiFingerprint} -->\n<!-- Validated complete compiled ABI fingerprint: ${compiledAbiFingerprint} -->\n\n| Transaction | Caller | Main prerequisites | State or asset effect | Primary signals |\n| --- | --- | --- | --- | --- |\n${rows}`
	})

	return `<!-- Generated by scripts/generate-contract-interaction-reference.mts. Do not edit directly. -->
<!-- Validated production Solidity source fingerprint: ${productionSoliditySourceFingerprint} -->
# Contract Interaction Reference

The main state-changing protocol calls map to caller authority, lifecycle prerequisites, effects, and observable events below. The conceptual flow begins in [Start Here](./documentation.html), while the [Operator Reference](./operator-reference.md) covers edge cases and the application build consumes the complete generated ABI.

The tables focus on transaction entrypoints in the ten primary state-changing contracts that users and protocol components interact with directly. Each read surface names every read-only function and public storage getter in the deployed contract ABI; its hidden fingerprint pins the exact source declarations, including parameters, returns, visibility, and mutability. Protocol-only rows identify calls that applications should observe but ordinary users should reach through the owning pool, forker, factory, or coordinator. Stateless helpers, deployment workers, factories used only for component construction, migration proxies, and event emitters are inventoried with their caller boundaries in the Operator Reference.

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
	const declarationPattern = new RegExp(`^\\s*([^;{}]*\\bpublic(?:\\s+(?:constant|immutable))*\\s+${storageName}(?:\\s*=\\s*[^;]+)?);`, 'm')
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
			Array.from(source.matchAll(/^\s*(?:mapping\s*\([^;]+\)|[A-Za-z_][A-Za-z0-9_.]*(?:\[[^\]]*\])*)\s+public(?:\s+(?:constant|immutable))*\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)).map(match => {
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
			uint256 poolRepAtFork,
			uint256 escalationRepAtFork,
			uint256 resultingLockedRep
		) external payable {}
		assembly ('memory-safe') {
			let pointer := mload(0x40)
			mstore(pointer, shl(224, 0x408d33da))
			mstore(add(pointer, 0x04), parent)
			mstore(add(pointer, 0x24), migrationProxy)
			mstore(add(pointer, 0x44), sourceGame)
			mstore(add(pointer, 0x64), poolRepAtFork)
			mstore(add(pointer, 0x84), escalationRepAtFork)
			mstore(add(pointer, 0xa4), resultingLockedRep)
			delegatecall(gas(), eventEmitter, pointer, 0xc4, 0, 0)
		}
	`
	const assemblyDelegateCallMetadata = assemblyDelegateCalls[0]
	if (assemblyDelegateCallMetadata === undefined) throw new Error('Expected assembly delegate-call metadata')
	assert.doesNotThrow(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture, assemblyDelegateCallFixture, assemblyDelegateCallMetadata))
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture.replace('0x408d33da', '0x408d33db'), assemblyDelegateCallFixture, assemblyDelegateCallMetadata), /hard-coded selector for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture.replace('0xa4), resultingLockedRep', '0xa4), otherRep'), assemblyDelegateCallFixture, assemblyDelegateCallMetadata), /calldata argument resultingLockedRep for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture.replace('pointer, 0xc4', 'pointer, 0xa4'), assemblyDelegateCallFixture, assemblyDelegateCallMetadata), /calldata length or target for emitForkSnapshotEvents changed/)
	assert.throws(() => assertAssemblyDelegateCall(assemblyDelegateCallFixture, assemblyDelegateCallFixture.replace('uint256 resultingLockedRep', 'address resultingLockedRep'), assemblyDelegateCallMetadata), /entrypoint signatures for emitForkSnapshotEvents changed/)
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
