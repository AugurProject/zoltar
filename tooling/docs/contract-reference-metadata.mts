import { securityPoolContractReference } from './security-pool-contract-reference.mts'

export { eventSourceByName } from './contract-reference-event-sources.mjs'

type Interaction = {
	call: string
	caller: string
	declarations: ContractDeclaration[]
	effect: string
	preconditions: string
	signals: string
}

export type ContractDeclaration = {
	kind?: 'receive'
	name: string
	sourcePath?: string
}

export type ContractReference = {
	compiledAbiFingerprint: string
	delegatedInteractions?: string
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

export type AssemblyDelegateCall = {
	abiSignature: string
	argumentOffsets: Array<{ argument: string; offset: string }>
	calldataLength: string
	selector: string
	sourcePath: string
	targetEntrypointSignature: string
	targetFunctionName: string
	targetSourcePath: string
}

export const outputPath = 'docs/reference/contracts.html'
export const contractPagesDirectory = 'docs/reference/contracts'

export function contractPageOutputPath(contractName: string): string {
	return `${contractPagesDirectory}/${contractName.toLowerCase()}.html`
}
export const expectedProductionSoliditySourceFingerprint = '558961bed36d8853ae910ff32b92cb20366ca2e038b7a2aad2e2e4785a5c5a3e'

export const documentedEventSchemas: Array<{ name: string; parameters: string; sourcePath: string }> = [
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
		sourcePath: 'solidity/contracts/statoblast/interfaces/IERC1155.sol',
	},
	{
		name: 'TransferBatch',
		parameters: 'address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values',
		sourcePath: 'solidity/contracts/statoblast/interfaces/IERC1155.sol',
	},
	{
		name: 'ApprovalForAll',
		parameters: 'address indexed owner,address indexed operator,bool approved',
		sourcePath: 'solidity/contracts/statoblast/interfaces/IERC1155.sol',
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
		name: 'ChildReputationTokenInitialized',
		parameters: 'uint248 indexed universeId,ReputationToken indexed reputationToken,uint256 indexed repNumber',
		sourcePath: 'solidity/contracts/Zoltar.sol',
	},
	{
		name: 'SecurityPoolRegistered',
		parameters: 'bytes32 indexed originId,bytes32 indexed poolId,uint248 indexed universeId,ISecurityPool securityPool',
		sourcePath: 'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol',
	},
	{
		name: 'DeploySecurityPool',
		parameters:
			'ISecurityPool indexed securityPool,UniformPriceDualCapBatchAuction truthAuction,OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer,IShareToken shareToken,ISecurityPool indexed parent,uint248 indexed universeId,uint256 questionId,uint256 statoblastSecurityMultiplierBps,uint256 initialReportPriorityFeeAttoEthPerGas,uint256 currentRetentionRate,uint256 settlementCollateralAttoEth',
		sourcePath: 'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol',
	},
	{
		name: 'ChildPoolLinked',
		parameters: 'ISecurityPool indexed parent,uint256 indexed outcomeIndex,ISecurityPool indexed child,UniformPriceDualCapBatchAuction truthAuction',
		sourcePath: 'solidity/contracts/statoblast/SecurityPoolForker.sol',
	},
	{
		name: 'ChildRepSplit',
		parameters: 'ISecurityPool indexed parent,uint256 indexed outcomeIndex,uint256 childPoolRepSplitAttoRep,uint256 pendingChildAttoRep',
		sourcePath: 'solidity/contracts/statoblast/SecurityPoolForker.sol',
	},
	{
		name: 'ChildDisputeStakedRepMaterialized',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,address indexed childGame,uint256 outcomeIndex,uint256 attoRepAmount,uint256 resultingDisputeStakedRepBalanceAttoRep',
		sourcePath: 'solidity/contracts/statoblast/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'PoolHeldRepSweptToChild',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,uint256 indexed outcomeIndex,uint256 attoRepAmount,uint256 resultingChildPoolHeldRepBalanceAttoRep',
		sourcePath: 'solidity/contracts/statoblast/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'EscalationMigrationEntitlementInitialized',
		parameters: 'ISecurityPool indexed parent,address indexed vault,uint256[3] sourcePrincipalByOutcomeAttoRep,uint256[3] currentRepByOutcomeAttoRep,uint256 totalCurrentAttoRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameForker.sol',
	},
	{
		name: 'EscalationMigrationEntitlementMaterialized',
		parameters: 'ISecurityPool indexed parent,address indexed vault,uint256 indexed childOutcomeIndex,ISecurityPool child,uint256 childAttoRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameForker.sol',
	},
	{ name: 'TheoreticalSupplySet', parameters: 'uint256 totalTheoreticalSupplyAttoRep', sourcePath: 'solidity/contracts/ReputationToken.sol' },
	{
		name: 'ReputationTokenInitialized',
		parameters: 'uint248 indexed universeId,uint256 indexed repNumber,string name,string symbol,uint256 totalTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
	{ name: 'Mint', parameters: 'address indexed account,uint256 valueAttoRep', sourcePath: 'solidity/contracts/ReputationToken.sol' },
	{
		name: 'Burn',
		parameters: 'address indexed account,uint256 valueAttoRep,uint256 totalTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
	{
		name: 'AuthorizationUsed',
		parameters: 'address indexed authorizer,bytes32 indexed nonce',
		sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
	},
	{
		name: 'AuthorizationCanceled',
		parameters: 'address indexed authorizer,bytes32 indexed nonce',
		sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol',
	},
	{
		name: 'AwaitingForkContinuationSet',
		parameters: 'bool awaitingForkContinuation',
		sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol',
	},
	{
		name: 'TotalRepBackingUnitsSet',
		parameters: 'uint256 totalRepBackingUnits',
		sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol',
	},
	{
		name: 'ShareTokenSupplySet',
		parameters: 'uint256 shareTokenSupplyAttoShares',
		sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol',
	},
	{ name: 'SystemStateSet', parameters: 'SystemState systemState', sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol' },
	{
		name: 'VaultEscrowUpdated',
		parameters: 'address indexed vault,uint256 disputeStakedRepByVaultAttoRep,uint256 totalDisputeStakedAttoRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowRecorded',
		parameters: 'address indexed depositor,BinaryOutcomes.BinaryOutcome indexed outcome,uint256 sourcePrincipalTotalAttoRep,uint256 childRepTotalAttoRep,uint256 disputeStakedRepByVaultAttoRep,uint256 totalDisputeStakedAttoRep,uint256 outcomeBalanceAttoRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
	},
	{
		name: 'VaultUnresolvedTotalsExported',
		parameters: 'address indexed vault,address repReceiver,uint256[3] principalByOutcomeAttoRep,uint256 principalToTransferAttoRep,bool transferredRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
	},
	{
		name: 'ForkedEscrowExported',
		parameters: 'address indexed vault,address repReceiver,uint256[3] sourcePrincipalByOutcomeAttoRep,uint256[3] childRepByOutcomeAttoRep,uint256 totalChildRepToTransferAttoRep,bool transferredRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
	},
	{
		name: 'InternalApproval',
		parameters: 'address indexed owner,address indexed spender,address indexed token,uint256 amount',
		sourcePath: 'solidity/contracts/statoblast/openOracle/OpenOracle.sol',
	},
	{
		name: 'DeploymentAddressesSet',
		parameters: 'address[] deploymentAddresses',
		sourcePath: 'solidity/contracts/DeploymentStatusOracle.sol',
	},
]

export const delegateEventDeclarationMirrors: Array<{ name: string; sourcePath: string }> = [
	{ name: 'PoolAccountingCheckpoint', sourcePath: 'solidity/contracts/statoblast/SecurityPoolEventEmitter.sol' },
	{ name: 'VaultAccountingCheckpoint', sourcePath: 'solidity/contracts/statoblast/SecurityPoolEventEmitter.sol' },
	{ name: 'ChildPoolLinked', sourcePath: 'solidity/contracts/statoblast/SecurityPoolForkerVaultMigrationBase.sol' },
	{ name: 'ChildRepSplit', sourcePath: 'solidity/contracts/statoblast/SecurityPoolForkerVaultMigrationBase.sol' },
	{ name: 'ClaimForkedEscalationDepositsToWallet', sourcePath: 'solidity/contracts/statoblast/SecurityPoolForkerVaultMigrationBase.sol' },
]

export const assemblyEventEmissions: Array<{
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
		sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
	},
	{
		dataArguments: 'BinaryOutcomes.BinaryOutcome(outcomeIndex), amountAttoRep, reason, carryTotalAttoRep, _getCurrentNullifierRoot(outcomeIndex), carryRoot',
		indexedArguments: 'parentDepositIndex, sourceNodeId, depositor',
		name: 'CarryDepositConsumed',
		signature: 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)',
		signatureConstant: 'CARRY_DEPOSIT_CONSUMED_SIGNATURE',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
	},
]

export const assemblyDelegateCalls: AssemblyDelegateCall[] = [
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
		sourcePath: 'solidity/contracts/statoblast/SecurityPoolForker.sol',
		targetEntrypointSignature: 'external(ISecurityPool,address,address,uint256,uint256,uint256)',
		targetFunctionName: 'emitForkSnapshotEvents',
		targetSourcePath: 'solidity/contracts/statoblast/SecurityPoolEventEmitter.sol',
	},
]

export const referencedEventAbiFingerprint = '94be605112d124dcf4670e6b61b005d48db3d018da32d82fd6e006ab4476b7a6'

export const entrypointSignaturesBySource: Record<string, Record<string, string[]>> = {
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
		prepareAndSplitMigrationRep: ['external(uint248,uint256,uint256[],uint256)'],
	},
	'solidity/contracts/ReputationToken.sol': {
		burn: ['external(address,uint256)'],
		initialize: ['external(uint248,uint256,uint256)'],
		mint: ['external(address,uint256)'],
	},
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': {
		cancelAuthorization: ['external(address,bytes32,uint8,bytes32,bytes32)'],
		permit: ['external(address,address,uint256,uint256,uint8,bytes32,bytes32)'],
		receiveWithAuthorization: ['external(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
		transferWithAuthorization: ['external(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)'],
	},
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': {
		deployChildSecurityPool: ['external(ISecurityPool,IShareToken,uint248,uint256,uint256,uint256,uint256)'],
		deployOriginSecurityPool: ['external(uint248,uint256,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGame.sol': {
		applyTruthAuctionHaircut: ['external(uint256)'],
		depositRepOnOutcome: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		recordDepositFromSecurityPool: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
		resumeFromFork: ['external()'],
		start: ['external(uint256,uint256)'],
		startFromFork: ['external(uint256,uint256,uint256,BinaryOutcomes.BinaryOutcome,bool,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGameCarry.sol': {
		initializeForkCarrySnapshotWithResolutionBalances: ['external(address,bytes32,bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3],uint256[3],uint256[3],uint256[3],bytes32[3])'],
	},
	'solidity/contracts/statoblast/EscalationGameEscrow.sol': {
		exportForkedEscrowByOutcome: ['external(address,address)'],
		exportForkedEscrowByOutcomeWithoutTransfer: ['external(address)'],
		exportVaultUnresolvedTotals: ['external(address,address)'],
		exportVaultUnresolvedTotalsWithoutTransfer: ['external(address)'],
		recordForkedEscrowForOutcome: ['external(address,BinaryOutcomes.BinaryOutcome,uint256,uint256)'],
	},
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': {
		claimDepositForWinning: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		claimDepositForWinningWithoutTransfer: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		drainAllRep: ['external(address)'],
		exportUnresolvedDeposit: ['public(uint256,BinaryOutcomes.BinaryOutcome)'],
		sweepResidualRepToSecurityPool: ['external()'],
		withdrawDeposit: ['public(CarriedDepositProof,BinaryOutcomes.BinaryOutcome)', 'public(uint256,BinaryOutcomes.BinaryOutcome)'],
	},
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': {
		executeStagedOperation: ['public(uint256)'],
		expireStagedOperation: ['external(uint256)'],
		openOracleCallback: ['external(uint256,uint256,uint256,uint256,address,address)'],
		recoverSettledPendingReport: ['public()'],
		requestPrice: ['public(uint256,uint256,uint256)'],
		requestPriceIfNeededAndStageLiquidation: ['external(address,address,uint256,bytes32,uint256,uint256,uint256,uint256)'],
		requestPriceIfNeededAndStageOperation: ['public(OperationType,address,uint256,uint256,uint256,uint256,uint256)'],
		setLiquidationApprovalRegistry: ['external(LiquidationApprovalRegistry)'],
		setRepEthPrice: ['public(uint256)'],
		setSecurityPool: ['public(ISecurityPool)'],
	},
	'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol': {
		consume: ['external(uint256,uint256)'],
		initialize: ['external(address)'],
		invalidateLiquidationApprovalNonce: ['external(uint256)'],
		permitLiquidationApproval: ['external(LiquidationApprovalParams,bytes)'],
		release: ['external(uint256)'],
		reserve: ['external(uint256,bytes32,address,address,address,uint256,uint256,uint256)'],
		revokeLiquidationApproval: ['external(bytes32)'],
		setLiquidationApproval: ['external(LiquidationApprovalParams)'],
	},
	'solidity/contracts/statoblast/SecurityPool.sol': {
		activateForkMode: ['external()'],
		assignFinalizedAuctionFees: ['external(address,uint256,uint256)'],
		authorizeChildPool: ['external(ISecurityPool)'],
		burnEscalationWinnerHaircut: ['external(uint256)'],
		configureFinalizedAuctionVault: ['external(address,uint256,uint256,uint256,uint256,uint256)'],
		configureVault: ['external(address,uint256,uint256,uint256,uint256,uint256)'],
		setUnderwritingLimit: ['external(uint256)'],
		activateRecoveredCommitment: ['external(address,uint256)'],
		createCompleteSet: ['external()'],
		depositRepToVault: ['external(uint256,uint256)'],
		depositToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
		depositWalletRepToEscalationGame: ['external(BinaryOutcomes.BinaryOutcome,uint256)'],
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
	'solidity/contracts/statoblast/SecurityPoolForker.sol': {
		claimAuctionProceeds: ['external(ISecurityPool,address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		takeOverUnassignedCommitment: ['external(ISecurityPool,uint256)'],
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
	'solidity/contracts/statoblast/UniformPriceDualCapBatchAuction.sol': {
		finalize: ['external()'],
		refundLosingBids: ['external(IUniformPriceDualCapBatchAuction.TickIndex[])'],
		refundLosingBidsFor: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[])'],
		startAuction: ['public(uint256,uint256)'],
		submitBid: ['external(int256)'],
		withdrawBids: ['external(address,IUniformPriceDualCapBatchAuction.TickIndex[],uint256,uint256,uint256)'],
		withdrawPendingEthRefund: ['external()'],
	},
	'solidity/contracts/statoblast/tokens/ShareToken.sol': {
		authorize: ['external(ISecurityPool)'],
		burnCompleteSets: ['external(uint248,address,uint256)'],
		burnTokenIdAndGetRemainingSupply: ['external(uint256,address)'],
		migrate: ['external(uint256,uint256[])'],
		mintCompleteSets: ['external(uint248,address,uint256)'],
	},
	'solidity/contracts/statoblast/tokens/ERC1155.sol': {
		safeBatchTransferFrom: ['external(address,address,uint256[],uint256[])', 'external(address,address,uint256[],uint256[],bytes)'],
		safeTransferFrom: ['external(address,address,uint256,uint256)', 'external(address,address,uint256,uint256,bytes)'],
		setApprovalForAll: ['external(address,bool)'],
	},
}

export const stateChangingAbiFingerprintBySource: Record<string, string> = {
	'solidity/contracts/Context.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/ERC20.sol': '6c4161bf27a2ed1bc2de94b58253a8ec4201e28d125571cb2124238753387a22',
	'solidity/contracts/ReputationToken.sol': '30c2987453109942297ab8ee8256c53fc68cd5c22f9fd16e168cd6bbb12b8608',
	'solidity/contracts/Zoltar.sol': '7820943e20dcb5ea796e2c00af55219042cb772133f0844c8d79dcd2ae30c938',
	'solidity/contracts/ZoltarQuestionData.sol': '904b4369195f070fa3b04bbcbc1acba529810ffa2da4667569cd9168ac568d65',
	'solidity/contracts/statoblast/EscalationGame.sol': '22346007107d60d8dac5545122037fa8bc457ac604c733c03edd992276604e85',
	'solidity/contracts/statoblast/EscalationGameCalculations.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameCarry.sol': 'bdd7cfe47523c5e0c8985eec993214de44caf88fc4f2e6f1586d2d03c0a02ef0',
	'solidity/contracts/statoblast/EscalationGameEscrow.sol': 'c75cd0c9ea134a3bfa03227d0500485049818553447b4b258ff220cb0d201dde',
	'solidity/contracts/statoblast/EscalationGameSettlement.sol': '73f9aad63165cacbff5bd02fd57a6b5a3f73737545018ecdf152c46f905c8c32',
	'solidity/contracts/statoblast/EscalationGameState.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/EscalationGameStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': 'f9a9beff48fc7d1516b4db58430627a2be805c631b2328a4a8c84fab48a1689f',
	'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol': '986a20fc0e4cfe0898be8fc91c6b911b93ef0ae1086d4cb1142a93c66f315684',
	'solidity/contracts/statoblast/SecurityPool.sol': 'd4a3581d8b6cfe40a5a50026237d0967ef28e9239f5f79cb56270a7061170e54',
	'solidity/contracts/statoblast/SecurityPoolForker.sol': 'b885410984916de3e66b38b14532f58e495190f140342045780fba91c0cab6ab',
	'solidity/contracts/statoblast/SecurityPoolForkerBase.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/SecurityPoolForkerStorage.sol': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
	'solidity/contracts/statoblast/UniformPriceDualCapBatchAuction.sol': '7181208a40b17a27a92de234ac9bb59aa1a585e71742cbb1bef7878ae7ffe0ed',
	'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol': '618aed7f3f8bdfd50267b9d7533db3f489f45715f1cd448f5107f67631814d34',
	'solidity/contracts/statoblast/tokens/ERC1155.sol': '7bb87695bc3df8fa177c545209ed58d2e4571c19c869b5598bb0a829e764b218',
	'solidity/contracts/statoblast/tokens/ShareToken.sol': '2a3339ca5db0ccabc2bc10318ff3baf52273b90837f01683d3e5147a13fd2d0d',
	'solidity/contracts/vendor/authorization/ERC20Authorization.sol': '6bfae34f9210ed80f176774eb2b5a3624060ce4be34825ca84949ddcfb8024d2',
}

export const readDeclarationExclusionsBySource: Record<string, string[]> = {
	'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol': ['securityPool'],
	'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol': ['storedGame', 'disputeHistory'],
	'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol': ['securityPool'],
	'solidity/contracts/statoblast/SecurityPool.sol': ['eventEmitter', 'factory', 'operationsDelegate'],
	'solidity/contracts/statoblast/SecurityPoolForkerBase.sol': [],
}

export const contractReferences: ContractReference[] = [
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
		compiledAbiFingerprint: '9aec957d945308eaeaa9a2d497f6a1efefe2253de96b527a02b121a58d9dc2ec',
		name: 'Zoltar',
		purpose: 'Registers universe forks, charges the fork admission haircut, and mints branch-specific child REP.',
		readAbiFingerprint: '888b513263619c6b31966cd009e078c19223641b9c4a6df0909bce3f797e37e2',
		readSurface:
			'Use `universes`, `forkThresholdDivisor`, `forkBurnDivisor`, `zoltarQuestionData`, `genesisReputationToken`, `childReputationTokenCount`, `getForkTime`, `forkQuestionMatches`, `getRepToken`, `getForkThresholdAttoRep`, `getNonDecisionThresholdAttoRep`, `getUniverseTheoreticalSupplyAttoRep`, `getChildUniverseId`, `getDeployedChildUniverses`, `getMigrationRepBalanceAttoRep`, and `getChildMigrationRepAmountsAttoRep` to reconstruct universe and migration state. The child migration getter accepts an array of child universe IDs and returns cumulative amounts in the same order, with zero for unused IDs. The fork threshold is the live universe theoretical supply divided by `forkThresholdDivisor`, rounded up, so every nonzero-supply universe has a positive fork cost. Construction requires a deployed genesis REP token with the REPv2 `getTotalTheoreticalSupply()` selector, theoretical supply from one attoREP through 11 million REP, and `forkBurnDivisor >= 5`, which caps the uncredited fork haircut at 20% of the threshold. Genesis REP uses ordinary ERC-20 approvals because the configured mainnet REPv2 token does not implement ERC-2612 or ERC-3009.',
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
			{ name: 'getChildMigrationRepAmountsAttoRep' },
		],
		readStorageDeclarations: [{ name: 'universes' }, { name: 'forkThresholdDivisor' }, { name: 'forkBurnDivisor' }, { name: 'zoltarQuestionData' }, { name: 'genesisReputationToken' }, { name: 'childReputationTokenCount' }],
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
				signals: '`TheoreticalSupplySet`, `ReputationTokenInitialized`, `DeployChild`, and `ChildReputationTokenInitialized`',
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
				call: '`prepareAndSplitMigrationRep`(`universeId`, `amountAttoRep`, `outcomeIndexes`, `preparationAttoRep`)',
				caller: 'Parent REP holder',
				effect:
					'Adds the supplied preparation amount to migration credit, then splits the requested REP into the supplied outcomes using the existing migration checks. Both steps revert together on failure. Callers compute any preparation shortfall from cumulative child migration amounts, rather than current child token holdings.',
				declarations: [{ name: 'prepareAndSplitMigrationRep' }],
				preconditions: 'Forked universe; positive split amount; nonempty valid outcomes; sufficient parent REP for the exact preparationAttoRep supplied and sufficient migration credit for every split. Outcome order is unrestricted. Genesis REP requires allowance for preparation; child REP needs no allowance.',
				signals: '`MigrationRepAdded` when preparationAttoRep is positive; `DeployChild` and `ChildReputationTokenInitialized` when children are deployed; child REP `Transfer`, `Mint`, and `MigrationRepSplit` for each destination',
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
		compiledAbiFingerprint: 'c870ce39465c90820caef827233163f7898f339aba3563d29b7014e60da28687',
		name: 'ReputationToken',
		purpose: 'Implements universe-specific ERC-20 REP, ERC-2612 permits, and ERC-3009 transfers while enforcing the supply ceiling maintained by Zoltar.',
		readAbiFingerprint: '1cedbd5efbd60e56cb8f88586096eba913a58cbf7fc5d9908649ea4cc8a0658b',
		readSurface: 'Use `getTotalTheoreticalSupply`, `zoltar`, `universeId`, `repNumber`, the standard ERC-20 `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, and `allowance` reads, and authorization reads `nonces`, `DOMAIN_SEPARATOR`, and `authorizationState`.',
		readDeclarations: [
			{ name: 'getTotalTheoreticalSupply' },
			{ name: 'name', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'symbol', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'decimals', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'totalSupply', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'balanceOf', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'allowance', sourcePath: 'solidity/contracts/ERC20.sol' },
			{ name: 'nonces', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' },
			{ name: 'DOMAIN_SEPARATOR', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' },
			{ name: 'authorizationState', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' },
		],
		readStorageDeclarations: [{ name: 'zoltar' }, { name: 'universeId' }, { name: 'repNumber' }],
		sourcePath: 'solidity/contracts/ReputationToken.sol',
		interactions: [
			{
				call: '`initialize(universeId, totalTheoreticalSupplyAttoRep, repNumber)`',
				caller: '`Zoltar` only',
				effect: 'Atomically assigns the child universe, global display sequence, name, symbol, and theoretical-supply ceiling used to bound migration mints.',
				declarations: [{ name: 'initialize' }],
				preconditions: 'Called once by Zoltar as part of child-universe creation; universe, REP number, and theoretical supply are nonzero; supply does not exceed 11 million REP.',
				signals: '`TheoreticalSupplySet` and `ReputationTokenInitialized`',
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
			{
				call: '`permit(owner, spender, value, deadline, v, r, s)`',
				caller: "Anyone presenting the owner's valid ERC-2612 signature",
				effect: "Sets the signed allowance and advances the owner's permit nonce.",
				declarations: [{ name: 'permit', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' }],
				preconditions: 'Deadline has not passed; signature matches the current chain, token domain, owner, spender, value, and nonce.',
				signals: '`Approval`',
			},
			{
				call: '`transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`',
				caller: "Anyone presenting the source's valid ERC-3009 signature",
				effect: 'Consumes the authorization nonce and transfers the exact signed amount to the signed recipient.',
				declarations: [{ name: 'transferWithAuthorization', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' }],
				preconditions: 'The strict validity window is open; the nonce is unused; signature fields and source balance are valid.',
				signals: '`AuthorizationUsed` and `Transfer`',
			},
			{
				call: '`receiveWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`',
				caller: "The signed recipient presenting the source's valid ERC-3009 signature",
				effect: 'Consumes the authorization nonce and transfers the exact signed amount to the caller-bound recipient.',
				declarations: [{ name: 'receiveWithAuthorization', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' }],
				preconditions: 'Caller equals the signed recipient; the strict validity window is open; the nonce is unused; signature fields and source balance are valid.',
				signals: '`AuthorizationUsed` and `Transfer`',
			},
			{
				call: '`cancelAuthorization(authorizer, nonce, v, r, s)`',
				caller: "Anyone presenting the authorizer's valid ERC-3009 cancellation signature",
				effect: 'Marks the authorization nonce as consumed without transferring tokens.',
				declarations: [{ name: 'cancelAuthorization', sourcePath: 'solidity/contracts/vendor/authorization/ERC20Authorization.sol' }],
				preconditions: 'The nonce is unused and the cancellation signature matches the authorizer.',
				signals: '`AuthorizationCanceled`',
			},
		],
	},
	{
		compiledAbiFingerprint: 'dfa5b4220b8af292e9baab0368a41aa262a096468444fd5b7f2575908a5551e8',
		name: 'SecurityPoolFactory',
		purpose: 'Creates and canonically registers origin and child security pools with their share token, oracle coordinator, and optional Truth Auction.',
		readAbiFingerprint: 'ee2532194c63d917a4665729c7456b2905cf62bfd69555cb023d1c7e00566473',
		readSurface:
			'Use `minimumSecurityBondDebtAttoEth` and `minimumVaultRepDepositAttoRep` for immutable deployment floors. Each pool derives its effective escalation deposit directly from its REP token at construction as `max(1 REP, theoretical REP supply / 10,000,000)`. A zero configured vault REP floor selects the default `theoretical REP supply / 100,000`; a nonzero constructor value is the exact override. The security-bond debt floor defaults to 1 ETH. Construction rejects a zero or code-less operations delegate. Use `securityPoolDeploymentCount` with the strict `securityPoolDeploymentsRange(startIndex, count)` pager, which reverts rather than truncating when the requested range exceeds the array. Use `getOriginId`, `getPoolId`, `getSecurityPool`, `getSecurityPoolOriginId`, and `getSecurityPoolHasInheritedForkOutcome` for canonical lookup.',
		readDeclarations: [{ name: 'securityPoolDeploymentCount' }, { name: 'securityPoolDeploymentsRange' }, { name: 'getOriginId' }, { name: 'getPoolId' }, { name: 'getSecurityPool' }, { name: 'getSecurityPoolOriginId' }, { name: 'getSecurityPoolHasInheritedForkOutcome' }],
		readStorageDeclarations: [{ name: 'minimumSecurityBondDebtAttoEth' }, { name: 'minimumVaultRepDepositAttoRep' }],
		sourcePath: 'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol',
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
				effect: 'Creates and registers a canonical child pool with a coordinator that inherits `initialReportPriorityFeeAttoEthPerGas` from the parent coordinator and a forker-owned Truth Auction, while retaining the parent lineage share token.',
				declarations: [{ name: 'deployChildSecurityPool' }],
				preconditions: 'Parent is the canonical pool for its lineage; supplied share token equals the parent share token; target origin/universe slot is unclaimed; deployment arguments satisfy downstream constructors and wiring.',
				signals: '`SecurityPoolRegistered`, then `DeploySecurityPool`',
			},
		],
	},
	securityPoolContractReference,
	{
		compiledAbiFingerprint: 'c34478103a1804c8de4dcbcd49690e8864d3ca9afc9148d2bea9d5fbf5ccae3d',
		name: 'SecurityPoolForker',
		purpose: 'Freezes parent pools, creates selected child pools, migrates vault and escalation state, and settles collateral-repair auctions.',
		readAbiFingerprint: '278455ca0fe2ccf4ffe8682e913ee946cea32e3e54c70dd59e803e121dd140c1',
		readSurface:
			'Use `zoltar`, `forkData`, `getUnassignedPosition`, `isEscalationDepositClaimedDirectly`, `getEscalationDepositId`, `getDirectlyClaimedEscalationPrincipal`, `isEscalationWinnerHaircutPaidByFork`, `getEscalationMigrationEntitlementStatus`, `getOwnForkRepBuckets`, `getOwnForkMigrationStatus`, `getMigrationProxyAddress`, `getQuestionOutcome`, `attoRepToBackingUnits`, and `backingUnitsToAttoRep` to reconstruct fork progress and preview migration conversions. `forkData` includes cumulative migrated REP and the fork-activation timestamp. `getUnassignedPosition` returns pending REP backing units, capacity ownership, raw auction bad debt, that debt’s generation, and the auction-finalization fee index; consumers count the debt only while its generation equals the pool snapshot’s current `badDebtGeneration`.',
		readDeclarations: [
			{ name: 'forkData' },
			{ name: 'getUnassignedPosition' },
			{ name: 'isEscalationDepositClaimedDirectly' },
			{ name: 'getEscalationDepositId' },
			{ name: 'getDirectlyClaimedEscalationPrincipal' },
			{ name: 'isEscalationWinnerHaircutPaidByFork' },
			{ name: 'getEscalationMigrationEntitlementStatus' },
			{ name: 'getOwnForkRepBuckets' },
			{ name: 'getOwnForkMigrationStatus' },
			{ name: 'getMigrationProxyAddress' },
			{ name: 'getQuestionOutcome' },
			{ name: 'attoRepToBackingUnits', sourcePath: 'solidity/contracts/statoblast/SecurityPoolForkerBase.sol' },
			{ name: 'backingUnitsToAttoRep', sourcePath: 'solidity/contracts/statoblast/SecurityPoolForkerBase.sol' },
		],
		readStorageDeclarations: [{ name: 'zoltar', sourcePath: 'solidity/contracts/statoblast/SecurityPoolForkerBase.sol' }],
		securityBoundaryHeading: 'Child-game trust boundary',
		securityBoundary:
			'Fork entrypoints and child setup may receive contracts through unauthenticated pool lineages. External-universe initiation requires the supplied pool to be authorized by its declared share token, but that relationship alone does not prove factory registration; own-game initiation does not perform that authorization check. Canonicality comes from the configured `SecurityPoolFactory` registry. A game relationship check is point-in-time: the reported nonzero game address must return the supplied pool or child from `securityPool()` when validated. This does not prove that an arbitrary game getter is immutable or that the address was factory-deployed. Child setup captures one reported game address, validates it before privileged use, and reuses that exact address for continuation backing and escrow work. When unresolved escalation requires a continuation and setup initially reports no game, initialization creates one; the forker then captures and validates it before continuation use. Combined vault migration passes the captured child/game pair into unresolved cleanup without reading the child getter again. Truth-auction completion performs a fresh point-in-time validation of the game reported then before checking continuation readiness. Genuine factory-deployed `EscalationGame` instances store their pool immutably, but safety on unauthenticated paths does not assume arbitrary contracts do.',
		sourcePath: 'solidity/contracts/statoblast/SecurityPoolForker.sol',
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
					"Converts the caller's parent REP backing-unit claim to REP at the fork snapshot and credits that REP amount as child-local backing units; transfers the standing ETH underwriting limit and any tracked vault bad debt into one child pool; checkpoints but retains claimable fees in the parent vault; and separately routes proportional pool-level settlement collateral while preserving aggregate bad debt. The standing ETH limit migrates separately from REP backing. Repeat calls can have no additional REP backing units, capacity ownership, or vault bad debt to move.",
				preconditions: "Migration window open; the selected child's reported nonzero escalation game passes the [child-game trust boundary](#child-game-trust-boundary). The optional unresolved parent escalation-deposit accounting cleanup wrapper calls this function first to migrate transferable vault state.",
				signals: '`VaultBadDebtMigrated` and `VaultMigrationCheckpoint`',
			},
			{
				call: '`migrateVaultWithUnresolvedEscalation(securityPool, vault, childOutcomeIndex)`',
				caller: 'The named vault owner',
				effect:
					"First runs ordinary migration for the same vault, which may convert its parent REP backing-unit claim to REP and credit that REP as child-local backing units; transfer capacity ownership and vault bad debt to the selected child while preserving aggregate bad debt; checkpoint but retain claimable fees in the parent vault; and separately route proportional pool-level settlement collateral. The standing ETH limit migrates separately from REP backing. It returns the selected child and its captured, validated escalation game to the unresolved-accounting cleanup phase, which reuses those exact addresses without reading the child's game again. The cleanup then clears that vault's unresolved parent escalation-deposit accounting in constant-size work and records it; the cleanup neither funds dispute-staked REP backing nor authorizes carried proofs.",
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
				effect:
					'Finalizes the ended auction, accounts migration-routed settlement collateral plus accepted bid ETH, and records every unmigrated REP backing unit, capacity unit, and proportional bad debt in an explicit nonwithdrawable unassigned position. It activates the child and saves the fee index. For positive existing-owner REP residue, total backing units are P × H / (H − Q), rounded up to a whole unit, where P is fork-time pool-held REP for all existing owners including unmigrated vault owners, H is finalization pool-held REP including sold escrow REP, and Q is purchased REP. The bidder backing-unit budget is total units minus P. If H − Q is zero, bidder units use H × PRICE_PRECISION (1e18) while migrated units remain in the total. Capacity ownership has a separate budget. Positive-purchase auction ownership becomes fee eligible immediately; after a zero-purchase auction, the unassigned capacity remains outside fee eligibility. A nonzero repair contribution is rejected.',
				declarations: [{ name: 'finalizeTruthAuction' }],
				preconditions:
					'Truth Auction started, its one-week window has passed, and `msg.value` is zero. Actual child ETH covers the installed settlement collateral plus accrued fee liabilities. Installing these inherited liabilities does not require current REP capacity or backing. If unresolved escalation existed at fork, the game reported at completion passes the [child-game trust boundary](#child-game-trust-boundary).',
				signals: '`TruthAuctionFinalized`, auction `AuctionFinalized`, and pool accounting checkpoints; `TruthAuctionHaircutApplied` when purchased REP removes a positive escalation allocation; `ForkContinuationResumed` for an unresolved continuation',
			},
			{
				call: '`settleAuctionBids(securityPool, vault, claimTickIndices, refundTickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'settleAuctionBids' }],
				effect:
					"Before finalization, settles only provably losing bids. After finalization, combines claim and refund indexes into one settlement withdrawal and transfers each claim's proportional REP backing units, capacity ownership, and finalization-to-claim fees from the unassigned position to the bidder vault. Its bad-debt share transfers only while the auction's recorded debt generation is still current; after those collateral claims are exhausted, the old debt expires while raw claimed-auction counters continue to settle deterministically. Capacity and bad-debt division dust follows each bid's deterministic cumulative ETH position, so claim order cannot change individual or aggregate settlement. The transfer does not change total capacity, fee eligibility, active open interest, total bad debt, retention, or aggregate accrued fees. A winning dust bid may receive capacity ownership even when its REP allocation rounds to zero. The call's aggregate positive refund is credited to the named bidder's pull-payment balance without calling recipient code.",
				preconditions: 'At least one index; before finalization the claim list must be empty and refund indexes must be eligible; after finalization all indexes must belong to the named vault owner and remain unsettled.',
				signals:
					'Underlying auction `BidSettled`; one aggregate `EthRefundCredited` per call when total credited ETH is positive; `ClaimAuctionProceeds` when REP backing, capacity ownership, or raw auction bad-debt settlement advances. Its cumulative claimed and total auctioned bad-debt fields are raw counters; effective vault debt still requires the recorded auction generation to match the pool’s current generation',
			},
			{
				call: '`takeOverUnassignedCommitment(securityPool, maximumCommitmentAttoEth)`',
				caller: 'Receiving vault owner',
				declarations: [{ name: 'takeOverUnassignedCommitment' }],
				effect: 'Assigns all residual ETH commitment and unassigned REP backing from a finalized zero-purchase auction to the caller. Conserves total commitments and backing units. Preserves earned fees and starts recovered fee rights at the takeover checkpoint.',
				preconditions: 'Positive residual commitment within the caller’s explicit maximum; no auction purchases; fresh price; operational, unforked pool; receiver fully backs its entire resulting limit. Sold entitlements are never available for takeover.',
				signals: '`UnassignedCommitmentTakenOver` and vault/pool accounting checkpoints',
			},
			{
				call: '`claimAuctionProceeds(securityPool, vault, tickIndices)`',
				caller: 'Anyone on behalf of the named bidder vault',
				declarations: [{ name: 'claimAuctionProceeds' }],
				effect:
					"For a nonempty list, withdraws finalized bid settlements and transfers each claim's proportional REP backing units, capacity ownership, and finalization-to-claim fees from the unassigned position to the bidder vault. Its bad-debt share transfers only while the auction's recorded debt generation is still current; after those collateral claims are exhausted, the old debt expires while raw claimed-auction counters continue to settle deterministically. Capacity and bad-debt division dust follows each bid's deterministic cumulative ETH position, so claim order cannot change individual or aggregate settlement. The transfer does not change total capacity, fee eligibility, active open interest, total bad debt, retention, or aggregate accrued fees. A winning dust bid can receive positive capacity ownership when its REP allocation rounds to zero. The call's aggregate positive refund is credited to the named bidder's pull-payment balance without calling recipient code. For an empty list, the wrapper exits after the finalization guard without validating bids or the named beneficiary, changing state, or emitting events.",
				preconditions: 'Auction finalized. A nonempty list additionally requires every index to belong to the named vault owner and remain unsettled.',
				signals:
					'For processed bids, underlying auction `BidSettled`; one aggregate `EthRefundCredited` per call when total credited ETH is positive; `ClaimAuctionProceeds` when REP backing, capacity ownership, or raw auction bad-debt settlement advances. Its cumulative claimed and total auctioned bad-debt fields are raw counters; effective vault debt still requires the recorded auction generation to match the pool’s current generation; no event for an empty list',
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
				caller: 'A child-pool Truth Auction trusted by this forker during `ChildPoolLinked`',
				effect: 'Accepts auction ETH during forker-controlled auction finalization.',
				declarations: [{ kind: 'receive', name: 'receive' }],
				preconditions: '`trustedAuctionAddresses[msg.sender]` was set when the forker linked the child and emitted `ChildPoolLinked`; configured-factory registration determines whether that lineage is canonical.',
				signals: 'No dedicated receive event; auction `AuctionFinalized` is followed by forker `TruthAuctionFinalized` and pool accounting checkpoints',
			},
		],
	},
	{
		compiledAbiFingerprint: '0cd67689ccaf5934b894e93259c66b744503d45986e0bca94f3ba978908a86c9',
		name: 'EscalationGame',
		purpose: 'Escrows outcome REP, raises the running resolution cost, detects non-decision, and settles local or carried deposits.',
		readAbiFingerprint: '758abbd7c7c8651a4529ea9dd79049f8eb134075cde6fa80042ad2ec3151a30b',
		readSurface:
			'Base getters are `securityPool`, `repToken`, `activationTime`, `nonDecisionThresholdAttoRep`, `startBondAttoRep`, `nonDecisionTimestamp`, `nonDecisionState`, `forkContinuation`, `forkElapsedAtStart`, `forkResumedAt`, `fixedQuestionOutcome`, `nodes`, `disputeStakedRepByVaultAttoRep`, `totalDisputeStakedAttoRep`, `truthAuctionRepBeforeAttoRep`, and `truthAuctionRepRemainingAttoRep`. The claim delegate fallback exposes `rootClaimSourceGame`, `getInheritedClaimAllocation`, and `getUnresolvedClaimInterval`. The allocation read returns source principal, retained principal, reward-interval length, and the cumulative reward endpoint after per-generation auction rounding. The reward interval is the deposit’s range within its outcome’s cumulative deposits: its start is the returned endpoint minus the returned length. It determines which portion enters the reward calculation; the length is not a payable reward. Exported principal intervals compact consumed prefixes, while reward positions remain unshifted by prior claims. Allocations within a game stay fixed in every claim order. `disputeStakedRepByVaultAttoRep` is locally attributed current-game escrow used for health; inherited carry remains aggregate commitment state until proof settlement. Use `previewDepositOnOutcome`, `computeIterativeAttritionCostAttoRep`, `computeTimeSinceStartFromAttritionCostAttoRep`, `totalCostAttoRep`, `getEscalationGameEndDate`, `getQuestionResolution`, `getFinalQuestionResolution`, `hasReachedNonDecision`, `canTriggerOwnFork`, `getBindingCapitalAttoRep`, `getOutcomeBalancesAttoRep`, `getDepositsByOutcome`, `getDepositsByOutcomeLength`, `forkCarrySnapshotInitialized`, `getOutcomeState`, `getForkCarrySnapshot`, `getForkCarryRoots`, `isForkCarryFundingComplete`, `getCarryLeafPageByOutcome`, `getProofConsumedCarriedDepositIndexesByOutcome`, `getLocalUnresolvedPrincipalByVaultAndOutcome`, and `getForkedEscrowByVaultAndOutcome` for calculations, lifecycle authorization, pages, carry state, and escrow. Vault-funded deposits and all withdrawals route through `SecurityPool`; after an ordinary game starts, wallet-funded deposits use `depositRepOnOutcome` and mint no pool backing units.',
		readDeclarations: [
			{ name: 'previewDepositOnOutcome' },
			{ name: 'disputeStakedRepByVaultAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol' },
			{ name: 'rootClaimSourceGame', sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol' },
			{ name: 'getInheritedClaimAllocation', sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol' },
			{ name: 'getUnresolvedClaimInterval', sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol' },
			{ name: 'computeIterativeAttritionCostAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'computeTimeSinceStartFromAttritionCostAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'totalCostAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'getEscalationGameEndDate', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'getQuestionResolution', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'getFinalQuestionResolution', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'hasReachedNonDecision', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'canTriggerOwnFork', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'getBindingCapitalAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'getOutcomeBalancesAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol' },
			{ name: 'getDepositsByOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' },
			{ name: 'getDepositsByOutcomeLength', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' },
			{ name: 'forkCarrySnapshotInitialized', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'getOutcomeState', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'getForkCarrySnapshot', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'getForkCarryRoots', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'isForkCarryFundingComplete', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'getCarryLeafPageByOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'getProofConsumedCarriedDepositIndexesByOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' },
			{ name: 'getLocalUnresolvedPrincipalByVaultAndOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' },
			{ name: 'getForkedEscrowByVaultAndOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' },
		],
		readStorageDeclarations: [
			{ name: 'securityPool', sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol' },
			{ name: 'repToken', sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol' },
			{ name: 'activationTime', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'nonDecisionThresholdAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'startBondAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'nonDecisionTimestamp', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'nonDecisionState', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'forkContinuation', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'forkElapsedAtStart', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'forkResumedAt', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'nodes', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'totalDisputeStakedAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'truthAuctionRepBeforeAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'truthAuctionRepRemainingAttoRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
			{ name: 'fixedQuestionOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol' },
		],
		sourcePath: 'solidity/contracts/statoblast/EscalationGame.sol',
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
				call: '`applyTruthAuctionHaircut(repToRemoveAttoRep)`',
				caller: "The child pool's `SecurityPoolForker` only",
				declarations: [{ name: 'applyTruthAuctionHaircut' }],
				effect:
					'Transfers sold REP to the pool, proportionally reduces escrow and outcome balances, and rebases curve time. If an unfixed continuation inherited two threshold-full outcome balances and the haircut leaves them below the current game threshold, ordinary pool-mediated deposit checks apply after the pool resumes the game. Fixed outcomes and local non-decisions retain their state. The game stays paused until the pool resumes it.',
				preconditions: "Paused fork continuation; no prior auction haircut; the requested amount is below the game's live REP balance.",
				signals: '`TruthAuctionHaircutApplied` and REP `Transfer`; `InheritedThresholdTieReopened` when an unfixed inherited tie reopens',
			},
			{
				call: '`depositRepOnOutcome(outcome, maximumDepositAttoRep)`',
				caller: 'Any REP holder',
				effect: 'Transfers the accepted REP directly from the caller into dispute escrow, appends a local deposit, and records its carry leaf without minting pool backing units.',
				declarations: [{ name: 'depositRepOnOutcome' }],
				preconditions: "Current game is the pool's ordinary unresolved game; pool operational; universe unforked; outcome non-`None`; caller allowance to this game covers the accepted REP; preview accepts a positive amount within the remaining threshold room.",
				signals: '`LocalDepositAppended`, `DepositOnOutcome`, REP `Transfer`, optionally `NonDecisionReached`',
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
				declarations: [{ name: 'withdrawDeposit', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				effect: "Consumes one local deposit after resolution. A winner pays the deposit's immutable depositor after its haircut; a loser only retires its escrow accounting.",
				preconditions: 'Explicit non-decision state is `None`; non-`None` supplied outcome; game final; game and pool final outcomes match; valid unsettled local deposit index.',
				signals: '`CarryDepositConsumed` and `VaultEscrowUpdated`; for a winner, `ClaimDeposit`, positive REP payout `Transfer`, and haircut burn signals when nonzero',
			},
			{
				call: '`initializeForkCarrySnapshotWithResolutionBalances(...)`',
				caller: 'Owning `SecurityPool` only',
				declarations: [{ name: 'initializeForkCarrySnapshotWithResolutionBalances', sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol' }],
				effect: 'Installs the immutable inherited peaks, leaf counts, carry totals, resolution balances, and normalized nullifier roots; zero snapshot ID selects the computed ID. Two or more threshold-full inherited balances set `nonDecisionState` to `InheritedThresholdTie` without creating a local timestamp.',
				preconditions: 'Fork-continuation mode; no prior snapshot; each leaf count fits the MMR; supplied nonzero snapshot ID equals the hash of the normalized data.',
				signals: '`ForkCarryCheckpoint`; additionally `InheritedThresholdTie` when the installed balances meet the non-decision threshold',
			},
			{
				call: '`claimDepositForWinning(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'claimDepositForWinning', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				effect: "Consumes a selected local deposit as a winner, consumes its vault escrow, burns the computed haircut when nonzero, and transfers the remaining positive REP payout to the deposit's immutable depositor.",
				preconditions: 'Non-`None` supplied outcome and valid unsettled local deposit with sufficient escrow. This entrypoint itself does not check final resolution or that the supplied outcome won; its trusted caller selects that path.',
				signals: '`CarryDepositConsumed`, `VaultEscrowUpdated`, `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and haircut burn signals only when their amounts are positive',
			},
			{
				call: '`claimDepositForWinningWithoutTransfer(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'claimDepositForWinningWithoutTransfer', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				effect:
					"Consumes a selected local deposit and its vault escrow. The depositor's raw escrow backing decreases by the inverse-retention claim units corresponding to the deposit's original principal: the principal itself with no local auction checkpoint, or `⌈originalPrincipal × truthAuctionRepBeforeAttoRep / truthAuctionRepRemainingAttoRep⌉` after a local haircut. Other unconsumed deposits by the same depositor remain backed. The game returns the computed winner amount to the trusted caller but deliberately neither transfers REP nor burns the computed haircut.",
				preconditions: 'Valid in-range supplied outcome and unsettled local deposit with sufficient escrow. Unlike the transferring form, it has no explicit non-`None` guard; neither form checks final resolution or that the outcome won.',
				signals: '`CarryDepositConsumed`, `VaultEscrowUpdated`, and `ClaimDeposit` with `transferredRep = false`; no REP transfer or haircut burn',
			},
			{
				call: '`exportUnresolvedDeposit(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportUnresolvedDeposit', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				effect: 'Returns deposit identity and amount to the trusted caller while consuming the local deposit from unresolved/escrow accounting without transferring REP.',
				preconditions: 'Non-`None` outcome and a valid unsettled local deposit. Final resolution is not required.',
				signals: '`CarryDepositConsumed` and `VaultEscrowUpdated`; no `ClaimDeposit` or REP transfer',
			},
			{
				call: '`withdrawDeposit(CarriedDepositProof proof, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'withdrawDeposit', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				effect: 'Consumes an inherited proof, transfers any positive winning payout, and burns the positive haircut unless the fork already paid it.',
				preconditions: 'Non-`None` supplied outcome; game final and matching the pool final outcome; supplied outcome is the winner; parent deposit was not directly claimed; valid unconsumed Merkle/nullifier proof.',
				signals: '`CarryDepositConsumed` and `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and haircut burn signals only when positive',
			},
			{
				call: '`exportVaultUnresolvedTotals(vault, repReceiver)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportVaultUnresolvedTotals', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' }],
				effect: "Marks the vault's local unresolved totals exported exactly once, clears each outcome amount, consumes aggregate unresolved and escrow accounting when positive, and transfers the positive total to `repReceiver`.",
				preconditions: '`vault` is nonzero and has not exported before. There is no explicit nonzero-receiver guard: a zero receiver succeeds when the total is zero but the token rejects it when a positive transfer is attempted.',
				signals: 'Always `VaultUnresolvedTotalsExported`, including when every amount is zero; `VaultEscrowUpdated` and REP `Transfer` only for a positive total',
			},
			{
				call: '`exportVaultUnresolvedTotalsWithoutTransfer(vault)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportVaultUnresolvedTotalsWithoutTransfer', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' }],
				effect: "Marks the vault's local unresolved totals exported exactly once, clears each outcome amount, and consumes aggregate unresolved and escrow accounting when positive, but leaves token movement to its caller.",
				preconditions: '`vault` is nonzero and has not exported before.',
				signals: 'Always `VaultUnresolvedTotalsExported` with `transferredRep = false`, including when every amount is zero; `VaultEscrowUpdated` only for a positive total; no REP transfer',
			},
			{
				call: '`drainAllRep(receiver)`',
				caller: 'Owning `SecurityPool` only',
				declarations: [{ name: 'drainAllRep', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				effect: "Transfers the game's full REP balance to `receiver`. A zero balance returns zero without a transfer or event.",
				preconditions: '`receiver` is nonzero; no positive-balance requirement. The protocol reaches this call from the owning pool after `activateForkMode` enters `PoolForked`.',
				signals: 'REP `Transfer` for a positive balance; no event at zero balance',
			},
			{
				call: '`recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'recordForkedEscrowForOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' }],
				effect:
					'Accumulates source principal and child REP escrow for the depositor and outcome. The depositor remains the immutable payout owner; inherited claims remain in the carry commitment and are not copied into child-local ownership state. When both amounts are zero, returns without changing state or emitting an event.',
				preconditions: 'Outcome is not `None`; depositor is nonzero. Source principal and child REP may independently be zero; when both are zero, the call is a no-op.',
				signals: '`ForkedEscrowRecorded` for a nonzero record; no event when both amounts are zero',
			},
			{
				call: '`exportForkedEscrowByOutcome(vault, repReceiver)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportForkedEscrowByOutcome', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' }],
				effect: 'Marks every remaining per-outcome escrow amount exported and transfers its positive child REP. When all outcomes were already empty or exported, returns zero arrays without state change, token transfer, or event.',
				preconditions: '`vault` and `repReceiver` are nonzero.',
				signals: '`ForkedEscrowExported` when any source principal or child REP remains; REP `Transfer` when positive child REP is transferred; no event for an already-empty export',
			},
			{
				call: '`exportForkedEscrowByOutcomeWithoutTransfer(vault)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [{ name: 'exportForkedEscrowByOutcomeWithoutTransfer', sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol' }],
				effect: 'Marks every remaining per-outcome escrow amount exported without transferring child REP. When all outcomes were already empty or exported, returns zero arrays without state change or event.',
				preconditions: '`vault` is nonzero.',
				signals: '`ForkedEscrowExported` with `transferredRep = false` when any source principal or child REP remains; no REP transfer; no event for an already-empty export',
			},
			{
				call: '`sweepResidualRepToSecurityPool()`',
				caller: 'Anyone',
				effect: 'Returns ordinary-game residual REP to the owning pool. Burns fork-continuation residual so pre-child capital cannot accrue to late or nonexistent child owners.',
				declarations: [{ name: 'sweepResidualRepToSecurityPool', sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol' }],
				preconditions: 'Final outcome; no unresolved principal; no vault escrow; positive residual balance.',
				signals: '`ResidualRepSweptToSecurityPool` for an ordinary game; `ForkContinuationResidualRepBurned` for a fork continuation',
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
		sourcePath: 'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol',
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
		compiledAbiFingerprint: 'e222525f15557c99f8a34e6e479a760fc30845d5cefd438c5f879f82cf7c085d',
		name: 'OpenOraclePriceCoordinator',
		purpose: 'Obtains a fresh REP-per-ETH price and coordinates withdrawals, delegated liquidation routing, approval reservations, and terminal cleanup.',
		readAbiFingerprint: '288a73d13de5a0f593226105eb11eb177bf085ac2ee708a31645c3d7c4eb7237',
		readSurface:
			'Configuration getters are `MAX_PENDING_SETTLEMENT_OPERATIONS`, `OPEN_INTEREST_DIVIDER`, `reputationToken`, `securityPool`, `openOracle`, `weth`, `liquidationApprovalRegistry`, `gasConsumedOpenOracleReportPrice`, `gasConsumedSettlement`, `gasUnitsForOneDispute`, `initialReportPriorityFeeAttoEthPerGas`, `targetPriceErrorForDispute`, `openOracleSecurityMultiplierBps`, `settlementTime`, `disputeDelay`, `protocolFee`, `feePercentage`, `multiplier`, `timeType`, `trackDisputes`, `protocolFeeRecipient`, `escalationHaltMultiplierBps`, `maxSettlementBaseFeeMultiplierBps`, and `minLiquidationPriceDistanceBps`. Current report and operation getters are `pendingReportId`, `pendingReportSponsor`, `pendingOperationSlotId`, `lastSettlementTimestamp`, `lastPrice`, `pendingReportMaxSettlementBaseFeeAttoEthPerGas`, `stagedOperationCounter`, and `stagedOperations`. `lastSettlementTimestamp` records when the accepted final report reached settlement eligibility (report timestamp plus `settlementTime`), not when `settle` was called, and `isPriceValid` measures freshness from it. Use `isPriceValid`, `minimumToken1ReportAttoEth`, `getRequestPriceCostAttoEth`, `getQueuedOperationCostAttoEth`, `getSettlementCallbackGasLimit`, `getPendingOperationSlot`, `getActiveStagedOperationCount`, `getActiveStagedOperations`, `getPendingSettlementOperationCount`, and `getPendingSettlementOperationIds` for derived or paged state.',
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
		sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol',
		interactions: [
			{
				call: '`requestPriceIfNeededAndStageLiquidation(targetVault, receiverVault, requestedDebtAttoEth, approvalId, ..., bountyAttoEth)`',
				caller: 'Liquidation operator; a delegated receiver must have approved this exact operator',
				effect:
					'Stages explicit operator, receiver, target backing, and target capacity ownership and reserves bounded receiver quota before any oracle work. The queue event retains the full historical observation for indexing, while live execution inputs are not duplicated in persistent operation storage. The self-receiving operator path uses a zero approval ID.',
				declarations: [{ name: 'requestPriceIfNeededAndStageLiquidation' }],
				preconditions: 'Receiver differs from target; delegated approval matches pool, receiver, operator, and target scope, has available cumulative and per-operation quota, and remains valid through latest execution.',
				signals: '`LiquidationRouteStaged`; `LiquidationApprovalReserved` on a delegated route; staged-operation lifecycle events',
			},
			{
				call: '`requestPriceIfNeededAndStageOperation(...)` with funding when stale',
				caller: 'Vault owner for self withdrawal or a target change; self-receiving liquidation callers are also supported. While a report is pending, only that report sponsor may stage more operations.',
				effect:
					'Records the operation (`0` transferred commitment in attoETH, `1` withdrawal in attoREP, `2` absolute standing underwriting limit in attoETH), executes immediately with a fresh price, or attaches it to a bounded pending settlement batch and opens a report when required. A newly accepted target change consumes any older active target change for the same vault with `success=false` and `Backing target superseded`, freeing its settlement slot. When a report opens, the whole committed `bountyAttoEth` is retained as the settler reward regardless of the inclusion-block cost. If unused ETH is positive, the final caller refund uses a low-level callback; rejection rolls back the entire transaction, including any queueing, immediate execution, or newly opened report.',
				declarations: [{ name: 'requestPriceIfNeededAndStageOperation' }],
				preconditions:
					'`securityPool.isEscalationResolved()` is false; valid self-target for withdrawal or underwriting-limit adjustment; liquidation and withdrawal require positive amounts, while an absolute underwriting limit may be zero to request an exit; and timeout from 1 second through 5 minutes. A committed bounty of at least `getRequestPriceCostAttoEth()` covered by `msg.value`, buffered report funding, matching REP, and token approvals are required only when this call opens a new report. The caller must accept any positive unused-ETH refund.',
				signals: '`StagedOperationQueued`, possibly `PriceRequested`, then `ExecutedStagedOperation`; authoritative `CoordinatorStateCheckpoint` records',
			},
			{
				call: '`requestPrice(proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth)` with report funding',
				caller: 'Anyone when no fresh price or report is pending',
				effect: 'Opens and atomically funds a fresh WETH/REP report without staging a new operation, retains the whole committed bounty as the settler reward, then refunds any ETH above the bounty through a low-level caller callback. Callback rejection rolls back the report and initial position.',
				declarations: [{ name: 'requestPrice' }],
				preconditions:
					'Cached price stale; no pending report; nonzero proposed REP/ETH price, a committed bounty of at least `getRequestPriceCostAttoEth()` covered by `msg.value`, and funding and approvals for at least the configured priority report plus the larger of the base-fee and open-interest WETH reports, plus matching REP. Zero requested WETH uses the minimum; a larger request voluntarily increases the initial report. The caller must accept any positive excess-ETH refund.',
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
				preconditions: 'Callback report matches the pending report; excessive settlement basefee, a saturated `uint24` report counter, an uneconomic final history record at its recorded base fee plus configured priority fee, a stale report, or zero values reject the price after clearing pending report state.',
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
			{ name: 'supportsInterface', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
			{ name: 'balanceOf', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
			{ name: 'totalSupply', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
			{ name: 'balanceOfBatch', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
			{ name: 'isApprovedForAll', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
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
			{ name: '_balances', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
			{ name: '_supplies', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
			{ name: '_operatorApprovals', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' },
		],
		sourcePath: 'solidity/contracts/statoblast/tokens/ShareToken.sol',
		interactions: [
			{
				call: '`setApprovalForAll(operator, approved)`',
				caller: 'Any token account setting its own operator approval',
				effect: "Sets or clears the operator's authority over all of the caller's outcome-token balances.",
				declarations: [{ name: 'setApprovalForAll', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' }],
				preconditions: 'The operator differs from the caller.',
				signals: '`ApprovalForAll`',
			},
			{
				call: 'Both `safeTransferFrom(...)` overloads',
				caller: 'Share holder or approved ERC-1155 operator',
				effect: 'Transfers one outcome-token balance without changing supply.',
				declarations: [{ name: 'safeTransferFrom', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' }],
				preconditions:
					'Caller holds the source balance or has operator approval; the source account has not materialized that token into any child branch; destination is nonzero; the source balance is sufficient; under [A22 asset-recipient compatibility](./security-model.html#assumption-a22), a contract recipient accepts the ERC-1155 callback.',
				signals: '`TransferSingle`',
			},
			{
				call: 'Both `safeBatchTransferFrom(...)` overloads',
				caller: 'Share holder or approved ERC-1155 operator for a nonempty batch; any caller for an empty batch',
				effect: 'A nonempty batch transfers each listed outcome-token balance without changing supply. Equal empty ID and value arrays return as a no-op without an event.',
				declarations: [{ name: 'safeBatchTransferFrom', sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol' }],
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
		compiledAbiFingerprint: '9292800021cde5c8c9dd6f96beb32a33a034949cd1d8d0d68671c3f900b27d2b',
		name: 'UniformPriceDualCapBatchAuction',
		purpose:
			'Collects ETH bids under ETH-raise and REP-sale caps, computes one clearing result, and supports paged settlement. AVL, cumulative-allocation, and refund-prefix mechanics live in [UniformPriceDualCapBatchAuctionStorage](solidity/contracts/statoblast/UniformPriceDualCapBatchAuctionStorage.sol), an internal storage library.',
		readAbiFingerprint: 'e4ad6ab91244711a2008716cfbdf62b6237d39321eefa984a4fdc7856267b8bc',
		readSurface:
			'Auction summary getters are `maxAttoRepBeingSold`, `attoEthRaiseCap`, `finalized`, `clearingTick`, `ethFilledAtClearingAttoEth`, `attoEthRaised`, `totalAttoRepPurchased`, `auctionStarted`, `minBidSizeAttoEth`, `owner`, `underfunded`, `underfundedThreshold`, `underfundedWinningAttoEth`, and `activeTickCount`. `pendingEthRefundsAttoEth` reports ETH credited during settlement and available for the bidder to pull. Use `computeClearing`, `previewFinalization`, `tickToPrice`, `getTickSummary`, `getTickCount`, `getTickPage`, `getActiveTickPage`, `getBidCountAtTick`, `getBidPageAtTick`, `getBidderBidCount`, and `getBidderBidPage` before finalizing or submitting settlement indexes.',
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
		sourcePath: 'solidity/contracts/statoblast/UniformPriceDualCapBatchAuction.sol',
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
				effect: "A nonempty list marks the caller's bids already provably below the current clearing tick and credits their ETH to `pendingEthRefundsAttoEth` without calling the bidder. An empty list changes no bids.",
				preconditions: 'Auction started and unfinalized; auction has reached a clearing price. Nonempty indexes additionally belong to the caller and are strictly losing and unrefunded.',
				signals: '`BidSettled` per refunded bid; one aggregate `EthRefundCredited` per call when total credited ETH is positive',
			},
			{
				call: '`refundLosingBidsFor(bidder, tickIndices)`',
				caller: 'Auction owner (`SecurityPoolForker`) only; public callers use `settleAuctionBids`',
				declarations: [{ name: 'refundLosingBidsFor' }],
				effect: "A nonempty list marks a named bidder's bids already provably below the current clearing tick and credits their ETH to `pendingEthRefundsAttoEth` without calling the bidder. An empty list changes no bids.",
				preconditions: 'Named bidder is nonzero; auction started and unfinalized; auction has reached a clearing price. Nonempty indexes additionally belong to that bidder and are strictly losing and unrefunded.',
				signals: '`BidSettled` per refunded bid; one aggregate `EthRefundCredited` per call when total credited ETH is positive',
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
				call: '`withdrawBids(withdrawFor, tickIndices, proRataTotal, secondaryProRataTotal, repBackingUnitsTotal)`',
				caller: 'Auction owner only',
				effect:
					'Returns five `uint256` values in ABI order: `totalFilledAttoRep` (filled REP), `totalRefundAttoEth` (ETH refund), `totalProRataAllocation` (capacity), `totalSecondaryProRataAllocation` (bad debt), and `totalRepBackingUnitsAllocation` (REP backing units). The forker credits backing and capacity to the bidder vault and credits bad debt only while the recorded auction debt generation is current; the auction credits refunds to the beneficiary pull-payment balance without calling recipient code. Capacity and debt use fixed cumulative ETH positions. Backing units use the corresponding cumulative filled-REP positions to exhaust `repBackingUnitsTotal` without claim-order dependence. An empty list returns five zeros without changing bids or emitting events.',
				declarations: [{ name: 'withdrawBids' }],
				preconditions: 'Auction finalized; caller is owner. Nonempty indexes belong to `withdrawFor` and remain unsettled.',
				signals: '`BidSettled` per processed bid; one `EthRefundCredited` for the call when aggregate `totalRefundAttoEth` is positive',
			},
			{
				call: '`withdrawPendingEthRefund()`',
				caller: 'Bidder with credited ETH',
				effect: "Clears the caller's complete credited refund and emits its withdrawal before transferring. A rejected pull reverts the transfer, clear, and event, preserving the credit. Checks-effects-interactions makes callback reentry observe a zero balance.",
				declarations: [{ name: 'withdrawPendingEthRefund' }],
				preconditions: 'Caller has a positive `pendingEthRefundsAttoEth` balance and currently accepts ETH.',
				signals: '`PendingEthRefundWithdrawn`',
			},
		],
	},
]
