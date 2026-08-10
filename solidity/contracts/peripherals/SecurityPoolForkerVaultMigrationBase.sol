// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { EscalationGame } from './EscalationGame.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData, OwnForkChildRepAllocation } from './SecurityPoolForkerTypes.sol';

abstract contract SecurityPoolForkerVaultMigrationBase is SecurityPoolForkerBase {
	event ChildPoolLinked(ISecurityPool indexed parent, uint256 indexed outcomeIndex, ISecurityPool indexed child, UniformPriceDualCapBatchAuction truthAuction);
	event ChildRepSplit(ISecurityPool indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep);
	event ClaimForkedEscalationDepositsToWallet(ISecurityPool indexed parent, address indexed vault, BinaryOutcomes.BinaryOutcome indexed outcomeIndex, uint256[] depositIndexes, uint256 sourceRepClaimedAttoRep, uint256 walletRepPaidAttoRep, bool ownFork);

	function _validateChildPoolDeployment(ISecurityPool parent, ISecurityPool child, UniformPriceDualCapBatchAuction truthAuction, uint256, uint248 childUniverseId) internal view {
		address parentFactory = address(parent.securityPoolFactory());
		require(address(child) != address(0x0) && address(truthAuction) != address(0x0) && address(truthAuction).code.length != 0 && !trustedAuctionAddresses[address(truthAuction)] && address(forkDataByPool[child].truthAuction) == address(0x0) && address(child.parent()) == address(parent) && child.universeId() == childUniverseId && address(child.securityPoolFactory()) == parentFactory && child.securityPoolForker() == address(this) && child.truthAuction() == address(truthAuction), 'Invalid child');
	}

	function _getOrDeployChildPool(ISecurityPool parent, uint256 outcomeIndex) internal returns (ISecurityPool child, EscalationGame childEscalationGame) {
		child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) {
			require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
			require(block.timestamp <= forkDataByPool[parent].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME, 'Migration closed');
			uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(parent.universeId(), outcomeIndex))));
			if (address(zoltar.getRepToken(childUniverseId)) == address(0x0)) {
				zoltar.deployChild(parent.universeId(), outcomeIndex);
			}

			uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(parent.settlementCollateralAttoEth(), parent.getCurrentMintingCapacityAttoEth());
			UniformPriceDualCapBatchAuction truthAuction;
			(child, truthAuction) = parent.securityPoolFactory().deployChildSecurityPool(parent, parent.shareToken(), childUniverseId, parent.questionId(), parent.statoblastSecurityMultiplierBps(), retentionRate, 0);
			_validateChildPoolDeployment(parent, child, truthAuction, outcomeIndex, childUniverseId);
			SecurityPoolForkerForkData storage childData = forkDataByPool[child];
			childData.outcomeIndex = outcomeIndex;
			childData.truthAuction = truthAuction;
			SecurityPoolForkerForkData storage parentData = forkDataByPool[parent];
			childData.fixedQuestionOutcomePlusOne =
				parentData.forkQuestionMatchesPoolQuestion
					? uint8(outcomeIndex + 1)
					: parentData.fixedQuestionOutcomePlusOne;
			trustedAuctionAddresses[address(truthAuction)] = true;
			childrenByPoolAndOutcome[parent][outcomeIndex] = child;
			parent.authorizeChildPool(child);
			emit ChildPoolLinked(parent, outcomeIndex, child, truthAuction);

			if (forkDataByPool[parent].ownFork && forkDataByPool[parent].vaultRepAtForkAttoRep > 0) {
				uint256 parentDenominator = parent.totalRepBackingUnits();
				uint256 childDenominator =
					parentDenominator == 0
						? forkDataByPool[parent].vaultRepAtForkAttoRep * SecurityPoolUtils.PRICE_PRECISION
						: parentDenominator;
				child.setTotalRepBackingUnits(childDenominator);
			} else if (forkDataByPool[parent].ownFork) {
				child.setTotalRepBackingUnits(forkDataByPool[parent].auctionableAttoRepAtFork * SecurityPoolUtils.PRICE_PRECISION);
			} else {
				child.setTotalRepBackingUnits(parent.totalRepBackingUnits());
			}
			if (forkDataByPool[parent].unresolvedEscalationAtFork) {
				child.setAwaitingForkContinuation(true);
			}
		}

		childEscalationGame = child.escalationGame();
		_validateChildEscalationGame(child, childEscalationGame);
		childEscalationGame = _initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame);
		_validateChildEscalationGame(child, childEscalationGame);
		_ensureChildEscalationBacking(parent, outcomeIndex, child, childEscalationGame);
		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _ensureChildEscalationBacking(ISecurityPool parent, uint256 outcomeIndex, ISecurityPool child, EscalationGame childEscalationGame) internal {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		if (
			!parentForkData.unresolvedEscalationAtFork ||
			escalationBackingMaterializedByPoolAndOutcome[parent][outcomeIndex]
		) return;
		escalationBackingMaterializedByPoolAndOutcome[parent][outcomeIndex] = true;
		uint256 childRepAmountAttoRep = parentForkData.escalationChildRepAtForkAttoRep;
		require(address(childEscalationGame) != address(0x0), 'Child game');
		if (childRepAmountAttoRep > 0) {
			_splitMigrationRepToChild(parent, outcomeIndex, childRepAmountAttoRep, parentForkData.ownFork, true);
			SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
			require(address(migrationProxy) != address(0x0), 'Proxy missing');
			migrationProxy.sweepChildRep(address(childEscalationGame), child.repToken(), childRepAmountAttoRep);
		}
		emit ChildDisputeStakedRepMaterialized(parent, child, address(childEscalationGame), outcomeIndex, childRepAmountAttoRep, child.repToken().balanceOf(address(childEscalationGame)));
	}

	function _sweepChildRepToPool(ISecurityPool parent, uint256 outcomeIndex) internal {
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) return;
		uint256 pendingChildAttoRep = pendingChildRepByPoolAndOutcome[parent][outcomeIndex];
		if (pendingChildAttoRep == 0) return;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'Proxy missing');
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] = 0;
		migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildAttoRep);
		emit PoolHeldRepSweptToChild(parent, child, outcomeIndex, pendingChildAttoRep, child.repToken().balanceOf(address(child)));
	}

	function _transferForkMigratedCollateralToChild(ISecurityPool parent, ISecurityPool child, uint256 childRepAmountAttoRep) internal {
		if (childRepAmountAttoRep == 0) return;
		parent.updateSettlementCollateral();
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		uint256 vaultRepAtForkAttoRep =
			parentForkData.ownFork ? parentForkData.vaultRepAtForkAttoRep : parentForkData.auctionableAttoRepAtFork;
		uint256 parentSettlementCollateralAtForkAttoEth = parentForkData.settlementCollateralAtForkAttoEth;
		if (vaultRepAtForkAttoRep == 0 || parentSettlementCollateralAtForkAttoEth == 0) return;
		uint256 nextRepTransferredAttoRep =
			parentForkData.migratedRepAllocatedForSettlementCollateralAttoRep + childRepAmountAttoRep;
		require(nextRepTransferredAttoRep <= vaultRepAtForkAttoRep, 'Collateral high');
		uint256 targetSettlementCollateralTransferredAttoEth = Math.ceilDiv(parentSettlementCollateralAtForkAttoEth * nextRepTransferredAttoRep, vaultRepAtForkAttoRep);
		uint256 settlementCollateralToTransferAttoEth =
			targetSettlementCollateralTransferredAttoEth - parentForkData.settlementCollateralTransferredAttoEth;
		uint256 availableSettlementCollateralAttoEth = parent.settlementCollateralAttoEth();
		if (settlementCollateralToTransferAttoEth > availableSettlementCollateralAttoEth)
			settlementCollateralToTransferAttoEth = availableSettlementCollateralAttoEth;
		parentForkData.migratedRepAllocatedForSettlementCollateralAttoRep = nextRepTransferredAttoRep;
		parentForkData.settlementCollateralTransferredAttoEth += settlementCollateralToTransferAttoEth;
		forkDataByPool[child].forkSettlementCollateralReceivedAttoEth += settlementCollateralToTransferAttoEth;
		if (settlementCollateralToTransferAttoEth == 0) return;
		parent.transferEth(payable(address(child)), settlementCollateralToTransferAttoEth);
	}

	function _ensureMigratedVaultRepBacked(ISecurityPool parent, ISecurityPool child, uint256 requiredMigratedAttoRep) internal {
		if (requiredMigratedAttoRep == 0) return;
		uint256 outcomeIndex = forkDataByPool[child].outcomeIndex;
		_ensureChildPoolRepSplit(parent, outcomeIndex, requiredMigratedAttoRep);
		require(child.repToken().balanceOf(address(child)) >= requiredMigratedAttoRep, 'Child REP short');
	}

	function _ensureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 requiredSplitAttoRep) internal {
		uint256 alreadySplitAttoRep = childPoolRepSplitByPoolAndOutcome[parent][outcomeIndex];
		if (alreadySplitAttoRep >= requiredSplitAttoRep) return;
		uint256 splitShortfallAttoRep = requiredSplitAttoRep - alreadySplitAttoRep;
		_splitMigrationRepToChild(parent, outcomeIndex, splitShortfallAttoRep, forkDataByPool[parent].ownFork, false);
		childPoolRepSplitByPoolAndOutcome[parent][outcomeIndex] = requiredSplitAttoRep;
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] += splitShortfallAttoRep;
		emit ChildRepSplit(parent, outcomeIndex, childPoolRepSplitByPoolAndOutcome[parent][outcomeIndex], pendingChildRepByPoolAndOutcome[parent][outcomeIndex]);
		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _emitVaultMigrationCheckpoint(ISecurityPool parent, ISecurityPool child, address vault, uint256 migratedAttoRep, uint256 settlementCollateralTransferredAttoEthBefore) private {
		(uint256 parentBackingUnits, uint256 parentCapacityOwnershipAttoRep, , ) = parent.securityVaults(vault);
		(uint256 childBackingUnits, uint256 childCapacityOwnershipAttoRep, , ) = child.securityVaults(vault);
		emit VaultMigrationCheckpoint(parent, child, vault, forkDataByPool[child].outcomeIndex, migratedAttoRep, forkDataByPool[child].migratedAttoRep, parentBackingUnits, parentCapacityOwnershipAttoRep, childBackingUnits, childCapacityOwnershipAttoRep, parent.totalRepBackingUnits(), child.totalRepBackingUnits(), parent.totalCapacityOwnershipAttoRep(), child.totalCapacityOwnershipAttoRep(), forkDataByPool[parent].settlementCollateralTransferredAttoEth - settlementCollateralTransferredAttoEthBefore, forkDataByPool[parent].settlementCollateralTransferredAttoEth);
	}

	function _migrateNonEscrowedVaultAccounting(ISecurityPool parent, ISecurityPool child, address vault) internal returns (uint256 migratedAttoRep) {
		uint256 settlementCollateralTransferredAttoEthBefore = forkDataByPool[parent]
			.settlementCollateralTransferredAttoEth;
		uint256 parentRepAtForkAttoRep =
			forkDataByPool[parent].ownFork
				? forkDataByPool[parent].vaultRepAtForkAttoRep
				: forkDataByPool[parent].auctionableAttoRepAtFork;
		child.updateVaultFees(vault);
		// Checkpoint the parent entitlement in the same routine that clears the
		// capacity ownership, so future migration entry points cannot strand reserve fees.
		parent.updateVaultFees(vault);
		(uint256 parentRepBackingUnits, uint256 parentCapacityOwnershipAttoRep, , uint256 parentVaultFeeIndex) = parent.securityVaults(vault);
		(
			uint256 childCurrentRepBackingUnits,
			uint256 childCurrentCapacityOwnershipAttoRep,
			,
			uint256 childCurrentFeeIndex
		) = child.securityVaults(vault);
		forkDataByPool[child].migratedCapacityOwnershipAttoRep += parentCapacityOwnershipAttoRep;
		uint256 vaultRepBackingUnits = childCurrentRepBackingUnits + parentRepBackingUnits;
		uint256 vaultFeeIndex = childCurrentCapacityOwnershipAttoRep > 0 ? childCurrentFeeIndex : 0;
		if (parentCapacityOwnershipAttoRep > 0) vaultFeeIndex = child.feeIndex();
		uint256 parentBackingUnitsDenominator = parent.totalRepBackingUnits();
		if (parentBackingUnitsDenominator > 0 && parentRepAtForkAttoRep > 0 && parentRepBackingUnits > 0) {
			SecurityPoolForkerForkData storage childForkData = forkDataByPool[child];
			childForkData.migratedRepBackingUnits += parentRepBackingUnits;
			migratedAttoRep =
				childForkData.migratedRepBackingUnits == parentBackingUnitsDenominator
					? parentRepAtForkAttoRep - childForkData.migratedAttoRep
					: (parentRepBackingUnits * parentRepAtForkAttoRep) / parentBackingUnitsDenominator;
			uint256 nextMigratedAttoRep = childForkData.migratedAttoRep + migratedAttoRep;
			_ensureMigratedVaultRepBacked(parent, child, nextMigratedAttoRep);
			childForkData.migratedAttoRep = nextMigratedAttoRep;
			_transferForkMigratedCollateralToChild(parent, child, migratedAttoRep);
		}

		(uint256 parentVaultBadDebtAttoEth, , ) = SecurityPoolUtils.configureForkMigratedVault(parent, child, vault, vaultRepBackingUnits, childCurrentCapacityOwnershipAttoRep + parentCapacityOwnershipAttoRep, vaultFeeIndex, parentVaultFeeIndex);
		migratedBadDebtByPool[child] += parentVaultBadDebtAttoEth;
		_emitVaultMigrationCheckpoint(parent, child, vault, migratedAttoRep, settlementCollateralTransferredAttoEthBefore);
	}

	function _recordAllocatedVaultMigrationRep(ISecurityPool parent, uint256 outcomeIndex, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		OwnForkChildRepAllocation storage allocated = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex];
		uint256 newAllocatedAmount = allocated.vaultChildRepUsedAttoRep + amountAttoRep;
		require(newAllocatedAmount <= forkDataByPool[parent].vaultRepAtForkAttoRep, 'Vault REP high');
		allocated.vaultChildRepUsedAttoRep = newAllocatedAmount;
	}

	function _recordAllocatedEscalationMigrationRep(ISecurityPool parent, uint256 outcomeIndex, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		OwnForkChildRepAllocation storage allocated = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex];
		uint256 newAllocatedAmount = allocated.escrowChildRepUsedAttoRep + amountAttoRep;
		uint256 escalationChildRepAtForkAttoRep = forkDataByPool[parent].escalationChildRepAtForkAttoRep;
		require(newAllocatedAmount <= escalationChildRepAtForkAttoRep, 'Escrow REP high');
		allocated.escrowChildRepUsedAttoRep = newAllocatedAmount;
	}

	function _splitMigrationRepToChild(ISecurityPool parent, uint256 outcomeIndex, uint256 amountAttoRep, bool enforceOwnForkAllocationCap, bool fromEscalationBucket) internal {
		if (amountAttoRep == 0) return;
		if (enforceOwnForkAllocationCap) {
			if (fromEscalationBucket) {
				_recordAllocatedEscalationMigrationRep(parent, outcomeIndex, amountAttoRep);
			} else {
				_recordAllocatedVaultMigrationRep(parent, outcomeIndex, amountAttoRep);
			}
		}
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'Proxy missing');
		uint256[] memory outcomeIndices = new uint256[](1);
		outcomeIndices[0] = outcomeIndex;
		migrationProxy.splitToChild(amountAttoRep, outcomeIndices);
	}
}
