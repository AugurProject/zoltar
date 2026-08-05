// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { UniformPriceDualCapBatchAuction } from '../UniformPriceDualCapBatchAuction.sol';
import { IShareToken } from './IShareToken.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { CarriedDepositProof } from '../EscalationGameTypes.sol';
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';

struct SecurityVault {
	uint256 repBackingUnits;
	uint256 coverageCommitmentAttoEth;
	uint256 claimableFeesAttoEth;
	uint256 feeIndex;
}

/// @notice Complete pool fee and settlement-collateral accounting state.
/// @dev ETH-denominated protocol accounting uses attoETH terminology without changing the existing scale.
/// Fee indexes use 1e18 fixed-point precision.
struct PoolAccountingSnapshot {
	/// @dev ETH reserved as complete-set settlement collateral, denominated in attoETH.
	uint256 settlementCollateralAttoEth;
	/// @dev Resulting sum of vault coverage commitments, denominated in attoETH.
	uint256 totalCoverageCommitmentAttoEth;
	/// @dev Coverage commitment currently participating in fee accrual, denominated in attoETH.
	uint256 feeEligibleCoverageCommitmentAttoEth;
	/// @dev Whole attoETH already assigned to vaults but not yet redeemed.
	uint256 totalClaimableVaultFeesAttoEth;
	/// @dev Whole accrued attoETH not yet assigned by a vault checkpoint.
	uint256 unallocatedAccruedFeesAttoEth;
	/// @dev Cumulative fee per eligible coverage-commitment attoETH, scaled by 1e18.
	uint256 feeIndex;
	/// @dev Division carry from fee-index allocation; scoped to the current coverage-commitment denominator.
	uint256 feeIndexRemainder;
	/// @dev Fractional attoETH carry from total fee accrual, always less than 1e18.
	uint256 totalFeesOwedRemainder;
	/// @dev Eligible coverage commitment whose vault fee indexes have not consumed the latest global index delta.
	uint256 uncheckpointedFeeEligibleCoverageCommitmentAttoEth;
	/// @dev Last accrual timestamp, in Unix seconds.
	uint256 lastUpdatedFeeAccumulator;
	/// @dev Per-second collateral retention multiplier, scaled by 1e18.
	uint256 currentRetentionRate;
}

enum AccountingReason {
	Accrual,
	VaultCheckpoint,
	FeeRedemption,
	CoverageCommitmentChange,
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
	/// @notice Authoritative resulting accounting state after a mutation. `vault` is zero for pool-wide causes.
	event PoolAccountingCheckpoint(
		AccountingReason reason,
		address indexed vault,
		uint256 settlementCollateralAttoEth,
		uint256 totalCoverageCommitmentAttoEth,
		uint256 feeEligibleCoverageCommitmentAttoEth,
		uint256 totalClaimableVaultFeesAttoEth,
		uint256 unallocatedAccruedFeesAttoEth,
		uint256 feeIndex,
		uint256 feeIndexRemainder,
		uint256 totalFeesOwedRemainder,
		uint256 uncheckpointedFeeEligibleCoverageCommitmentAttoEth,
		uint256 lastUpdatedFeeAccumulator,
		uint256 currentRetentionRate
	);
	/// @notice Authoritative resulting vault state and the affected global denominators. REP attribution uses
	/// REP backing units, commitments and fees use attoETH, and `feeIndex` and
	/// `vaultFeeRemainder` use 1e18 fixed-point precision.
	event VaultAccountingCheckpoint(
		address indexed vault,
		uint256 repBackingUnits,
		uint256 coverageCommitmentAttoEth,
		uint256 claimableFeesAttoEth,
		uint256 feeIndex,
		uint256 vaultFeeRemainder,
		uint256 resultingTotalRepBackingUnits,
		uint256 resultingFeeEligibleCoverageCommitmentAttoEth
	);
	/// @notice Complete sets minted for `creator`. ETH fields use attoETH; share fields use attoShares.
	event CompleteSetCreated(
		address indexed creator,
		uint256 settlementCollateralProvidedAttoEth,
		uint256 completeSetsMintedAttoShares,
		uint256 resultingShareTokenSupplyAttoShares,
		uint256 resultingSettlementCollateralAttoEth
	);
	/// @notice Complete sets burned and net ETH paid to `redeemer`.
	event CompleteSetRedeemed(
		address indexed redeemer,
		uint256 completeSetsBurnedAttoShares,
		uint256 settlementCollateralRedeemedAttoEth,
		uint256 resultingShareTokenSupplyAttoShares,
		uint256 resultingSettlementCollateralAttoEth
	);
	/// @notice Winning shares burned and net ETH paid to `redeemer`.
	event SharesRedeemed(
		address indexed redeemer,
		uint256 winningSharesBurnedAttoShares,
		uint256 settlementCollateralRedeemedAttoEth,
		uint256 resultingShareTokenSupplyAttoShares,
		uint256 resultingSettlementCollateralAttoEth
	);

	// -------- View Functions --------
	function questionId() external view returns (uint256);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (Zoltar);
	function totalCoverageCommitmentAttoEth() external view returns (uint256);
	function settlementCollateralAttoEth() external view returns (uint256);
	function totalRepBackingUnits() external view returns (uint256);
	function statoblastSecurityMultiplierBps() external view returns (uint256);
	function totalClaimableVaultFeesAttoEth() external view returns (uint256);
	function totalAccruedFeesAttoEth() external view returns (uint256);
	function getPoolAccountingSnapshot() external view returns (PoolAccountingSnapshot memory snapshot);
	/// @notice Fractional-attoETH numerator carried into the vault's next fee checkpoint, with denominator `1e18`.
	function getVaultFeeRemainder(address vault) external view returns (uint256);
	function lastUpdatedFeeAccumulator() external view returns (uint256);
	function currentRetentionRate() external view returns (uint256);
	function awaitingForkContinuation() external view returns (bool);
	function securityVaults(
		address vault
	)
		external
		view
		returns (
			uint256 repBackingUnits,
			uint256 coverageCommitmentAttoEth,
			uint256 claimableFeesAttoEth,
			uint256 feeIndex
		);
	function getVaultCount() external view returns (uint256);
	function getVaults(uint256 startIndex, uint256 count) external view returns (address[] memory vaults);
	function getActiveVaultCount() external view returns (uint256);
	function getActiveVaults(uint256 startIndex, uint256 count) external view returns (address[] memory vaults);
	function parent() external view returns (ISecurityPool);
	function systemState() external view returns (SystemState);
	function shareToken() external view returns (IShareToken);
	function repToken() external view returns (ReputationToken);
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function priceOracleManagerAndOperatorQueuer() external view returns (OpenOraclePriceCoordinator);
	function openOracle() external view returns (OpenOracle);
	function shareTokenSupplyAttoShares() external view returns (uint256);
	function truthAuction() external view returns (address);

	function attoSharesToAttoEth(uint256 amountAttoShares) external view returns (uint256);
	function attoEthToAttoShares(uint256 amountAttoEth) external view returns (uint256);

	function attoRepToBackingUnits(uint256 repAmountAttoRep) external view returns (uint256);
	function backingUnitsToAttoRep(uint256 repBackingUnits) external view returns (uint256);
	function getTotalPoolHeldRepAttoRep() external view returns (uint256);
	function isEscalationResolved() external view returns (bool);
	function initialEscalationGameDepositAttoRep() external view returns (uint256);
	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external;

	function setStartingParams(uint256 currentRetentionRate, uint256 settlementCollateralAttoEth) external;

	function updateSettlementCollateral() external;
	function updateRetentionRate() external;
	function updateVaultFees(address vault) external;
	function redeemFees(address vault) external;

	function withdrawRepFromVault(address vault, uint256 repAmountAttoRep) external;
	function depositRepToVault(uint256 repAmountAttoRep) external;
	function redeemRepFromVault(address vault) external;
	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external;
	function performLiquidation(
		address callerVault,
		address targetVaultAddress,
		uint256 requestedCommitmentTransferAttoEth,
		uint256 snapshotTargetBackingUnits,
		uint256 snapshotTargetCoverageCommitmentAttoEth,
		uint256 snapshotTotalPoolHeldRepAttoRep,
		uint256 snapshotTotalRepBackingUnits
	) external;
	function executeCoverageCommitmentUpdate(address callerVault, uint256 amountAttoEth) external;

	function createCompleteSet() external payable;
	function redeemCompleteSet(uint256 amountAttoShares) external;

	function escalationGame() external view returns (EscalationGame);
	function initializeForkedEscalationGame(
		uint256 startBondAttoRep,
		uint256 nonDecisionThresholdAttoRep,
		uint256 elapsedAtFork,
		BinaryOutcomes.BinaryOutcome fixedQuestionOutcome
	) external;
	function initializeForkCarrySnapshotWithResolutionBalances(
		address sourceGame,
		bytes32 snapshotId,
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		uint256[3] memory inheritedResolutionBalances,
		bytes32[3] memory inheritedNullifierRoots
	) external;
	function resumeForkedEscalationGame() external;
	function setAwaitingForkContinuation(bool shouldAwait) external;
	function activateForkMode() external;
	function setSystemState(SystemState newState) external;
	function configureVault(
		address vault,
		uint256 repBackingUnits,
		uint256 coverageCommitmentAttoEth,
		uint256 vaultFeeIndex
	) external;
	function addFeeEligibleCoverageCommitmentAttoEth(address vault, uint256 amountAttoEth) external;
	function setTotalRepBackingUnits(uint256 newDenominator) external;
	function feeIndex() external view returns (uint256);
	function setTotalSharesAttoShares(uint256 newTotalSharesAttoShares) external;
	function setPoolFinancials(
		uint256 newSettlementCollateralAttoEth,
		uint256 newTotalCoverageCommitmentAttoEth,
		uint256 newFeeEligibleCoverageCommitmentAttoEth
	) external;
	function authorizeChildPool(ISecurityPool pool) external;
	function questionData() external view returns (ZoltarQuestionData);
	function transferEth(address payable receiver, uint256 amountAttoEth) external;

	function securityPoolForker() external view returns (address);
	function securityPoolEventEmitter() external view returns (address);

	receive() external payable;
}

interface ISecurityPoolFactory {
	struct SecurityPoolDeployment {
		ISecurityPool securityPool;
		UniformPriceDualCapBatchAuction truthAuction;
		OpenOraclePriceCoordinator priceOracleManagerAndOperatorQueuer;
		IShareToken shareToken;
		ISecurityPool parent;
		uint248 universeId;
		uint256 questionId;
		uint256 statoblastSecurityMultiplierBps;
		uint256 initialReportPriorityFeeAttoEthPerGas;
		uint256 currentRetentionRate;
		uint256 settlementCollateralAttoEth;
	}

	function deployChildSecurityPool(
		ISecurityPool parent,
		IShareToken shareToken,
		uint248 universeId,
		uint256 questionId,
		uint256 statoblastSecurityMultiplierBps,
		uint256 currentRetentionRate,
		uint256 settlementCollateralAttoEth
	) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction);
	function deployOriginSecurityPool(
		uint248 universeId,
		uint256 questionId,
		uint256 statoblastSecurityMultiplierBps,
		uint256 initialReportPriorityFeeAttoEthPerGas
	) external returns (ISecurityPool securityPool);
	function getOriginId(
		uint248 originUniverseId,
		uint256 questionId,
		uint256 statoblastSecurityMultiplierBps,
		uint256 initialReportPriorityFeeAttoEthPerGas
	) external pure returns (bytes32 originId);
	function getPoolId(bytes32 originId, uint248 universeId) external pure returns (bytes32 poolId);
	function getSecurityPool(bytes32 originId, uint248 universeId) external view returns (ISecurityPool securityPool);
	function getSecurityPoolOriginId(ISecurityPool securityPool) external view returns (bytes32 originId);
	function getSecurityPoolHasInheritedForkOutcome(ISecurityPool securityPool) external view returns (bool);
	function securityPoolDeploymentCount() external view returns (uint256);
	function securityPoolDeploymentsRange(
		uint256 startIndex,
		uint256 count
	) external view returns (SecurityPoolDeployment[] memory deployments);
}
