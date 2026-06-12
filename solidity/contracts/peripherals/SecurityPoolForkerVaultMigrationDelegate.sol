// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerStorage.sol';

interface ISecurityPoolForkerChildEscalationInitializer {
	function initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) external;
}

contract SecurityPoolForkerVaultMigrationDelegate is SecurityPoolForkerVaultMigrationBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerVaultMigrationBase(_zoltar) {}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal override {
		ISecurityPoolForkerChildEscalationInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(parent, child);
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
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
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
