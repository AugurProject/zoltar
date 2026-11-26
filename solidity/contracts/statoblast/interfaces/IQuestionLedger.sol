// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { IShareToken } from './IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { SharedPoolPriceFeed } from '../SharedPoolPriceFeed.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { CarriedDepositProof } from '../EscalationGameTypes.sol';
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';

enum AccountingReason {
	Accrual,
	PoolInitialization,
	CollateralReconciliation
}

enum SystemState {
	Operational,
	PoolForked,
	ForkMigration
}

enum QuestionOutcome {
	Invalid,
	Yes,
	No
}

interface IQuestionLedger {
	function securityPoolCustody() external view returns (address);
	function setSecurityPoolCustody(address custody) external;
	function refreshSecurityPoolFees() external;
	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementSecurityPoolTime);

	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event CompleteSetRedeemed(address indexed redeemer, uint256 completeSetsBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event SharesRedeemed(address indexed redeemer, uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	// -------- View Functions --------
	function questionId() external view returns (uint256);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (Zoltar);
	function settlementCollateralAttoEth() external view returns (uint256);
	function statoblastSecurityMultiplierBps() external view returns (uint256);
	function lastSettlementSecurityPoolTime() external view returns (uint256);
	function awaitingForkContinuation() external view returns (bool);
	function parent() external view returns (IQuestionLedger);
	function systemState() external view returns (SystemState);
	function shareToken() external view returns (IShareToken);
	function repToken() external view returns (ReputationToken);
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function priceFeed() external view returns (SharedPoolPriceFeed);
	function openOracle() external view returns (OpenOracle);
	function shareTokenSupplyAttoShares() external view returns (uint256);

	function attoSharesToAttoEth(uint256 amountAttoShares) external view returns (uint256);
	function attoSharesToAttoRep(uint256 amountAttoShares) external view returns (uint256);
	function attoEthToAttoShares(uint256 amountAttoEth) external view returns (uint256);

	function additionalMintCapacityAttoEth() external view returns (uint256);
	function isEscalationResolved() external view returns (bool);
	function initialEscalationGameDepositAttoRep() external view returns (uint256);
	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external;

	function setStartingParams() external;

	function updateSettlementCollateral() external;

	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external;
	function createCompleteSet(uint256 cash, address recipient, uint256 minimumShares, uint256 fee, uint256 premium) external returns (uint256);
	function redeemCompleteSet(uint256 amountAttoShares, uint256 minimumCollateral, uint256 minimumRecoveryRep) external;

	function escalationGame() external view returns (EscalationGame);
	function initializeForkedEscalationGame(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, int256 elapsedAtFork, BinaryOutcomes.BinaryOutcome fixedQuestionOutcome) external;
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep, bytes32 nullifierRoot) external;
	function resumeForkedEscalationGame() external;
	function setAwaitingForkContinuation(bool shouldAwait) external;
	function activateForkMode() external;
	function setSystemState(SystemState newState) external;
	function setShareTokenSupplyAttoShares(uint256 newShareTokenSupplyAttoShares) external;
	function authorizeChildQuestionLedger(IQuestionLedger pool) external;
	function questionData() external view returns (ZoltarQuestionData);

	function questionForker() external view returns (address);
}

interface ISecurityPoolFactory {
	function maximumReportCollateral() external view returns (uint256);
	function maximumReportPriorityFeeAttoEthPerGas() external view returns (uint256);
	function zoltar() external view returns (Zoltar);
	function prepareSecurityPoolPriceFeed(IQuestionLedger source, uint248 universeId) external returns (address);

	struct QuestionLedgerDeployment {
		IQuestionLedger questionLedger;
		SharedPoolPriceFeed priceFeed;
		IShareToken shareToken;
		IQuestionLedger parent;
		uint248 universeId;
		uint256 questionId;
		uint256 statoblastSecurityMultiplierBps;
		uint256 initialReportPriorityFeeAttoEthPerGas;
	}

	function deployChildQuestionLedger(IQuestionLedger parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) external returns (IQuestionLedger questionLedger);
	function deploySecurityPoolQuestionLedger(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (IQuestionLedger questionLedger);
	function getQuestionOriginId(address securityPool, uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external pure returns (bytes32 originId);
	function securityPoolOf(IQuestionLedger questionLedger) external view returns (address securityPool);
	function prepareSecurityPoolChildPriceFeed(IQuestionLedger parent, uint256 outcomeIndex) external returns (address);
	function initializeSecurityPoolPriceFeed(uint248 universeId, uint256 priorityFee) external returns (address);
	function initializeSecurityPoolPriceFeedForUniverse(uint248 universeId) external returns (address);
	function sharedPriceFeeds(address securityPool, uint248 universeId) external view returns (address);
	function getQuestionLedgerId(bytes32 originId, uint248 universeId) external pure returns (bytes32 poolId);
	function getQuestionLedger(bytes32 originId, uint248 universeId) external view returns (IQuestionLedger questionLedger);
	function getQuestionLedgerOriginId(IQuestionLedger questionLedger) external view returns (bytes32 originId);
	function getQuestionLedgerHasInheritedForkOutcome(IQuestionLedger questionLedger) external view returns (bool);
	function questionLedgerDeploymentCount() external view returns (uint256);
	function questionLedgerDeploymentsRange(uint256 startIndex, uint256 count) external view returns (QuestionLedgerDeployment[] memory deployments);
}
