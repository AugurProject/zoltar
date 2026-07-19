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
	uint256 poolOwnership;
	uint256 securityBondAllowance;
	uint256 unpaidEthFees;
	uint256 feeIndex;
}

/// @notice Complete pool fee and collateral accounting state. All ETH fields use wei and all allowance
/// fields use the pool's security-bond denomination. Fee indexes use 1e18 fixed-point precision.
struct PoolAccountingSnapshot {
	/// @dev ETH reserved as complete-set collateral, in wei.
	uint256 completeSetCollateralAmount;
	/// @dev Resulting sum of vault security-bond allowances, in wei-denominated allowance units.
	uint256 totalSecurityBondAllowance;
	/// @dev Allowance currently participating in fee accrual, in the same units as total allowance.
	uint256 feeEligibleSecurityBondAllowance;
	/// @dev Whole wei already assigned to vaults but not yet redeemed.
	uint256 totalFeesOwedToVaults;
	/// @dev Whole accrued wei not yet assigned by a vault checkpoint.
	uint256 unallocatedFeeReserve;
	/// @dev Cumulative fee per eligible allowance unit, scaled by 1e18.
	uint256 feeIndex;
	/// @dev Division carry from fee-index allocation; scoped to the current allowance denominator.
	uint256 feeIndexRemainder;
	/// @dev Sub-wei carry from total fee accrual, always less than 1e18.
	uint256 totalFeesOwedRemainder;
	/// @dev Eligible allowance whose vault fee indexes have not consumed the latest global index delta.
	uint256 uncheckpointedFeeEligibleAllowance;
	/// @dev Last accrual timestamp, in Unix seconds.
	uint256 lastUpdatedFeeAccumulator;
	/// @dev Per-second collateral retention multiplier, scaled by 1e18.
	uint256 currentRetentionRate;
}

enum AccountingReason {
	Accrual,
	VaultCheckpoint,
	FeeRedemption,
	AllowanceChange,
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
		uint256 completeSetCollateralAmount,
		uint256 totalSecurityBondAllowance,
		uint256 feeEligibleSecurityBondAllowance,
		uint256 totalFeesOwedToVaults,
		uint256 unallocatedFeeReserve,
		uint256 feeIndex,
		uint256 feeIndexRemainder,
		uint256 totalFeesOwedRemainder,
		uint256 uncheckpointedFeeEligibleAllowance,
		uint256 lastUpdatedFeeAccumulator,
		uint256 currentRetentionRate
	);
	/// @notice Authoritative resulting vault state and the affected global denominators. Ownership uses
	/// pool-ownership units, allowance uses wei-denominated bond units, fees use wei, and `feeIndex` and
	/// `vaultFeeRemainder` use 1e18 fixed-point precision.
	event VaultAccountingCheckpoint(
		address indexed vault,
		uint256 poolOwnershipAmount,
		uint256 securityBondAllowance,
		uint256 unpaidEthFees,
		uint256 feeIndex,
		uint256 vaultFeeRemainder,
		uint256 resultingPoolOwnershipDenominator,
		uint256 resultingFeeEligibleSecurityBondAllowance
	);
	/// @notice Complete sets minted for `creator`. ETH fields use wei; share fields use share-token units.
	event CompleteSetCreated(
		address indexed creator,
		uint256 ethAmount,
		uint256 sharesMinted,
		uint256 resultingShareTokenSupply,
		uint256 resultingCollateral
	);
	/// @notice Complete sets burned and net ETH paid to `redeemer`.
	event CompleteSetRedeemed(
		address indexed redeemer,
		uint256 shareAmount,
		uint256 ethAmount,
		uint256 resultingShareTokenSupply,
		uint256 resultingCollateral
	);
	/// @notice Winning shares burned and net ETH paid to `redeemer`.
	event SharesRedeemed(
		address indexed redeemer,
		uint256 shareAmount,
		uint256 ethAmount,
		uint256 resultingShareTokenSupply,
		uint256 resultingCollateral
	);

	// -------- View Functions --------
	function questionId() external view returns (uint256);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (Zoltar);
	function totalSecurityBondAllowance() external view returns (uint256);
	function completeSetCollateralAmount() external view returns (uint256);
	function poolOwnershipDenominator() external view returns (uint256);
	function securityMultiplier() external view returns (uint256);
	function totalFeesOwedToVaults() external view returns (uint256);
	function totalAccruedFees() external view returns (uint256);
	function getPoolAccountingSnapshot() external view returns (PoolAccountingSnapshot memory snapshot);
	/// @notice Sub-wei numerator carried into the vault's next fee checkpoint, with denominator `1e18`.
	function getVaultFeeRemainder(address vault) external view returns (uint256);
	function lastUpdatedFeeAccumulator() external view returns (uint256);
	function currentRetentionRate() external view returns (uint256);
	function awaitingForkContinuation() external view returns (bool);
	function securityVaults(
		address vault
	)
		external
		view
		returns (uint256 poolOwnership, uint256 securityBondAllowance, uint256 unpaidEthFees, uint256 feeIndex);
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
	function shareTokenSupply() external view returns (uint256);
	function truthAuction() external view returns (address);

	function sharesToCash(uint256 completeSetAmount) external view returns (uint256);
	function cashToShares(uint256 eth) external view returns (uint256);

	function repToPoolOwnership(uint256 repAmount) external view returns (uint256);
	function poolOwnershipToRep(uint256 poolOwnership) external view returns (uint256);
	function getTotalRepBalance() external view returns (uint256);
	function isEscalationResolved() external view returns (bool);
	function initialEscalationGameDeposit() external view returns (uint256);

	function setStartingParams(uint256 currentRetentionRate, uint256 completeSetCollateralAmount) external;

	function updateCollateralAmount() external;
	function updateRetentionRate() external;
	function updateVaultFees(address vault) external;
	function redeemFees(address vault) external;

	function performWithdrawRep(address vault, uint256 repAmount) external;
	function depositRep(uint256 repAmount) external;
	function redeemRep(address vault) external;
	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external;
	function performLiquidation(
		address callerVault,
		address targetVaultAddress,
		uint256 debtAmount,
		uint256 snapshotTargetOwnership,
		uint256 snapshotTargetAllowance,
		uint256 snapshotTotalRep,
		uint256 snapshotDenominator
	) external;
	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) external;

	function createCompleteSet() external payable;
	function redeemCompleteSet(uint256 amount) external;

	function escalationGame() external view returns (EscalationGame);
	function initializeForkedEscalationGame(
		uint256 startBond,
		uint256 nonDecisionThreshold,
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
	function activateForkMode(bool forkQuestionMatchesPoolQuestion) external;
	function setSystemState(SystemState newState) external;
	function configureVault(
		address vault,
		uint256 poolOwnership,
		uint256 securityBondAllowance,
		uint256 vaultFeeIndex
	) external;
	function addFeeEligibleSecurityBondAllowance(address vault, uint256 amount) external;
	function setOwnershipDenominator(uint256 newDenominator) external;
	function feeIndex() external view returns (uint256);
	function setTotalShares(uint256 newTotalShares) external;
	function setPoolFinancials(
		uint256 newCollateral,
		uint256 newTotalBondAllowance,
		uint256 newFeeEligibleBondAllowance
	) external;
	function authorizeChildPool(ISecurityPool pool) external;
	function questionData() external view returns (ZoltarQuestionData);
	function transferEth(address payable receiver, uint256 amount) external;

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
		uint256 securityMultiplier;
		uint256 currentRetentionRate;
		uint256 completeSetCollateralAmount;
	}

	function deployChildSecurityPool(
		ISecurityPool parent,
		IShareToken shareToken,
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier,
		uint256 currentRetentionRate,
		uint256 completeSetCollateralAmount
	) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction);
	function deployOriginSecurityPool(
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier
	) external returns (ISecurityPool securityPool);
	function getCanonicalSecurityPool(
		uint248 universeId,
		uint256 questionId,
		uint256 securityMultiplier
	) external view returns (ISecurityPool securityPool);
	function securityPoolDeploymentCount() external view returns (uint256);
	function securityPoolDeploymentsRange(
		uint256 startIndex,
		uint256 count
	) external view returns (SecurityPoolDeployment[] memory deployments);
}
