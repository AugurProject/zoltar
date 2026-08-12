// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { IUniformPriceDualCapBatchAuction } from './IUniformPriceDualCapBatchAuction.sol';

interface ISecurityPoolForkerEvents {
	event VaultBadDebtMigrated(ISecurityPool indexed parentPool, ISecurityPool indexed childPool, address indexed vault, uint256 migratedBadDebtAttoEth, uint256 resultingParentTotalBadDebtAttoEth, uint256 resultingChildTotalBadDebtAttoEth);
	event ClaimAuctionProceeds(ISecurityPool indexed securityPool, address indexed vault, uint256 amountAttoRep, uint256 repBackingUnits, uint256 totalRepBackingUnits, uint256 claimedAuctionRepPurchasedAttoRep, uint256 claimedAuctionedCapacityOwnershipAttoRep, uint256 claimedAuctionedBadDebtAttoEth, uint256 auctionedBadDebtAttoEth);
	/// @notice Immutable fork-time pool and escalation accounting. Collateral uses attoETH, REP fields use
	/// attoREP, elapsed time uses seconds, and `escalationSnapshotId` commits to the carry state.
	event SecurityPoolForkSnapshot(ISecurityPool indexed parentPool, address indexed migrationProxy, bool ownFork, bool unresolvedEscalation, uint256 settlementCollateralAtForkAttoEth, uint256 totalPoolHeldRepAtForkAttoRep, uint256 auctionableAttoRepAtFork, uint256 escalationSourceRepAtForkAttoRep, uint256 escalationChildRepAtForkAttoRep, uint256 escalationStartBondAtForkAttoRep, uint256 escalationNonDecisionThresholdAtForkAttoRep, uint256 escalationElapsedAtFork, bytes32 escalationSnapshotId);
	/// @notice REP removed from an unresolved escalation game so it can back fork continuations.
	event DisputeStakedRepDrainedAtFork(ISecurityPool indexed parentPool, address indexed sourceGame, uint256 attoRepAmount);
	/// @notice Parent-universe REP locked under the per-pool migration proxy.
	event ParentRepLocked(ISecurityPool indexed parentPool, address indexed migrationProxy, uint256 poolHeldRepAmountAttoRep, uint256 disputeStakedRepAmountAttoRep, uint256 resultingLockedAttoRep);
	/// @notice Final parent/child vault and collateral state after one vault migration. REP fields use attoREP,
	/// settlement-collateral fields use attoETH, REP attribution fields use REP backing units, and capacity ownerships use
	/// attoETH. The event is emitted even when `settlementCollateralTransferredAttoEth` is zero.
	event VaultMigrationCheckpoint(ISecurityPool indexed parentPool, ISecurityPool indexed childPool, address indexed vault, uint256 outcomeIndex, uint256 migratedRepDeltaAttoRep, uint256 resultingChildMigratedRepTotalAttoRep, uint256 resultingParentRepBackingUnits, uint256 resultingParentCapacityOwnershipAttoRep, uint256 resultingChildRepBackingUnits, uint256 resultingChildCapacityOwnershipAttoRep, uint256 resultingParentTotalRepBackingUnits, uint256 resultingChildTotalRepBackingUnits, uint256 resultingParentTotalCapacityOwnershipAttoRep, uint256 resultingChildTotalCapacityOwnershipAttoRep, uint256 settlementCollateralTransferredAttoEth, uint256 cumulativeSettlementCollateralTransferredAttoEth);
	/// @notice REP materialized into one child continuation; amounts use child attoREP.
	event ChildDisputeStakedRepMaterialized(ISecurityPool indexed parentPool, ISecurityPool indexed childPool, address indexed childGame, uint256 outcomeIndex, uint256 attoRepAmount, uint256 resultingDisputeStakedRepBalanceAttoRep);
	/// @notice Child REP moved into its pool, including the resulting pool token balance.
	event PoolHeldRepSweptToChild(ISecurityPool indexed parentPool, ISecurityPool indexed childPool, uint256 indexed outcomeIndex, uint256 attoRepAmount, uint256 resultingChildPoolHeldRepBalanceAttoRep);
}

interface ISecurityPoolForker is ISecurityPoolForkerEvents {
	function getForkActivationTime(ISecurityPool securityPool) external view returns (uint256);
	function getOwnForkRepBuckets(ISecurityPool securityPool)
		external
		view
		returns (
			uint256 vaultRepAtForkAttoRep,
			uint256 escalationChildRepPerSelectedOutcomeAttoRep,
			uint256 escrowSourceRepAtForkAttoRep
		);
	function getOwnForkMigrationStatus(ISecurityPool securityPool)
		external
		view
		returns (
			bool ownFork,
			uint256 auctionableAttoRepAtFork,
			uint256 vaultRepAtForkAttoRep,
			uint256 escalationChildRepPerSelectedOutcomeAttoRep,
			uint256 escrowSourceRepAtForkAttoRep
		);
	function initiateSecurityPoolFork(ISecurityPool securityPool) external;
	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] calldata outcomeIndices) external;
	function createChildUniverse(ISecurityPool securityPool, uint256 outcomeIndex) external;
	function migrateVault(ISecurityPool securityPool, uint256 outcomeIndex) external;
	function migrateVaultWithUnresolvedEscalation(ISecurityPool securityPool, address vault, uint256 childOutcomeIndex) external;
	function getEscalationMigrationEntitlementStatus(ISecurityPool securityPool, address vault) external view returns (bool initialized, uint256 totalCurrentAttoRep, bool[3] memory materializedByOutcome);
	function claimForkedEscalationDeposits(ISecurityPool securityPool, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] calldata depositIndexes) external;
	function isEscalationDepositClaimedDirectly(ISecurityPool securityPool, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256 parentDepositIndex) external view returns (bool);
	function getEscalationDepositId(ISecurityPool securityPool, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256 parentDepositIndex) external view returns (bytes32);
	function getDirectlyClaimedEscalationPrincipal(ISecurityPool securityPool, BinaryOutcomes.BinaryOutcome outcomeIndex) external view returns (uint256);
	function isEscalationWinnerHaircutPaidByFork(ISecurityPool securityPool) external view returns (bool);
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external payable;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) external;
	function settleAuctionBids(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] calldata claimTickIndices, IUniformPriceDualCapBatchAuction.TickIndex[] calldata refundTickIndices) external;
	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
