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
	event ChildPoolLinked(
		ISecurityPool indexed parent,
		uint256 indexed outcomeIndex,
		ISecurityPool indexed child,
		UniformPriceDualCapBatchAuction truthAuction
	);
	event ChildRepSplit(
		ISecurityPool indexed parent,
		uint256 indexed outcomeIndex,
		uint256 childPoolRepSplit,
		uint256 pendingChildRep
	);
	event ClaimForkedEscalationDepositsToWallet(
		ISecurityPool indexed parent,
		address indexed vault,
		BinaryOutcomes.BinaryOutcome indexed outcomeIndex,
		uint256[] depositIndexes,
		uint256 sourceRepClaimed,
		uint256 walletRepPaid,
		bool ownFork
	);

	function _validateChildPoolDeployment(
		ISecurityPool parent,
		ISecurityPool child,
		UniformPriceDualCapBatchAuction truthAuction,
		uint256,
		uint248 childUniverseId
	) internal view {
		address parentFactory = address(parent.securityPoolFactory());
		require(
			address(child) != address(0x0) &&
				address(truthAuction) != address(0x0) &&
				address(forkDataByPool[child].truthAuction) == address(0x0) &&
				address(child.parent()) == address(parent) &&
				child.universeId() == childUniverseId &&
				address(child.securityPoolFactory()) == parentFactory &&
				child.securityPoolForker() == address(this) &&
				child.truthAuction() == address(truthAuction),
			'Invalid child deployment'
		);
	}

	function _getOrDeployChildPool(ISecurityPool parent, uint256 outcomeIndex) internal returns (ISecurityPool child) {
		child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) {
			require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
			require(
				block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME,
				'Migration closed'
			);
			uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(parent.universeId(), outcomeIndex))));
			if (address(zoltar.getRepToken(childUniverseId)) == address(0x0)) {
				zoltar.deployChild(parent.universeId(), outcomeIndex);
			}

			uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(
				parent.completeSetCollateralAmount(),
				parent.totalSecurityBondAllowance()
			);
			UniformPriceDualCapBatchAuction truthAuction;
			(child, truthAuction) = parent.securityPoolFactory().deployChildSecurityPool(
				parent,
				parent.shareToken(),
				childUniverseId,
				parent.questionId(),
				parent.securityMultiplier(),
				retentionRate,
				0
			);
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

			if (forkDataByPool[parent].ownFork && forkDataByPool[parent].vaultRepAtFork > 0) {
				uint256 parentDenominator = parent.poolOwnershipDenominator();
				uint256 childDenominator =
					parentDenominator == 0
						? forkDataByPool[parent].vaultRepAtFork * SecurityPoolUtils.PRICE_PRECISION
						: parentDenominator;
				child.setOwnershipDenominator(childDenominator);
			} else if (forkDataByPool[parent].ownFork) {
				child.setOwnershipDenominator(
					forkDataByPool[parent].auctionableRepAtFork * SecurityPoolUtils.PRICE_PRECISION
				);
			} else {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator());
			}
			if (forkDataByPool[parent].unresolvedEscalationAtFork) {
				child.setAwaitingForkContinuation(true);
			}
		}

		_initializeChildForkedEscalationGameIfNeeded(parent, child);
		_ensureChildEscalationBacking(parent, outcomeIndex, child);
		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _ensureChildEscalationBacking(ISecurityPool parent, uint256 outcomeIndex, ISecurityPool child) internal {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		if (
			!parentForkData.unresolvedEscalationAtFork ||
			escalationBackingMaterializedByPoolAndOutcome[parent][outcomeIndex]
		) return;
		escalationBackingMaterializedByPoolAndOutcome[parent][outcomeIndex] = true;
		uint256 childRepAmount = parentForkData.escalationChildRepAtFork;
		EscalationGame childEscalationGame = child.escalationGame();
		require(address(childEscalationGame) != address(0x0), 'Child game');
		if (childRepAmount > 0) {
			_splitMigrationRepToChild(parent, outcomeIndex, childRepAmount, parentForkData.ownFork, true);
			SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
			require(address(migrationProxy) != address(0x0), 'Proxy missing');
			migrationProxy.sweepChildRep(address(childEscalationGame), child.repToken(), childRepAmount);
		}
		emit ChildEscalationRepMaterialized(
			parent,
			child,
			address(childEscalationGame),
			outcomeIndex,
			childRepAmount,
			child.repToken().balanceOf(address(childEscalationGame))
		);
	}

	function _sweepChildRepToPool(ISecurityPool parent, uint256 outcomeIndex) internal {
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) return;
		uint256 pendingChildRep = pendingChildRepByPoolAndOutcome[parent][outcomeIndex];
		if (pendingChildRep == 0) return;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'Proxy missing');
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] = 0;
		migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildRep);
		emit ChildPoolRepSwept(
			parent,
			child,
			outcomeIndex,
			pendingChildRep,
			child.repToken().balanceOf(address(child))
		);
	}

	function _transferForkMigratedCollateralToChild(
		ISecurityPool parent,
		ISecurityPool child,
		uint256 childRepAmount
	) internal {
		if (childRepAmount == 0) return;
		parent.updateCollateralAmount();
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		uint256 vaultRepAtFork =
			parentForkData.ownFork ? parentForkData.vaultRepAtFork : parentForkData.auctionableRepAtFork;
		uint256 parentCollateralAtFork = parentForkData.collateralAtFork;
		if (vaultRepAtFork == 0 || parentCollateralAtFork == 0) return;
		uint256 nextRepTransferred = parentForkData.migratedRepCollateralized + childRepAmount;
		require(nextRepTransferred <= vaultRepAtFork, 'Collateral high');
		uint256 targetCollateralTransferred = Math.ceilDiv(parentCollateralAtFork * nextRepTransferred, vaultRepAtFork);
		uint256 ethToTransfer = targetCollateralTransferred - parentForkData.collateralTransferred;
		uint256 availableCollateral = parent.completeSetCollateralAmount();
		if (ethToTransfer > availableCollateral) ethToTransfer = availableCollateral;
		parentForkData.migratedRepCollateralized = nextRepTransferred;
		parentForkData.collateralTransferred += ethToTransfer;
		forkDataByPool[child].forkCollateralReceived += ethToTransfer;
		if (ethToTransfer == 0) return;
		parent.transferEth(payable(address(child)), ethToTransfer);
	}

	function _ensureMigratedVaultRepBacked(
		ISecurityPool parent,
		ISecurityPool child,
		uint256 requiredMigratedRep
	) internal {
		if (requiredMigratedRep == 0) return;
		uint256 outcomeIndex = forkDataByPool[child].outcomeIndex;
		_ensureChildPoolRepSplit(parent, outcomeIndex, requiredMigratedRep);
		require(child.repToken().balanceOf(address(child)) >= requiredMigratedRep, 'Child REP short');
	}

	function _ensureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 requiredSplit) internal {
		uint256 alreadySplit = childPoolRepSplitByPoolAndOutcome[parent][outcomeIndex];
		if (alreadySplit >= requiredSplit) return;
		uint256 shortfall = requiredSplit - alreadySplit;
		_splitMigrationRepToChild(parent, outcomeIndex, shortfall, forkDataByPool[parent].ownFork, false);
		childPoolRepSplitByPoolAndOutcome[parent][outcomeIndex] = requiredSplit;
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] += shortfall;
		emit ChildRepSplit(
			parent,
			outcomeIndex,
			childPoolRepSplitByPoolAndOutcome[parent][outcomeIndex],
			pendingChildRepByPoolAndOutcome[parent][outcomeIndex]
		);
		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _migrateVaultUnlockedState(
		ISecurityPool parent,
		ISecurityPool child,
		address vault
	) internal returns (uint256 migratedRep) {
		uint256 collateralTransferredBefore = forkDataByPool[parent].collateralTransferred;
		uint256 parentRepAtFork =
			forkDataByPool[parent].ownFork
				? forkDataByPool[parent].vaultRepAtFork
				: forkDataByPool[parent].auctionableRepAtFork;
		child.updateVaultFees(vault);
		// Checkpoint the parent entitlement in the same routine that clears the
		// allowance, so future migration entry points cannot strand reserve fees.
		parent.updateVaultFees(vault);
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , uint256 parentVaultFeeIndex) = parent
			.securityVaults(vault);
		(
			uint256 childCurrentPoolOwnership,
			uint256 childCurrentSecurityBondAllowance,
			,
			uint256 childCurrentFeeIndex
		) = child.securityVaults(vault);
		forkDataByPool[child].migratedSecurityBondAllowance += parentSecurityBondAllowance;

		uint256 vaultPoolOwnership = childCurrentPoolOwnership + parentPoolOwnership;
		uint256 vaultFeeIndex = childCurrentSecurityBondAllowance > 0 ? childCurrentFeeIndex : 0;
		if (parentSecurityBondAllowance > 0) vaultFeeIndex = child.feeIndex();
		if (parent.poolOwnershipDenominator() > 0 && parentRepAtFork > 0 && parentPoolOwnership > 0) {
			migratedRep = (parentPoolOwnership * parentRepAtFork) / parent.poolOwnershipDenominator();
			SecurityPoolForkerForkData storage childForkData = forkDataByPool[child];
			uint256 nextMigratedRep = childForkData.migratedRep + migratedRep;
			_ensureMigratedVaultRepBacked(parent, child, nextMigratedRep);
			childForkData.migratedRep = nextMigratedRep;
			_transferForkMigratedCollateralToChild(parent, child, migratedRep);
		}

		child.configureVault(
			vault,
			vaultPoolOwnership,
			childCurrentSecurityBondAllowance + parentSecurityBondAllowance,
			vaultFeeIndex
		);
		parent.configureVault(vault, 0, 0, parentVaultFeeIndex);
		(uint256 resultingParentOwnership, uint256 resultingParentAllowance, , ) = parent.securityVaults(vault);
		(uint256 resultingChildOwnership, uint256 resultingChildAllowance, , ) = child.securityVaults(vault);
		emit VaultMigrationCheckpoint(
			parent,
			child,
			vault,
			forkDataByPool[child].outcomeIndex,
			migratedRep,
			forkDataByPool[child].migratedRep,
			resultingParentOwnership,
			resultingParentAllowance,
			resultingChildOwnership,
			resultingChildAllowance,
			parent.poolOwnershipDenominator(),
			child.poolOwnershipDenominator(),
			parent.totalSecurityBondAllowance(),
			child.totalSecurityBondAllowance(),
			forkDataByPool[parent].collateralTransferred - collateralTransferredBefore,
			forkDataByPool[parent].collateralTransferred
		);
	}

	function _recordAllocatedVaultMigrationRep(ISecurityPool parent, uint256 outcomeIndex, uint256 amount) internal {
		if (amount == 0) return;
		OwnForkChildRepAllocation storage allocated = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex];
		uint256 newAllocatedAmount = allocated.vaultChildRepUsed + amount;
		require(newAllocatedAmount <= forkDataByPool[parent].vaultRepAtFork, 'Vault REP high');
		allocated.vaultChildRepUsed = newAllocatedAmount;
	}

	function _recordAllocatedEscalationMigrationRep(
		ISecurityPool parent,
		uint256 outcomeIndex,
		uint256 amount
	) internal {
		if (amount == 0) return;
		OwnForkChildRepAllocation storage allocated = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex];
		uint256 newAllocatedAmount = allocated.escrowChildRepUsed + amount;
		uint256 escalationChildRepAtFork = forkDataByPool[parent].escalationChildRepAtFork;
		require(newAllocatedAmount <= escalationChildRepAtFork, 'Escrow REP high');
		allocated.escrowChildRepUsed = newAllocatedAmount;
	}

	function _splitMigrationRepToChild(
		ISecurityPool parent,
		uint256 outcomeIndex,
		uint256 amount,
		bool enforceOwnForkAllocationCap,
		bool fromEscalationBucket
	) internal {
		if (amount == 0) return;
		if (enforceOwnForkAllocationCap) {
			if (fromEscalationBucket) {
				_recordAllocatedEscalationMigrationRep(parent, outcomeIndex, amount);
			} else {
				_recordAllocatedVaultMigrationRep(parent, outcomeIndex, amount);
			}
		}
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'Proxy missing');
		uint256[] memory outcomeIndices = new uint256[](1);
		outcomeIndices[0] = outcomeIndex;
		migrationProxy.splitToChild(amount, outcomeIndices);
	}
}
