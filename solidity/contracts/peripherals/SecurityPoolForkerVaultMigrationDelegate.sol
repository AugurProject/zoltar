// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';

interface ISecurityPoolForkerChildEscalationInitializer {
	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external;
}

struct VaultMigrationForkData {
	uint256 repAtFork;
	UniformPriceDualCapBatchAuction truthAuction;
	uint256 truthAuctionStarted;
	uint256 migratedRep;
	uint256 auctionedSecurityBondAllowance;
	uint256 claimedAuctionRepPurchased;
	uint256 claimedAuctionedSecurityBondAllowance;
	uint256 escalationElapsedAtFork;
	uint256 escalationStartBondAtFork;
	uint256 escalationNonDecisionThresholdAtFork;
	bool ownFork;
	bool unresolvedEscalationAtFork;
	uint8 outcomeIndex;
}

contract SecurityPoolForkerVaultMigrationDelegate {
	Zoltar public immutable zoltar;

	mapping(ISecurityPool => VaultMigrationForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint8 => ISecurityPool)) internal childrenByPoolAndOutcome;
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	mapping(ISecurityPool => mapping(uint8 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(address => bool) private trustedAuctionAddresses;

	event MigrateVault(address vault, uint8 outcome, uint256 poolOwnership, uint256 securityBondAllowance, uint256 parentLockedRepInEscalationGame);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentPoolOwnership);
	event MigrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] depositIndexes, uint256 totalRep, uint256 newOwnership);

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

	function _getOrDeployChildPool(ISecurityPool parent, uint8 outcomeIndex) private returns (ISecurityPool child) {
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

			if (forkDataByPool[parent].ownFork) {
				child.setOwnershipDenominator(parent.poolOwnershipDenominator() * forkDataByPool[parent].repAtFork / (forkDataByPool[parent].repAtFork + parent.escalationGame().nonDecisionThreshold() * 2 / 5));
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

	function _sweepChildRepToPool(ISecurityPool parent, uint8 outcomeIndex) private {
		ISecurityPool child = childrenByPoolAndOutcome[parent][outcomeIndex];
		if (address(child) == address(0x0)) return;
		uint256 pendingChildRep = pendingChildRepByPoolAndOutcome[parent][outcomeIndex];
		if (pendingChildRep == 0) return;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(migrationProxy) != address(0x0), 'e3');
		pendingChildRepByPoolAndOutcome[parent][outcomeIndex] = 0;
		migrationProxy.sweepChildRep(address(child), child.repToken(), pendingChildRep);
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) private {
		ISecurityPoolForkerChildEscalationInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function _creditMigratedEscalationPrincipal(ISecurityPool parent, ISecurityPool child, uint256 migratedPrincipal) private {
		if (migratedPrincipal == 0) return;
		uint256 parentRepAtFork = forkDataByPool[parent].repAtFork;
		forkDataByPool[child].migratedRep += migratedPrincipal;
		if (parentRepAtFork > 0) {
			parent.transferEth(payable(child), parent.completeSetCollateralAmount() * migratedPrincipal / parentRepAtFork);
		}
	}

	function _migrateVaultUnlockedState(ISecurityPool parent, ISecurityPool child, address vault, uint256 lockedRepAlreadyMigrated) private {
		uint256 parentRepAtFork = forkDataByPool[parent].repAtFork;
		VaultMigrationForkData storage parentForkData = forkDataByPool[parent];
		child.updateVaultFees(vault);
		parent.updateCollateralAmount();
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , , uint256 parentLockedRepInEscalationGame) = parent.securityVaults(vault);
		if (parentForkData.unresolvedEscalationAtFork) {
			require(parentLockedRepInEscalationGame == 0, 'e6');
		}
		(uint256 childCurrentPoolOwnership, uint256 childCurrentSecurityBondAllowance, , uint256 childCurrentFeeIndex, ) = child.securityVaults(vault);
		emit MigrateRepFromParent(vault, parentSecurityBondAllowance, parentPoolOwnership);
		uint256 childCurrentCollateral = child.completeSetCollateralAmount();
		uint256 childCurrentBond = child.totalSecurityBondAllowance();
		child.setPoolFinancials(childCurrentCollateral, childCurrentBond + parentSecurityBondAllowance);

		uint256 vaultPoolOwnership = childCurrentPoolOwnership;
		uint256 vaultFeeIndex = childCurrentSecurityBondAllowance > 0 ? childCurrentFeeIndex : 0;
		if (parent.poolOwnershipDenominator() != 0 && child.repToken().balanceOf(address(child)) != 0) {
			uint256 migratedPoolOwnership = parentPoolOwnership;
			if (parentForkData.unresolvedEscalationAtFork && lockedRepAlreadyMigrated > 0) {
				uint256 migratedEscalationOwnership = repToPoolOwnership(child, lockedRepAlreadyMigrated);
				require(migratedPoolOwnership >= migratedEscalationOwnership, 'f7');
				migratedPoolOwnership -= migratedEscalationOwnership;
			} else if (!parentForkData.unresolvedEscalationAtFork && parentLockedRepInEscalationGame > 0) {
				migratedPoolOwnership -= repToPoolOwnership(child, parentLockedRepInEscalationGame);
			}
			vaultPoolOwnership += migratedPoolOwnership;
			if (parentSecurityBondAllowance > 0) vaultFeeIndex = child.feeIndex();
			uint256 migratedRep = poolOwnershipToRep(child, migratedPoolOwnership);
			forkDataByPool[child].migratedRep += migratedRep;
			if (migratedPoolOwnership > 0 && parentRepAtFork > 0) {
				parent.transferEth(payable(child), parent.completeSetCollateralAmount() * migratedRep / parentRepAtFork);
			}
		}

		child.configureVault(vault, vaultPoolOwnership, childCurrentSecurityBondAllowance + parentSecurityBondAllowance, vaultFeeIndex);

		(uint256 poolOwnership, uint256 securityBondAllowance, , uint256 parentVaultFeeIndex, ) = parent.securityVaults(vault);
		emit MigrateVault(vault, forkDataByPool[child].outcomeIndex, poolOwnership, securityBondAllowance, parentLockedRepInEscalationGame);
		parent.configureVault(vault, 0, 0, parentVaultFeeIndex);
	}

	function createChildUniverse(ISecurityPool parent, uint8 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'ec');
		_getOrDeployChildPool(parent, outcomeIndex);
	}

	function migrateFromEscalationGame(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] memory depositIndexes) public {
		EscalationGame escalationGame = parent.escalationGame();
		ISecurityPool child = _getOrDeployChildPool(parent, uint8(outcomeIndex));
		require(address(escalationGame) != address(0x0), 'e4');
		require(escalationGame.nonDecisionTimestamp() > 0, 'ed');
		uint256 parentRepAtFork = forkDataByPool[parent].repAtFork;
		uint256 repMigratedFromEscalationGame = 0;
		uint256 migratedPrincipal = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) = escalationGame.claimDepositForWinning(depositIndexes[index], outcomeIndex);
			require(depositor == vault, 'e5');
			repMigratedFromEscalationGame += amountToWithdraw;
			migratedPrincipal += originalDepositAmount;
			parent.clearEscalationLockForForkMigration(vault, originalDepositAmount);
		}
		(uint256 currentPoolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex, ) = child.securityVaults(vault);
		uint256 ownershipDelta = repToPoolOwnership(child, repMigratedFromEscalationGame);
		child.configureVault(vault, currentPoolOwnership + ownershipDelta, currentSecurityBondAllowance, currentFeeIndex);
		forkDataByPool[child].migratedRep += migratedPrincipal;
		emit MigrateFromEscalationGame(parent, vault, outcomeIndex, depositIndexes, repMigratedFromEscalationGame, ownershipDelta);
		if (parentRepAtFork > 0) {
			parent.transferEth(payable(child), parent.completeSetCollateralAmount() * migratedPrincipal / parentRepAtFork);
		}
	}

	function migrateVault(ISecurityPool parent, uint8 outcomeIndex) public {
		require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'migration window closed');
		parent.updateVaultFees(msg.sender);
		ISecurityPool child = _getOrDeployChildPool(parent, outcomeIndex);
		_migrateVaultUnlockedState(parent, child, msg.sender, 0);
	}

	function migrateVaultWithUnresolvedEscalation(ISecurityPool parent, uint8 childOutcomeIndex) public {
		VaultMigrationForkData storage parentForkData = forkDataByPool[parent];
		require(parentForkData.unresolvedEscalationAtFork, 'ee');
		require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'migration window closed');
		parent.updateVaultFees(msg.sender);
		(, , , , uint256 parentLockedRepInEscalationGame) = parent.securityVaults(msg.sender);
		require(parentLockedRepInEscalationGame > 0, 'ef');
		ISecurityPool child = _getOrDeployChildPool(parent, childOutcomeIndex);
		parent.clearEscalationLockForForkMigration(msg.sender, parentLockedRepInEscalationGame);
		child.addEscalationLockForForkMigration(msg.sender, parentLockedRepInEscalationGame);
		_creditMigratedEscalationPrincipal(parent, child, parentLockedRepInEscalationGame);
		_migrateVaultUnlockedState(parent, child, msg.sender, parentLockedRepInEscalationGame);
	}
}
