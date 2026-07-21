// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { IUniformPriceDualCapBatchAuction } from './IUniformPriceDualCapBatchAuction.sol';

interface ISecurityPoolForkerEvents {
	/// @notice Immutable fork-time pool and escalation accounting. Collateral uses wei, REP fields use REP
	/// token base units, elapsed time uses seconds, and `escalationSnapshotId` commits to the carry state.
	event SecurityPoolForkSnapshot(
		ISecurityPool indexed parentPool,
		address indexed migrationProxy,
		bool ownFork,
		bool unresolvedEscalation,
		uint256 collateralAtFork,
		uint256 poolRepAtFork,
		uint256 auctionableRepAtFork,
		uint256 escalationSourceRepAtFork,
		uint256 escalationChildRepAtFork,
		uint256 escalationStartBondAtFork,
		uint256 escalationNonDecisionThresholdAtFork,
		uint256 escalationElapsedAtFork,
		bytes32 escalationSnapshotId
	);
	/// @notice REP removed from an unresolved escalation game so it can back fork continuations.
	event EscalationRepDrainedAtFork(ISecurityPool indexed parentPool, address indexed sourceGame, uint256 repAmount);
	/// @notice Parent-universe REP locked under the per-pool migration proxy.
	event ParentRepLocked(
		ISecurityPool indexed parentPool,
		address indexed migrationProxy,
		uint256 poolRepAmount,
		uint256 escalationRepAmount,
		uint256 resultingLockedRep
	);
	/// @notice Final parent/child vault and collateral state after one vault migration. REP fields use token
	/// base units, collateral fields use wei, ownership fields use pool-ownership units, and allowances use
	/// wei-denominated bond units. The event is emitted even when `collateralDelta` is zero.
	event VaultMigrationCheckpoint(
		ISecurityPool indexed parentPool,
		ISecurityPool indexed childPool,
		address indexed vault,
		uint256 outcomeIndex,
		uint256 migratedRepDelta,
		uint256 resultingChildMigratedRepTotal,
		uint256 resultingParentPoolOwnershipAmount,
		uint256 resultingParentSecurityBondAllowance,
		uint256 resultingChildPoolOwnershipAmount,
		uint256 resultingChildSecurityBondAllowance,
		uint256 resultingParentPoolOwnershipDenominator,
		uint256 resultingChildPoolOwnershipDenominator,
		uint256 resultingParentTotalSecurityBondAllowance,
		uint256 resultingChildTotalSecurityBondAllowance,
		uint256 collateralDelta,
		uint256 cumulativeCollateralTransferred
	);
	/// @notice REP materialized into one child continuation; amounts use child REP base units.
	event ChildEscalationRepMaterialized(
		ISecurityPool indexed parentPool,
		ISecurityPool indexed childPool,
		address indexed childGame,
		uint256 outcomeIndex,
		uint256 repAmount,
		uint256 resultingEscalationRepBalance
	);
	/// @notice Child REP moved into its pool, including the resulting pool token balance.
	event ChildPoolRepSwept(
		ISecurityPool indexed parentPool,
		ISecurityPool indexed childPool,
		uint256 indexed outcomeIndex,
		uint256 repAmount,
		uint256 resultingChildPoolRepBalance
	);
}

interface ISecurityPoolForker is ISecurityPoolForkerEvents {
	function getForkActivationTime(ISecurityPool securityPool) external view returns (uint256);
	function getOwnForkRepBuckets(
		ISecurityPool securityPool
	)
		external
		view
		returns (uint256 vaultRepAtFork, uint256 escalationChildRepPerSelectedOutcome, uint256 escrowSourceRepAtFork);
	function getOwnForkMigrationStatus(
		ISecurityPool securityPool
	)
		external
		view
		returns (
			bool ownFork,
			uint256 auctionableRepAtFork,
			uint256 vaultRepAtFork,
			uint256 escalationChildRepPerSelectedOutcome,
			uint256 escrowSourceRepAtFork
		);
	function initiateSecurityPoolFork(ISecurityPool securityPool) external;
	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] calldata outcomeIndices) external;
	function createChildUniverse(ISecurityPool securityPool, uint256 outcomeIndex) external;
	function migrateVault(ISecurityPool securityPool, uint256 outcomeIndex) external;
	function migrateVaultWithUnresolvedEscalation(
		ISecurityPool securityPool,
		address vault,
		uint256 childOutcomeIndex
	) external;
	function getEscalationMigrationEntitlementStatus(
		ISecurityPool securityPool,
		address vault
	) external view returns (bool initialized, uint256 totalCurrentRep, bool[3] memory materializedByOutcome);
	function claimForkedEscalationDeposits(
		ISecurityPool securityPool,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes
	) external;
	function isEscalationDepositClaimedDirectly(
		ISecurityPool securityPool,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256 parentDepositIndex
	) external view returns (bool);
	function getDirectlyClaimedEscalationPrincipal(
		ISecurityPool securityPool,
		BinaryOutcomes.BinaryOutcome outcomeIndex
	) external view returns (uint256);
	function isEscalationWinnerHaircutPaidByFork(ISecurityPool securityPool) external view returns (bool);
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external payable;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function claimAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices
	) external;
	function settleAuctionBids(
		ISecurityPool securityPool,
		address vault,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata claimTickIndices,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata refundTickIndices
	) external;
	function getQuestionOutcome(
		ISecurityPool securityPool
	) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
