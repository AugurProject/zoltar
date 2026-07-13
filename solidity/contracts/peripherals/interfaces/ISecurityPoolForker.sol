// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { IUniformPriceDualCapBatchAuction } from './IUniformPriceDualCapBatchAuction.sol';

interface ISecurityPoolForker {
	function isOwnFork(ISecurityPool securityPool) external view returns (bool);
	function getOwnForkRepBuckets(
		ISecurityPool securityPool
	) external view returns (uint256 vaultRepAtFork, uint256 unallocatedEscrowChildRep, uint256 escrowSourceRepAtFork);
	function getOwnForkMigrationStatus(
		ISecurityPool securityPool
	)
		external
		view
		returns (
			bool ownFork,
			uint256 auctionableRepAtFork,
			uint256 vaultRepAtFork,
			uint256 unallocatedEscrowChildRep,
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
	) external returns (bool moreToMigrate);
	function claimForkedEscalationDeposits(
		ISecurityPool securityPool,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes
	) external;
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external;
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
