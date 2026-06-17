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

	function migrateVaultWithUnresolvedEscalation(ISecurityPool parent, address vault, uint8 childOutcomeIndex) public returns (bool moreToMigrate) {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		require(parentForkData.unresolvedEscalationAtFork, 'ee');
		EscalationGame parentEscalationGame = parent.escalationGame();
		require(address(parentEscalationGame) != address(0x0), 'mpe');
		if (parentForkData.ownFork) {
			parent.updateVaultFees(vault);
			ISecurityPool ownForkChild = childrenByPoolAndOutcome[parent][childOutcomeIndex];
			if (address(ownForkChild) != address(0x0)) {
				require(ownForkChild.systemState() == SystemState.ForkMigration, 'cap');
			} else {
				require(block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME, 'mwc');
				ownForkChild = _getOrDeployChildPool(parent, childOutcomeIndex);
			}
			uint256[3] memory ownForkSourcePrincipalByOutcome;
			uint256[3] memory ownForkCurrentRepByOutcome;
			if (parentEscalationGame.forkContinuation()) {
				(uint256[3] memory forkedSourcePrincipalByOutcome, uint256[3] memory forkedChildRepByOutcome) = parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(vault);
				_addOutcomeAmounts(ownForkSourcePrincipalByOutcome, forkedSourcePrincipalByOutcome);
				_addOutcomeAmounts(ownForkCurrentRepByOutcome, forkedChildRepByOutcome);
			}
			if (_sumOutcomeAmounts(ownForkCurrentRepByOutcome) == 0) {
				ownForkSourcePrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedDepositAmountsWithoutTransfer(vault);
				ownForkCurrentRepByOutcome = ownForkSourcePrincipalByOutcome;
			}
			uint256 ownForkCurrentRepToTransfer = _sumOutcomeAmounts(ownForkCurrentRepByOutcome);
			if (ownForkCurrentRepToTransfer == 0) return _hasMoreUnresolvedMigration(parentEscalationGame, vault);
			require(ownForkCurrentRepToTransfer > 0, 'ef');
			uint256 ownForkChildRepToTransfer = _previewOwnForkEscalationRep(parent, ownForkCurrentRepToTransfer);
			ownForkChildRepToTransfer = _capOwnForkEscalationChildRep(parent, childOutcomeIndex, ownForkChildRepToTransfer);
			if (ownForkChildRepToTransfer == 0) return _hasMoreUnresolvedMigration(parentEscalationGame, vault);
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
			_recordForkedEscrowByOriginalOutcome(ownForkChildEscalationGame, vault, ownForkSourcePrincipalByOutcome, ownForkCurrentRepByOutcome, ownForkCurrentRepToTransfer, ownForkChildRepToTransfer);
			(uint256 ownForkChildPoolOwnership, uint256 ownForkChildSecurityBondAllowance, , uint256 ownForkChildFeeIndex) = ownForkChild.securityVaults(vault);
			ownForkChild.configureVault(vault, ownForkChildPoolOwnership, ownForkChildSecurityBondAllowance, ownForkChildFeeIndex);
			return _hasMoreUnresolvedMigration(parentEscalationGame, vault);
		}

		parent.updateVaultFees(vault);
		ISecurityPool child = _getOrDeployChildPool(parent, childOutcomeIndex);
		EscalationGame childEscalationGame = child.escalationGame();
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		require(address(childEscalationGame) != address(0x0), 'mce');
		require(address(migrationProxy) != address(0x0), 'mp');
		require(child.systemState() == SystemState.ForkMigration, 'cap');
		uint256[3] memory sourcePrincipalByOutcome;
		uint256[3] memory currentRepByOutcome;
		if (parentEscalationGame.forkContinuation()) {
			(uint256[3] memory forkedSourcePrincipalByOutcome, uint256[3] memory forkedChildRepByOutcome) = parentEscalationGame.exportForkedEscrowByOutcome(vault, address(migrationProxy));
			_addOutcomeAmounts(sourcePrincipalByOutcome, forkedSourcePrincipalByOutcome);
			_addOutcomeAmounts(currentRepByOutcome, forkedChildRepByOutcome);
		}
		if (_sumOutcomeAmounts(currentRepByOutcome) == 0) {
			sourcePrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedDepositAmounts(vault, address(migrationProxy));
			currentRepByOutcome = sourcePrincipalByOutcome;
		}
		uint256 childRepToTransfer = _sumOutcomeAmounts(currentRepByOutcome);
		if (childRepToTransfer == 0) return _hasMoreUnresolvedMigration(parentEscalationGame, vault);
		require(childRepToTransfer > 0, 'ef');
		// Non-own continuation follows the same model: inherited carry snapshot + child REP backing.
		// Replaying parent deposits as child-local deposits would duplicate unresolved state
		// that already exists in the inherited carry tree.
		migrationProxy.lockRep(childRepToTransfer);
		_splitMigrationRepToChild(parent, childOutcomeIndex, childRepToTransfer, false, false);
		migrationProxy.sweepChildRep(address(childEscalationGame), child.repToken(), childRepToTransfer);
		_migrateVaultUnlockedState(parent, child, vault);
		_recordForkedEscrowByOriginalOutcome(childEscalationGame, vault, sourcePrincipalByOutcome, currentRepByOutcome, childRepToTransfer, childRepToTransfer);
		(uint256 childCurrentPoolOwnership, uint256 childCurrentSecurityBondAllowance, , uint256 childCurrentFeeIndex) = child.securityVaults(vault);
		child.configureVault(vault, childCurrentPoolOwnership, childCurrentSecurityBondAllowance, childCurrentFeeIndex);
		return _hasMoreUnresolvedMigration(parentEscalationGame, vault);
	}

	function _hasMoreUnresolvedMigration(EscalationGame parentEscalationGame, address vault) private view returns (bool) {
		return parentEscalationGame.hasUnexportedLocalDepositRefs(vault) || parentEscalationGame.hasUnexportedForkedEscrow(vault);
	}

	function _recordForkedEscrowByOriginalOutcome(
		EscalationGame childEscalationGame,
		address vault,
		uint256[3] memory sourcePrincipalByOutcome,
		uint256[3] memory currentRepByOutcome,
		uint256 totalCurrentRep,
		uint256 totalChildRep
	) private {
		uint256 allocatedChildRep;
		uint256 allocatedCurrentRep;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 outcomeSourcePrincipal = sourcePrincipalByOutcome[outcomeIndex];
			uint256 outcomeCurrentRep = currentRepByOutcome[outcomeIndex];
			if (outcomeSourcePrincipal == 0 && outcomeCurrentRep == 0) continue;
			allocatedCurrentRep += outcomeCurrentRep;
			uint256 outcomeChildRep = allocatedCurrentRep == totalCurrentRep ?
				totalChildRep - allocatedChildRep :
				outcomeCurrentRep * totalChildRep / totalCurrentRep;
			allocatedChildRep += outcomeChildRep;
			childEscalationGame.recordForkedEscrowForOutcome(vault, BinaryOutcomes.BinaryOutcome(outcomeIndex), outcomeSourcePrincipal, outcomeChildRep);
		}
	}

	function _sumOutcomeAmounts(uint256[3] memory amounts) private pure returns (uint256 total) {
		return amounts[0] + amounts[1] + amounts[2];
	}

	function _addOutcomeAmounts(uint256[3] memory target, uint256[3] memory source) private pure {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			target[outcomeIndex] += source[outcomeIndex];
		}
	}
}
