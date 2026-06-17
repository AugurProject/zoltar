// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame, MERKLE_MOUNTAIN_RANGE_MAX_PEAKS } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerStorage } from './SecurityPoolForkerStorage.sol';
import {
	SecurityPoolForkerForkData,
	OwnForkChildRepAllocation
} from './SecurityPoolForkerTypes.sol';

abstract contract SecurityPoolForkerVaultMigrationBase is SecurityPoolForkerStorage {
	Zoltar public immutable zoltar;

	event MigrateVault(address vault, uint8 outcome, uint256 poolOwnership, uint256 securityBondAllowance);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentPoolOwnership);
	event ClaimForkedEscalationDepositsToWallet(
		ISecurityPool parent,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] depositIndexes,
		uint256 sourceRepAmount
	);

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function repToPoolOwnership(ISecurityPool securityPool, uint256 repAmount) public view returns (uint256) {
		uint256 poolOwnershipDenominator = securityPool.poolOwnershipDenominator();
		uint256 childRepBalance = securityPool.repToken().balanceOf(address(securityPool));
		if (poolOwnershipDenominator == 0 || childRepBalance == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * poolOwnershipDenominator / childRepBalance;
	}

	function poolOwnershipToRep(ISecurityPool securityPool, uint256 poolOwnership) public view returns (uint256) {
		return poolOwnership * securityPool.repToken().balanceOf(address(securityPool)) / securityPool.poolOwnershipDenominator();
	}

	function _getOrDeployChildPool(ISecurityPool parent, uint8 outcomeIndex) internal returns (ISecurityPool child) {
		child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) {
			require(parent.systemState() == SystemState.PoolForked, 'e1');
			require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'e2');
			uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(parent.universeId(), outcomeIndex))));
			if (address(zoltar.getRepToken(childUniverseId)) == address(0x0)) {
				zoltar.deployChild(parent.universeId(), outcomeIndex);
			}

			uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(parent.completeSetCollateralAmount(), parent.totalSecurityBondAllowance());
			UniformPriceDualCapBatchAuction truthAuction;
			(child, truthAuction) = parent.securityPoolFactory().deployChildSecurityPool(parent, parent.shareToken(), childUniverseId, parent.questionId(), parent.securityMultiplier(), retentionRate, 0);
			forkDataByPool[child].outcomeIndex = outcomeIndex;
			forkDataByPool[child].truthAuction = truthAuction;
			trustedAuctionAddresses[address(truthAuction)] = true;
			childrenByPoolAndOutcome[parent][outcomeIndex] = child;
			parent.authorizeChildPool(child);

			if (forkDataByPool[parent].ownFork && forkDataByPool[parent].vaultRepAtFork > 0) {
				uint256 parentDenominator = parent.poolOwnershipDenominator();
				uint256 childDenominator = parentDenominator == 0 ?
					forkDataByPool[parent].vaultRepAtFork * SecurityPoolUtils.PRICE_PRECISION :
					parentDenominator;
				child.setOwnershipDenominator(childDenominator);
			} else if (forkDataByPool[parent].ownFork) {
				child.setOwnershipDenominator(forkDataByPool[parent].auctionableRepAtFork * SecurityPoolUtils.PRICE_PRECISION);
			} else {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator());
			}
			if (forkDataByPool[parent].unresolvedEscalationAtFork) {
				child.setAwaitingForkContinuation(true);
			}
		}

		_initializeChildForkedEscalationGameIfNeeded(parent, child);
		_sweepChildRepToPool(parent, outcomeIndex);
	}

	function _sweepChildRepToPool(ISecurityPool parent, uint8 outcomeIndex) internal {
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) return;
		uint256 pendingChildRep = pendingChildRepByPoolAndOutcome[parent][outcomeIndex];
		if (pendingChildRep == 0) return;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'e3');
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] = 0;
		migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildRep);
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal virtual {
		EscalationGame parentEscalationGame = parent.escalationGame();
		EscalationGame childEscalationGame = child.escalationGame();
		if (
			forkDataByPool[parent].unresolvedEscalationAtFork &&
			address(parentEscalationGame) != address(0x0) &&
			address(childEscalationGame) != address(0x0) &&
			!childEscalationGame.forkCarrySnapshotInitialized()
		) {
			(
				bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory inheritedCarryPeaks,
				uint256[3] memory inheritedCarryLeafCounts,
				uint256[3] memory inheritedCarryTotals,
				bytes32[3] memory inheritedNullifierRoots
			) = parentEscalationGame.getForkCarrySnapshot();
			child.initializeForkCarrySnapshot(
				inheritedCarryPeaks,
				inheritedCarryLeafCounts,
				inheritedCarryTotals,
				inheritedNullifierRoots
			);
		}
	}

	function _initializeOwnForkRepBuckets(ISecurityPool parent, uint256 vaultRepAtFork, uint256 escalationChildRepAtFork, uint256 escalationSourceRep) internal {
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[parent];
		repBuckets.vaultRepAtFork = vaultRepAtFork;
		repBuckets.escalationChildRepAtFork = escalationChildRepAtFork;
		repBuckets.escalationSourceRepAtFork = escalationSourceRep;
	}

	function _previewOwnForkEscalationRep(ISecurityPool parent, uint256 sourceRepAmount) internal view returns (uint256 childRepAmount) {
		if (sourceRepAmount == 0) return 0;
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[parent];
		uint256 escalationSourceRepAtFork = repBuckets.escalationSourceRepAtFork;
		require(escalationSourceRepAtFork > 0, 'ofe');
		return sourceRepAmount * repBuckets.escalationChildRepAtFork / escalationSourceRepAtFork;
	}

	function _migrateVaultUnlockedState(ISecurityPool parent, ISecurityPool child, address vault) internal returns (uint256 migratedRep) {
		bool shouldTransferCollateral = !forkDataByPool[parent].ownFork;
		return _migrateVaultUnlockedState(parent, child, vault, shouldTransferCollateral);
	}

	function _transferOwnForkMigratedCollateralToChild(ISecurityPool parent, ISecurityPool child, uint256 childRepAmount) internal {
		if (childRepAmount == 0) return;
		parent.updateCollateralAmount();
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		uint256 vaultRepAtFork = parentForkData.vaultRepAtFork;
		uint256 parentCollateralAtFork = parentForkData.ownForkCollateralAtFork;
		if (vaultRepAtFork == 0 || parentCollateralAtFork == 0) return;
		uint256 nextRepTransferred = parentForkData.ownForkMigratedRepCollateralized + childRepAmount;
		require(nextRepTransferred <= vaultRepAtFork, 'own fork collateral transfer exceeds fork REP');
		uint256 nextCollateralTransferred = Math.ceilDiv(parentCollateralAtFork * nextRepTransferred, vaultRepAtFork);
		uint256 ethToTransfer = nextCollateralTransferred - parentForkData.ownForkCollateralTransferred;
		parentForkData.ownForkMigratedRepCollateralized = nextRepTransferred;
		parentForkData.ownForkCollateralTransferred = nextCollateralTransferred;
		if (ethToTransfer == 0) return;
		parent.transferEth(payable(address(child)), ethToTransfer);
	}

	function _migrateVaultUnlockedState(
		ISecurityPool parent,
		ISecurityPool child,
		address vault,
		bool shouldTransferCollateral
	) internal returns (uint256 migratedRep) {
		uint256 parentRepAtFork = forkDataByPool[parent].ownFork ? forkDataByPool[parent].vaultRepAtFork : forkDataByPool[parent].auctionableRepAtFork;
		child.updateVaultFees(vault);
		parent.updateCollateralAmount();
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , uint256 parentVaultFeeIndex) = parent.securityVaults(vault);
		(uint256 childCurrentPoolOwnership, uint256 childCurrentSecurityBondAllowance, , uint256 childCurrentFeeIndex) = child.securityVaults(vault);
		emit MigrateRepFromParent(vault, parentSecurityBondAllowance, parentPoolOwnership);
		forkDataByPool[child].migratedSecurityBondAllowance += parentSecurityBondAllowance;

		uint256 vaultPoolOwnership = childCurrentPoolOwnership + parentPoolOwnership;
		uint256 vaultFeeIndex = childCurrentSecurityBondAllowance > 0 ? childCurrentFeeIndex : 0;
		if (parentSecurityBondAllowance > 0) vaultFeeIndex = child.feeIndex();
		if (parent.poolOwnershipDenominator() > 0 && parentRepAtFork > 0 && parentPoolOwnership > 0) {
			migratedRep = parentPoolOwnership * parentRepAtFork / parent.poolOwnershipDenominator();
			forkDataByPool[child].migratedRep += migratedRep;
			if (shouldTransferCollateral) {
				uint256 collateralToTransfer = parent.completeSetCollateralAmount() * migratedRep / parentRepAtFork;
				parent.transferEth(payable(child), collateralToTransfer);
			} else if (forkDataByPool[parent].ownFork) {
				_transferOwnForkMigratedCollateralToChild(parent, child, migratedRep);
			}
		}

		child.configureVault(vault, vaultPoolOwnership, childCurrentSecurityBondAllowance + parentSecurityBondAllowance, vaultFeeIndex);
		emit MigrateVault(vault, forkDataByPool[child].outcomeIndex, parentPoolOwnership, parentSecurityBondAllowance);
		parent.configureVault(vault, 0, 0, parentVaultFeeIndex);
	}

	function _recordAllocatedVaultMigrationRep(ISecurityPool parent, uint8 outcomeIndex, uint256 amount) internal {
		if (amount == 0) return;
		OwnForkChildRepAllocation storage allocated = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex];
		uint256 newAllocatedAmount = allocated.vaultChildRepUsed + amount;
		require(newAllocatedAmount <= forkDataByPool[parent].vaultRepAtFork, 'vm');
		allocated.vaultChildRepUsed = newAllocatedAmount;
	}

	function _recordAllocatedEscalationMigrationRep(ISecurityPool parent, uint8 outcomeIndex, uint256 amount) internal {
		if (amount == 0) return;
		OwnForkChildRepAllocation storage allocated = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex];
		uint256 newAllocatedAmount = allocated.escrowChildRepUsed + amount;
		uint256 escalationChildRepAtFork = forkDataByPool[parent].escalationChildRepAtFork;
		require(newAllocatedAmount <= escalationChildRepAtFork, 'em');
		allocated.escrowChildRepUsed = newAllocatedAmount;
	}

	function _capOwnForkEscalationChildRep(ISecurityPool parent, uint8 outcomeIndex, uint256 requestedAmount) internal view returns (uint256) {
		uint256 escalationChildRepAtFork = forkDataByPool[parent].escalationChildRepAtFork;
		uint256 allocatedAmount = ownForkChildRepAllocationByPoolAndOutcome[parent][outcomeIndex].escrowChildRepUsed;
		if (allocatedAmount >= escalationChildRepAtFork) return 0;
		uint256 remainingAmount = escalationChildRepAtFork - allocatedAmount;
		return requestedAmount < remainingAmount ? requestedAmount : remainingAmount;
	}

	function _splitMigrationRepToChild(
		ISecurityPool parent,
		uint8 outcomeIndex,
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
		require(address(migrationProxy) != address(0x0), 'e3');
		uint256[] memory outcomeIndices = new uint256[](1);
		outcomeIndices[0] = outcomeIndex;
		migrationProxy.splitToChild(amount, outcomeIndices);
	}
}
