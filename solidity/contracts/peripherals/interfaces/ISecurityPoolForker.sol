// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { IUniformPriceDualCapBatchAuction } from './IUniformPriceDualCapBatchAuction.sol';

interface ISecurityPoolForker {
	function getOwnForkRepBuckets(ISecurityPool securityPool) external view returns (
		uint256 vaultRepAtFork,
		uint256 unallocatedEscrowChildRep,
		uint256 escrowSourceRepAtFork
	);
	function getOwnForkMigrationStatus(ISecurityPool securityPool) external view returns (
		bool ownFork,
		uint256 auctionableRepAtFork,
		uint256 vaultRepAtFork,
		uint256 unallocatedEscrowChildRep,
		uint256 escrowSourceRepAtFork
	);
	function getForkedEscrowPrincipalByOutcomeAndVault(ISecurityPool securityPool, uint8 outcomeIndex, address vault) external view returns (uint256);
	function getForkedEscrowChildRepByOutcomeAndVault(ISecurityPool securityPool, uint8 outcomeIndex, address vault) external view returns (uint256);
	function recordForkedEscrow(ISecurityPool securityPool, address vault, BinaryOutcomes.BinaryOutcome outcome, uint256 principalAmount, uint256 childRepAmount) external;
	function consumeForkedEscrow(
		ISecurityPool securityPool,
		address vault,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 principalAmount
	) external returns (uint256 forkedEscrowPrincipal, uint256 forkedEscrowChildRep, uint256 childRepToRelease);
	function initiateSecurityPoolFork(ISecurityPool securityPool) external;
	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) external;
	function createChildUniverse(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function migrateVault(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function migrateVaultWithUnresolvedEscalation(ISecurityPool securityPool, address vault, uint8 childOutcomeIndex) external;
	function claimForkedEscalationDeposits(ISecurityPool securityPool, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] memory depositIndexes) external;
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory tickIndices) external;
	function settleAuctionBids(ISecurityPool securityPool, address vault, IUniformPriceDualCapBatchAuction.TickIndex[] memory claimTickIndices, IUniformPriceDualCapBatchAuction.TickIndex[] memory refundTickIndices) external;
	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
