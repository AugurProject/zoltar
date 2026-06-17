// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

contract EscalationGameForker is SecurityPoolForkerVaultMigrationBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerVaultMigrationBase(_zoltar) {}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal override {
		ISecurityPoolForkerChildEscalationGameInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(parent, child);
	}

	function claimForkedEscalationDeposits(ISecurityPool parent, address vault, BinaryOutcomes.BinaryOutcome outcomeIndex, uint256[] memory depositIndexes) public {
		EscalationGame escalationGame = parent.escalationGame();
		require(address(escalationGame) != address(0x0), 'e4');
		require(escalationGame.nonDecisionTimestamp() > 0, 'ed');
		bool ownFork = forkDataByPool[parent].ownFork;
		ISecurityPool child;
		SecurityPoolMigrationProxy migrationProxy;
		if (ownFork) {
			child = _getOrDeployChildPool(parent, uint8(outcomeIndex));
			migrationProxy = migrationProxyByPool[parent];
			require(address(migrationProxy) != address(0x0), 'mp');
			require(child.systemState() == SystemState.ForkMigration, 'cap');
			require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'mwc');
		}
		uint256 repMigratedFromEscalationGame;
		uint256 childRepToSweep;
		if (ownFork) {
			repMigratedFromEscalationGame = _claimWinningDepositsFromGame(escalationGame, vault, outcomeIndex, depositIndexes, true, false);
			childRepToSweep = _previewOwnForkEscalationRep(parent, repMigratedFromEscalationGame);
			childRepToSweep = _capOwnForkEscalationChildRep(parent, uint8(outcomeIndex), childRepToSweep);
			if (childRepToSweep == 0) return;
			_splitMigrationRepToChild(parent, uint8(outcomeIndex), childRepToSweep, true, true);
			migrationProxy.sweepChildRep(vault, child.repToken(), childRepToSweep);
			emit ClaimForkedEscalationDepositsToWallet(parent, vault, outcomeIndex, depositIndexes, childRepToSweep);
			return;
		}
		repMigratedFromEscalationGame = _claimWinningDepositsFromGame(escalationGame, vault, outcomeIndex, depositIndexes, false, true);
		emit ClaimForkedEscalationDepositsToWallet(parent, vault, outcomeIndex, depositIndexes, repMigratedFromEscalationGame);
	}

	function _claimEscalationDeposit(
		EscalationGame escalationGame,
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		bool ownFork,
		bool payWallet
	) private returns (address depositor, uint256 amountToWithdraw) {
		if (ownFork && !payWallet) {
			(depositor, amountToWithdraw, ) = escalationGame.claimDepositForWinningWithoutTransfer(depositIndex, outcomeIndex);
			return (depositor, amountToWithdraw);
		}
		(depositor, amountToWithdraw, ) = escalationGame.claimDepositForWinning(depositIndex, outcomeIndex);
		return (depositor, amountToWithdraw);
	}

	function _claimWinningDepositsFromGame(
		EscalationGame escalationGame,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] memory depositIndexes,
		bool ownFork,
		bool payWallet
	) private returns (uint256 totalRepMigrated) {
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw) = _claimEscalationDeposit(escalationGame, depositIndexes[index], outcomeIndex, ownFork, payWallet);
			require(depositor == vault, 'e5');
			totalRepMigrated += amountToWithdraw;
		}
	}

	function migrateVaultWithUnresolvedEscalation(ISecurityPool parent, address vault, uint8 childOutcomeIndex) public {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		require(parentForkData.unresolvedEscalationAtFork, 'ee');
		EscalationGame parentEscalationGame = parent.escalationGame();
		require(address(parentEscalationGame) != address(0x0), 'mpe');
		if (parentForkData.ownFork) {
			parent.updateVaultFees(vault);
			uint256 ownForkPrincipalToTransfer = parentEscalationGame.exportVaultUnresolvedDepositsWithoutTransfer(vault);
			if (ownForkPrincipalToTransfer == 0) {
				ownForkPrincipalToTransfer = parentEscalationGame.exportEscrowedRepWithoutTransfer(vault);
			}
			require(ownForkPrincipalToTransfer > 0, 'ef');
			uint256 ownForkChildRepToTransfer = _previewOwnForkEscalationRep(parent, ownForkPrincipalToTransfer);
			ownForkChildRepToTransfer = _capOwnForkEscalationChildRep(parent, childOutcomeIndex, ownForkChildRepToTransfer);
			if (ownForkChildRepToTransfer == 0) return;
			ISecurityPool ownForkChild = childrenByPoolAndOutcome[parent][childOutcomeIndex];
			if (address(ownForkChild) != address(0x0)) {
				require(ownForkChild.systemState() == SystemState.ForkMigration, 'cap');
			} else {
				require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'mwc');
				ownForkChild = _getOrDeployChildPool(parent, childOutcomeIndex);
			}
			EscalationGame ownForkChildEscalationGame = ownForkChild.escalationGame();
			SecurityPoolMigrationProxy ownForkMigrationProxy = migrationProxyByPool[parent];
			require(address(ownForkChildEscalationGame) != address(0x0), 'mce');
			require(address(ownForkMigrationProxy) != address(0x0), 'mp');
			// Continuation forks do not replay parent unresolved deposits into child local state.
			// The child inherits the parent carry snapshot in `_initializeChildForkedEscalationGameIfNeeded`
			// and receives only the REP backing via forked-escrow accounting below.
			// Own-fork unresolved migration uses an aggregate fork conversion rate. Any dust
			// from floor rounding remains unallocated as protocol residual.
			_splitMigrationRepToChild(parent, childOutcomeIndex, ownForkChildRepToTransfer, true, true);
			ownForkMigrationProxy.sweepChildRep(address(ownForkChildEscalationGame), ownForkChild.repToken(), ownForkChildRepToTransfer);
			_migrateVaultUnlockedState(parent, ownForkChild, vault);
			_recordForkedEscrow(ownForkChild, vault, BinaryOutcomes.BinaryOutcome(childOutcomeIndex), ownForkPrincipalToTransfer, ownForkChildRepToTransfer);
			ownForkChildEscalationGame.recordForkedEscrow(vault, ownForkChildRepToTransfer);
			(uint256 ownForkChildPoolOwnership, uint256 ownForkChildSecurityBondAllowance, , uint256 ownForkChildFeeIndex) = ownForkChild.securityVaults(vault);
			ownForkChild.configureVault(vault, ownForkChildPoolOwnership, ownForkChildSecurityBondAllowance, ownForkChildFeeIndex);
			return;
		}

		parent.updateVaultFees(vault);
		ISecurityPool child = _getOrDeployChildPool(parent, childOutcomeIndex);
		EscalationGame childEscalationGame = child.escalationGame();
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(childEscalationGame) != address(0x0), 'mce');
		require(address(migrationProxy) != address(0x0), 'mp');
		require(child.systemState() == SystemState.ForkMigration, 'cap');
		uint256 principalToTransfer = parentEscalationGame.exportVaultUnresolvedDeposits(vault, address(migrationProxy));
		if (principalToTransfer == 0) {
			principalToTransfer = parentEscalationGame.exportEscrowedRep(vault, address(migrationProxy));
		}
		require(principalToTransfer > 0, 'ef');
		uint256 childRepToTransfer = principalToTransfer;
		// Non-own continuation follows the same model: inherited carry snapshot + child REP backing.
		// Replaying parent deposits as child-local deposits would duplicate unresolved state
		// that already exists in the inherited carry tree.
		migrationProxy.lockRep(childRepToTransfer);
		_splitMigrationRepToChild(parent, childOutcomeIndex, childRepToTransfer, false, false);
		migrationProxy.sweepChildRep(address(childEscalationGame), child.repToken(), childRepToTransfer);
		_migrateVaultUnlockedState(parent, child, vault);
		_recordForkedEscrow(child, vault, BinaryOutcomes.BinaryOutcome(childOutcomeIndex), principalToTransfer, childRepToTransfer);
		childEscalationGame.recordForkedEscrow(vault, childRepToTransfer);
		(uint256 childCurrentPoolOwnership, uint256 childCurrentSecurityBondAllowance, , uint256 childCurrentFeeIndex) = child.securityVaults(vault);
		child.configureVault(vault, childCurrentPoolOwnership, childCurrentSecurityBondAllowance, childCurrentFeeIndex);
	}
}
