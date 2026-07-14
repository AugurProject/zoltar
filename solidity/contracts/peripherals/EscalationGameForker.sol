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
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData, PendingEscalationMigrationBatch } from './SecurityPoolForkerTypes.sol';

contract EscalationGameForker is SecurityPoolForkerVaultMigrationBase {
	uint256 private constant MAX_CHILD_DESTINATIONS_PER_CALL = 1;

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal override {
		ISecurityPoolForkerChildEscalationGameInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(
			parent,
			child
		);
	}

	function claimForkedEscalationDeposits(
		ISecurityPool parent,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes
	) public {
		EscalationGame escalationGame = parent.escalationGame();
		// A non-decision alone does not authorize forked escrow claims; fork-time escrow state is also required.
		require(
			forkDataByPool[parent].unresolvedEscalationAtFork && escalationGame.nonDecisionTimestamp() > 0,
			'Non-decision required'
		);
		bool ownFork = forkDataByPool[parent].ownFork;
		ISecurityPool child;
		SecurityPoolMigrationProxy migrationProxy;
		if (ownFork) {
			child = _getOrDeployChildPool(parent, uint8(outcomeIndex));
			migrationProxy = migrationProxyByPool[parent];
			require(address(migrationProxy) != address(0x0), 'Proxy missing');
			require(child.systemState() == SystemState.ForkMigration, 'Child not migrating');
			require(
				block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME,
				'Claim window closed'
			);
		}
		uint256 repMigratedFromEscalationGame;
		uint256 childRepToSweep;
		if (ownFork) {
			repMigratedFromEscalationGame = _claimWinningDepositsFromGame(
				escalationGame,
				vault,
				outcomeIndex,
				depositIndexes,
				true,
				false
			);
			childRepToSweep = _previewOwnForkEscalationRep(parent, repMigratedFromEscalationGame);
			childRepToSweep = _capOwnForkEscalationChildRep(parent, uint8(outcomeIndex), childRepToSweep);
			if (childRepToSweep == 0) return;
			_splitMigrationRepToChild(parent, uint8(outcomeIndex), childRepToSweep, true, true);
			migrationProxy.sweepChildRep(vault, child.repToken(), childRepToSweep);
			emit ClaimForkedEscalationDepositsToWallet(
				parent,
				vault,
				outcomeIndex,
				depositIndexes,
				repMigratedFromEscalationGame,
				childRepToSweep,
				true
			);
			return;
		}
		repMigratedFromEscalationGame = _claimWinningDepositsFromGame(
			escalationGame,
			vault,
			outcomeIndex,
			depositIndexes,
			false,
			true
		);
		emit ClaimForkedEscalationDepositsToWallet(
			parent,
			vault,
			outcomeIndex,
			depositIndexes,
			repMigratedFromEscalationGame,
			repMigratedFromEscalationGame,
			false
		);
	}

	function _claimEscalationDeposit(
		EscalationGame escalationGame,
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		bool ownFork,
		bool payWallet
	) private returns (address depositor, uint256 amountToWithdraw) {
		if (ownFork && !payWallet) {
			(depositor, amountToWithdraw, ) = escalationGame.claimDepositForWinningWithoutTransfer(
				depositIndex,
				outcomeIndex
			);
			return (depositor, amountToWithdraw);
		}
		(depositor, amountToWithdraw, ) = escalationGame.claimDepositForWinning(depositIndex, outcomeIndex);
		return (depositor, amountToWithdraw);
	}

	function _claimWinningDepositsFromGame(
		EscalationGame escalationGame,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes,
		bool ownFork,
		bool payWallet
	) private returns (uint256 totalRepMigrated) {
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw) = _claimEscalationDeposit(
				escalationGame,
				depositIndexes[index],
				outcomeIndex,
				ownFork,
				payWallet
			);
			require(depositor == vault, 'Wrong deposit vault');
			totalRepMigrated += amountToWithdraw;
		}
	}

	function migrateVaultWithUnresolvedEscalation(
		ISecurityPool parent,
		address vault
	) public returns (bool moreToMigrate) {
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		require(parentForkData.unresolvedEscalationAtFork, 'No unresolved deposits');
		EscalationGame parentEscalationGame = parent.escalationGame();
		require(address(parentEscalationGame) != address(0x0), 'Parent game missing');
		if (parentForkData.ownFork) {
			return _migrateOwnForkUnresolvedEscalation(parent, parentEscalationGame, vault);
		}
		return _migrateExternalForkUnresolvedEscalation(parent, parentEscalationGame, vault);
	}

	function _migrateOwnForkUnresolvedEscalation(
		ISecurityPool parent,
		EscalationGame parentEscalationGame,
		address vault
	) private returns (bool moreToMigrate) {
		if (msg.sender != vault) revert();
		_startEscalationMigrationBatchIfNeeded(parent, parentEscalationGame, vault, true);
		return _migratePendingEscalationBatch(parent, vault, true);
	}

	function _migrateExternalForkUnresolvedEscalation(
		ISecurityPool parent,
		EscalationGame parentEscalationGame,
		address vault
	) private returns (bool moreToMigrate) {
		bool migrationWindowOpen =
			block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME;
		// During the migration window only the vault may migrate its escalation REP.
		// Afterwards anyone may fund every still-paused continuation from the vault's
		// existing parent escrow so one inactive depositor cannot halt all children.
		if (migrationWindowOpen) require(msg.sender == vault);
		_startEscalationMigrationBatchIfNeeded(parent, parentEscalationGame, vault, false);
		return _migratePendingEscalationBatch(parent, vault, false);
	}

	function _startEscalationMigrationBatchIfNeeded(
		ISecurityPool parent,
		EscalationGame parentEscalationGame,
		address vault,
		bool ownFork
	) private {
		PendingEscalationMigrationBatch storage pendingBatch = pendingEscalationMigrationBatchByPoolAndVault[parent][
			vault
		];
		if (pendingBatch.active) return;
		uint256[] storage childOutcomeIndexes = childOutcomeIndexesByPool[parent];
		require(childOutcomeIndexes.length > 0, 'No child destinations');
		escalationMigrationStartedByPool[parent] = true;
		SecurityPoolMigrationProxy migrationProxy = migrationProxyByPool[parent];
		if (!ownFork) require(address(migrationProxy) != address(0x0), 'Proxy missing');
		(uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory currentRepByOutcome) = _exportUnresolvedRep(
			parentEscalationGame,
			vault,
			ownFork ? address(0x0) : address(migrationProxy),
			!ownFork
		);
		if (_sumOutcomeAmounts(sourcePrincipalByOutcome) == 0) return;
		uint256 totalCurrentRep = _sumOutcomeAmounts(currentRepByOutcome);
		if (!ownFork) {
			// Burn the parent REP once. Each destination page independently reproduces
			// this same batch in its child universe.
			migrationProxy.lockRep(totalCurrentRep);
		}
		pendingBatch.sourcePrincipalByOutcome = sourcePrincipalByOutcome;
		pendingBatch.currentRepByOutcome = currentRepByOutcome;
		pendingBatch.totalCurrentRep = totalCurrentRep;
		pendingBatch.moreParentBatches = _hasMoreUnresolvedMigration(parentEscalationGame, vault);
		pendingBatch.active = true;
	}

	function _migratePendingEscalationBatch(
		ISecurityPool parent,
		address vault,
		bool ownFork
	) private returns (bool moreToMigrate) {
		PendingEscalationMigrationBatch storage pendingBatch = pendingEscalationMigrationBatchByPoolAndVault[parent][
			vault
		];
		if (!pendingBatch.active) return _hasMoreUnresolvedMigration(parent.escalationGame(), vault);
		uint256[] storage childOutcomeIndexes = childOutcomeIndexesByPool[parent];
		uint256 endChildIndex = pendingBatch.nextChildIndex + MAX_CHILD_DESTINATIONS_PER_CALL;
		if (endChildIndex > childOutcomeIndexes.length) endChildIndex = childOutcomeIndexes.length;
		for (uint256 index = pendingBatch.nextChildIndex; index < endChildIndex; index++) {
			_migratePendingEscalationBatchToChild(parent, vault, childOutcomeIndexes[index], ownFork, pendingBatch);
		}
		pendingBatch.nextChildIndex = endChildIndex;
		if (endChildIndex < childOutcomeIndexes.length) return true;
		moreToMigrate = pendingBatch.moreParentBatches;
		delete pendingEscalationMigrationBatchByPoolAndVault[parent][vault];
	}

	function _migratePendingEscalationBatchToChild(
		ISecurityPool parent,
		address vault,
		uint256 childOutcomeIndex,
		bool ownFork,
		PendingEscalationMigrationBatch storage pendingBatch
	) private {
		registeredContinuationDeploymentByPool[parent] = true;
		ISecurityPool child = _getOrDeployChildPool(parent, childOutcomeIndex);
		registeredContinuationDeploymentByPool[parent] = false;
		(EscalationGame childEscalationGame, SecurityPoolMigrationProxy migrationProxy) = _loadChildEscalationAndProxy(
			parent,
			child
		);
		_requireContinuationMigrationOpen(child, childEscalationGame);
		uint256 childRepToTransfer = pendingBatch.totalCurrentRep;
		if (ownFork) {
			childRepToTransfer = _previewOwnForkEscalationRep(parent, pendingBatch.totalCurrentRep);
			childRepToTransfer = _capOwnForkEscalationChildRep(parent, childOutcomeIndex, childRepToTransfer);
		}
		_splitMigrationRepToChild(parent, childOutcomeIndex, childRepToTransfer, ownFork, true);
		migrationProxy.sweepChildRep(address(childEscalationGame), child.repToken(), childRepToTransfer);
		_recordForkedEscrowAndRefreshVault(
			childEscalationGame,
			child,
			vault,
			pendingBatch.sourcePrincipalByOutcome,
			pendingBatch.currentRepByOutcome,
			pendingBatch.totalCurrentRep,
			childRepToTransfer
		);
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
	}

	function hasPendingUnresolvedEscalationMigration(ISecurityPool parent, address vault) external view returns (bool) {
		if (pendingEscalationMigrationBatchByPoolAndVault[parent][vault].active) return true;
		EscalationGame parentEscalationGame = parent.escalationGame();
		if (address(parentEscalationGame) == address(0x0)) return false;
		return _hasMoreUnresolvedMigration(parentEscalationGame, vault);
	}

	function _loadChildEscalationAndProxy(
		ISecurityPool parent,
		ISecurityPool child
	) private view returns (EscalationGame childEscalationGame, SecurityPoolMigrationProxy migrationProxy) {
		childEscalationGame = child.escalationGame();
		migrationProxy = migrationProxyByPool[parent];
		require(address(childEscalationGame) != address(0x0), 'Child game missing');
		require(address(migrationProxy) != address(0x0), 'Proxy missing');
	}

	function _requireContinuationMigrationOpen(ISecurityPool child, EscalationGame childEscalationGame) private view {
		SystemState childState = child.systemState();
		bool migrationOpen =
			childState == SystemState.ForkMigration ||
				(childState == SystemState.Operational &&
					child.awaitingForkContinuation() &&
					childEscalationGame.forkContinuation() &&
					childEscalationGame.forkResumedAt() == 0);
		require(migrationOpen, 'Child not migrating');
	}

	function _exportUnresolvedRep(
		EscalationGame parentEscalationGame,
		address vault,
		address repReceiver,
		bool transferRep
	) private returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory currentRepByOutcome) {
		if (parentEscalationGame.forkContinuation()) {
			if (transferRep) {
				(
					uint256[3] memory forkedSourcePrincipalByOutcome,
					uint256[3] memory forkedChildRepByOutcome
				) = parentEscalationGame.exportForkedEscrowByOutcome(vault, repReceiver);
				_addOutcomeAmounts(sourcePrincipalByOutcome, forkedSourcePrincipalByOutcome);
				_addOutcomeAmounts(currentRepByOutcome, forkedChildRepByOutcome);
			} else {
				(
					uint256[3] memory forkedSourcePrincipalByOutcome,
					uint256[3] memory forkedChildRepByOutcome
				) = parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(vault);
				_addOutcomeAmounts(sourcePrincipalByOutcome, forkedSourcePrincipalByOutcome);
				_addOutcomeAmounts(currentRepByOutcome, forkedChildRepByOutcome);
			}
		}
		if (_sumOutcomeAmounts(sourcePrincipalByOutcome) != 0) return (sourcePrincipalByOutcome, currentRepByOutcome);
		if (transferRep) {
			sourcePrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedDepositAmounts(vault, repReceiver);
		} else {
			sourcePrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedDepositAmountsWithoutTransfer(vault);
		}
		currentRepByOutcome = sourcePrincipalByOutcome;
	}

	function _recordForkedEscrowAndRefreshVault(
		EscalationGame childEscalationGame,
		ISecurityPool child,
		address vault,
		uint256[3] memory sourcePrincipalByOutcome,
		uint256[3] memory currentRepByOutcome,
		uint256 totalCurrentRep,
		uint256 totalChildRep
	) private {
		_recordForkedEscrowByOriginalOutcome(
			childEscalationGame,
			vault,
			sourcePrincipalByOutcome,
			currentRepByOutcome,
			totalCurrentRep,
			totalChildRep
		);
		(uint256 childPoolOwnership, uint256 childSecurityBondAllowance, , uint256 childFeeIndex) = child
			.securityVaults(vault);
		child.configureVault(vault, childPoolOwnership, childSecurityBondAllowance, childFeeIndex);
	}

	function _hasMoreUnresolvedMigration(
		EscalationGame parentEscalationGame,
		address vault
	) private view returns (bool) {
		return
			parentEscalationGame.hasUnexportedLocalDepositRefs(vault) ||
			parentEscalationGame.hasUnexportedForkedEscrow(vault);
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
			uint256 outcomeChildRep =
				allocatedCurrentRep == totalCurrentRep
					? totalChildRep - allocatedChildRep
					: (outcomeCurrentRep * totalChildRep) / totalCurrentRep;
			allocatedChildRep += outcomeChildRep;
			childEscalationGame.recordForkedEscrowForOutcome(
				vault,
				BinaryOutcomes.BinaryOutcome(outcomeIndex),
				outcomeSourcePrincipal,
				outcomeChildRep
			);
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
