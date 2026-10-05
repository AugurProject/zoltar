export const documentedEventSchemas: Array<{ name: string; parameters: string; sourcePath: string }> = [
	{ name: 'RegistryInitialized', parameters: 'address indexed coordinator', sourcePath: 'solidity/contracts/statoblast/LiquidationApprovalRegistry.sol' },
	{ name: 'LiquidationApprovalRegistrySet', parameters: 'LiquidationApprovalRegistry indexed registry', sourcePath: 'solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol' },
	{ name: 'EthReceived', parameters: 'address indexed sender,uint256 amountAttoEth', sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol' },
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
			'ISecurityPool indexed securityPool,UniformPriceDualCapBatchAuction truthAuction,OpenOraclePriceCoordinator openOraclePriceCoordinator,IShareToken shareToken,ISecurityPool indexed parent,uint248 indexed universeId,uint256 questionId,uint256 statoblastSecurityMultiplierBps,uint256 initialReportPriorityFeeAttoEthPerGas,uint256 currentRetentionRate,uint256 settlementCollateralAttoEth',
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
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,address indexed childGame,uint256 outcomeIndex,uint256 amountAttoRep,uint256 resultingDisputeStakedRepBalanceAttoRep',
		sourcePath: 'solidity/contracts/statoblast/interfaces/ISecurityPoolForker.sol',
	},
	{
		name: 'PoolHeldRepSweptToChild',
		parameters: 'ISecurityPool indexed parentPool,ISecurityPool indexed childPool,uint256 indexed outcomeIndex,uint256 amountAttoRep,uint256 resultingChildPoolHeldRepBalanceAttoRep',
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

export const referencedEventAbiFingerprint = '37b0ebe4d6970558d4c0791a9c61fe61fa7970b897e24c7d1dfa0944339a2b7a'
