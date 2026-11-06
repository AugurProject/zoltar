export const documentedEventSchemas: Array<{ name: string; parameters: string; sourcePath: string }> = [
	{
		name: 'PortfolioRecoveryRightsConsumed',
		parameters: 'uint248 indexed universeId,address indexed holder,uint256 amountAttoShares,uint256 cumulativeAttoShares',
		sourcePath: 'solidity/contracts/statoblast/tokens/ShareToken.sol',
	},
	{
		name: 'PortfolioRecoveryRightsTransferred',
		parameters: 'uint248 indexed universeId,address indexed from,address indexed to,uint256[3] amountsAttoShares',
		sourcePath: 'solidity/contracts/statoblast/tokens/ShareToken.sol',
	},
	{
		name: 'OrdinarySettlementInitialized',
		parameters: 'BinaryOutcomes.BinaryOutcome indexed outcome,uint256 winningPrincipalAttoRep,uint256 reservedAttoRep',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
	},
	{
		name: 'ClaimCheckpointProgress',
		parameters: 'bytes32 indexed claimId,address nextSourceGame,uint256 pendingSteps,bool complete',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
	},
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
			'ISecurityPool indexed securityPool,address truthAuction,OpenOraclePriceCoordinator openOraclePriceCoordinator,IShareToken shareToken,ISecurityPool indexed parent,uint248 indexed universeId,uint256 questionId,uint256 statoblastSecurityMultiplierBps,uint256 initialReportPriorityFeeAttoEthPerGas,uint256 currentRetentionRate,uint256 settlementCollateralAttoEth',
		sourcePath: 'solidity/contracts/statoblast/factories/SecurityPoolFactory.sol',
	},
	{
		name: 'TheoreticalSupplySet',
		parameters: 'uint256 totalTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
	{
		name: 'ReputationTokenInitialized',
		parameters: 'uint248 indexed universeId,uint256 indexed repNumber,string name,string symbol,uint256 totalTheoreticalSupplyAttoRep',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
	{
		name: 'Mint',
		parameters: 'address indexed account,uint256 valueAttoRep',
		sourcePath: 'solidity/contracts/ReputationToken.sol',
	},
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
		name: 'SystemStateSet',
		parameters: 'SystemState systemState',
		sourcePath: 'solidity/contracts/statoblast/SecurityPool.sol',
	},
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
]
export const delegateEventDeclarationMirrors: Array<{ name: string; sourcePath: string }> = [
	{
		name: 'OrdinarySettlementInitialized',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol',
	},
]
export const assemblyEventEmissions: Array<{ dataArguments: string; indexedArguments: string; name: string; signature: string; signatureConstant: string; sourcePath: string }> = [
	{
		dataArguments: 'outcomeIndex, amountAttoRep, reason, carryTotalAttoRep, _getCurrentNullifierRoot(outcomeIndex), carryRoot',
		indexedArguments: 'parentDepositIndex, sourceNodeId, depositor',
		name: 'CarryDepositConsumed',
		signature: 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)',
		signatureConstant: 'CARRY_DEPOSIT_CONSUMED_SIGNATURE',
		sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
	},
]
export const referencedEventAbiFingerprint = '4ac8aa26db91082b7291e5c35bb1d5eb6142fb4cadcdeea17139f1a9fba5ce10'
