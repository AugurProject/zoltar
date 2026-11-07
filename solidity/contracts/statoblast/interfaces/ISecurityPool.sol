// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { IShareToken } from './IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { CarriedDepositProof } from '../EscalationGameTypes.sol';
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';

enum AccountingReason {
	Accrual,
	VaultCheckpoint,
	FeeRedemption,
	CapacityOwnershipChange,
	AuctionClaim,
	PoolInitialization,
	ForkActivation,
	CollateralReconciliation,
	RetentionRateChange,
	ForkFinalization
}

enum SystemState {
	Operational,
	PoolForked,
	ForkMigration,
	ForkTruthAuction
}

enum QuestionOutcome {
	Invalid,
	Yes,
	No
}

interface ISecurityPool {
	function portfolioCustody() external view returns (address);
	function setPortfolioCustody(address custody) external;
	function refreshPortfolioFees() external;
	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementLogicalTime);

	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event CompleteSetRedeemed(address indexed redeemer, uint256 completeSetsBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event SharesRedeemed(address indexed redeemer, uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	// -------- View Functions --------
	function questionId() external view returns (uint256);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (Zoltar);
	function settlementCollateralAttoEth() external view returns (uint256);
	function statoblastSecurityMultiplierBps() external view returns (uint256);
	function lastSettlementLogicalTime() external view returns (uint256);
	function awaitingForkContinuation() external view returns (bool);
	function parent() external view returns (ISecurityPool);
	function systemState() external view returns (SystemState);
	function shareToken() external view returns (IShareToken);
	function repToken() external view returns (ReputationToken);
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function openOraclePriceCoordinator() external view returns (OpenOraclePriceCoordinator);
	function openOracle() external view returns (OpenOracle);
	function shareTokenSupplyAttoShares() external view returns (uint256);
	function truthAuction() external view returns (address);

	function attoSharesToAttoEth(uint256 amountAttoShares) external view returns (uint256);
	function attoSharesToAttoRep(uint256 amountAttoShares) external view returns (uint256);
	function attoEthToAttoShares(uint256 amountAttoEth) external view returns (uint256);

	function getTotalPoolHeldAttoRep() external view returns (uint256);
	function getCurrentMintingCapacityAttoEth() external view returns (uint256);
	function isEscalationResolved() external view returns (bool);
	function initialEscalationGameDepositAttoRep() external view returns (uint256);
	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external;

	function setStartingParams(uint256 currentRetentionRate, uint256 settlementCollateralAttoEth) external;

	function getFeeEpochEndTime() external view returns (uint256);
	function updateSettlementCollateral() external;
	function updateRetentionRate() external;

	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external;
	function createCompleteSet() external payable;
	function redeemCompleteSet(uint256 amountAttoShares) external;

	function escalationGame() external view returns (EscalationGame);
	function initializeForkedEscalationGame(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, int256 elapsedAtFork, BinaryOutcomes.BinaryOutcome fixedQuestionOutcome) external;
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep, bytes32 nullifierRoot) external;
	function resumeForkedEscalationGame() external;
	function setAwaitingForkContinuation(bool shouldAwait) external;
	function activateForkMode() external;
	function setSystemState(SystemState newState) external;
	function setShareTokenSupplyAttoShares(uint256 newShareTokenSupplyAttoShares) external;
	function authorizeChildPool(ISecurityPool pool) external;
	function questionData() external view returns (ZoltarQuestionData);

	function securityPoolForker() external view returns (address);
	receive() external payable;
}

interface ISecurityPoolFactory {
	function zoltar() external view returns (Zoltar);
	function preparePortfolioPriceFeed(ISecurityPool source, uint248 universeId) external returns (address);

	struct SecurityPoolDeployment {
		ISecurityPool securityPool;
		address truthAuction;
		OpenOraclePriceCoordinator openOraclePriceCoordinator;
		IShareToken shareToken;
		ISecurityPool parent;
		uint248 universeId;
		uint256 questionId;
		uint256 statoblastSecurityMultiplierBps;
		uint256 initialReportPriorityFeeAttoEthPerGas;
		uint256 currentRetentionRate;
		uint256 settlementCollateralAttoEth;
	}

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth) external returns (ISecurityPool securityPool, address truthAuction);
	function deployPortfolioSecurityPool(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (ISecurityPool securityPool);
	function getPortfolioOriginId(address portfolio, uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external pure returns (bytes32 originId);
	function getSecurityPoolPortfolio(ISecurityPool securityPool) external view returns (address portfolio);
	function prepareChildPoolDependencies(ISecurityPool parent, uint256 outcomeIndex) external returns (OpenOraclePriceCoordinator coordinator, address auction);
	function getChildPoolDependencies(ISecurityPool parent, uint256 outcomeIndex) external view returns (OpenOraclePriceCoordinator coordinator, address auction);
	function preparePortfolioChildPriceFeed(ISecurityPool parent, uint256 outcomeIndex) external returns (address);
	function initializePortfolioPriceFeed(uint248 universeId, uint256 priorityFee) external returns (address);
	function initializePortfolioPriceFeedForUniverse(uint248 universeId) external returns (address);
	function sharedPriceFeeds(address portfolio, uint248 universeId) external view returns (address);
	function getPoolId(bytes32 originId, uint248 universeId) external pure returns (bytes32 poolId);
	function getSecurityPool(bytes32 originId, uint248 universeId) external view returns (ISecurityPool securityPool);
	function getSecurityPoolOriginId(ISecurityPool securityPool) external view returns (bytes32 originId);
	function getSecurityPoolHasInheritedForkOutcome(ISecurityPool securityPool) external view returns (bool);
	function securityPoolDeploymentCount() external view returns (uint256);
	function securityPoolDeploymentsRange(uint256 startIndex, uint256 count) external view returns (SecurityPoolDeployment[] memory deployments);
}
