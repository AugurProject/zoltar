// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData, EscalationMigrationEntitlement } from './SecurityPoolForkerTypes.sol';

contract EscalationGameForker is SecurityPoolForkerVaultMigrationBase {
	event EscalationMigrationEntitlementInitialized(
		ISecurityPool indexed parent,
		address indexed vault,
		uint256[3] sourcePrincipalByOutcome,
		uint256[3] currentRepByOutcome,
		uint256 totalCurrentRep
	);
	event EscalationMigrationEntitlementMaterialized(
		ISecurityPool indexed parent,
		address indexed vault,
		uint256 indexed childOutcomeIndex,
		ISecurityPool child,
		uint256 childRep
	);

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
		require(forkDataByPool[parent].ownFork, 'Own fork required');
		ISecurityPool child = _getOrDeployChildPool(parent, uint8(outcomeIndex));
		require(child.systemState() == SystemState.ForkMigration, 'Child not migrating');
		require(
			block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME,
			'Claim window closed'
		);
		EscalationGame childEscalationGame = child.escalationGame();
		require(address(childEscalationGame) != address(0x0), 'Child game missing');
		(uint256 repMigratedFromEscalationGame, uint256 sourcePrincipalClaimed) = _claimWinningDepositsFromGame(
			escalationGame,
			vault,
			outcomeIndex,
			depositIndexes
		);
		uint256 childRepToSweep = _previewOwnForkEscalationRep(parent, repMigratedFromEscalationGame);
		if (childRepToSweep > 0) {
			childEscalationGame.recordForkedEscrowForOutcome(
				vault,
				outcomeIndex,
				sourcePrincipalClaimed,
				childRepToSweep
			);
			childEscalationGame.exportForkedEscrowByOutcome(vault, vault);
		}
		emit ClaimForkedEscalationDepositsToWallet(
			parent,
			vault,
			outcomeIndex,
			depositIndexes,
			repMigratedFromEscalationGame,
			childRepToSweep,
			true
		);
	}

	function _claimEscalationDeposit(
		EscalationGame escalationGame,
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcomeIndex
	) private returns (address depositor, uint256 amountToWithdraw, uint256 sourcePrincipal) {
		(depositor, amountToWithdraw, sourcePrincipal) = escalationGame.claimDepositForWinningWithoutTransfer(
			depositIndex,
			outcomeIndex
		);
		return (depositor, amountToWithdraw, sourcePrincipal);
	}

	function _claimWinningDepositsFromGame(
		EscalationGame escalationGame,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes
	) private returns (uint256 totalRepMigrated, uint256 totalSourcePrincipal) {
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			uint256 depositIndex = depositIndexes[index];
			(address depositor, uint256 amountToWithdraw, uint256 sourcePrincipal) = _claimEscalationDeposit(
				escalationGame,
				depositIndex,
				outcomeIndex
			);
			require(depositor == vault, 'Wrong deposit vault');
			uint256 stableParentDepositIndex = depositIndex;
			if (escalationGame.forkContinuation()) {
				stableParentDepositIndex = uint256(
					keccak256(abi.encode(address(escalationGame), uint8(outcomeIndex), depositIndex))
				);
			}
			directlyClaimedEscalationDepositByPoolOutcomeAndIndex[escalationGame.securityPool()][uint8(outcomeIndex)][
				stableParentDepositIndex
			] = true;
			totalRepMigrated += amountToWithdraw;
			totalSourcePrincipal += sourcePrincipal;
		}
	}

	function migrateVaultWithUnresolvedEscalation(
		ISecurityPool parent,
		address vault,
		uint256 childOutcomeIndex
	) public {
		require(msg.sender == vault, 'Only vault');
		require(
			block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME,
			'Migration closed'
		);
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		require(parentForkData.unresolvedEscalationAtFork, 'No unresolved deposits');
		EscalationGame parentEscalationGame = parent.escalationGame();
		require(address(parentEscalationGame) != address(0x0), 'Parent game missing');
		require(
			!escalationEntitlementMaterializedByPoolVaultAndOutcome[parent][vault][childOutcomeIndex],
			'Entitlement materialized'
		);
		EscalationMigrationEntitlement storage entitlement = escalationMigrationEntitlementByPoolAndVault[parent][
			vault
		];
		if (!entitlement.initialized) {
			_initializeEscalationMigrationEntitlement(parent, parentEscalationGame, vault, entitlement);
		}
		ISecurityPool child = _getOrDeployChildPool(parent, childOutcomeIndex);
		EscalationGame childEscalationGame = child.escalationGame();
		require(address(childEscalationGame) != address(0x0), 'Child game missing');
		_requireContinuationMigrationOpen(child, childEscalationGame);
		uint256 vaultChildRep = entitlement.totalCurrentRep;
		if (parentForkData.ownFork) {
			vaultChildRep = _previewOwnForkEscalationRep(parent, entitlement.totalCurrentRep);
		}
		escalationEntitlementMaterializedByPoolVaultAndOutcome[parent][vault][childOutcomeIndex] = true;
		uint256[3] memory sourcePrincipalByOutcome = entitlement.sourcePrincipalByOutcome;
		uint256[3] memory currentRepByOutcome = entitlement.currentRepByOutcome;
		_recordForkedEscrowAndRefreshVault(
			childEscalationGame,
			child,
			vault,
			sourcePrincipalByOutcome,
			currentRepByOutcome,
			entitlement.totalCurrentRep,
			vaultChildRep
		);
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
		emit EscalationMigrationEntitlementMaterialized(parent, vault, childOutcomeIndex, child, vaultChildRep);
	}

	function _initializeEscalationMigrationEntitlement(
		ISecurityPool parent,
		EscalationGame parentEscalationGame,
		address vault,
		EscalationMigrationEntitlement storage entitlement
	) private {
		(uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory currentRepByOutcome) = _exportUnresolvedRep(
			parentEscalationGame,
			vault
		);
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , uint256 parentFeeIndex) = parent
			.securityVaults(vault);
		parent.configureVault(vault, parentPoolOwnership, parentSecurityBondAllowance, parentFeeIndex);
		uint256 sourcePrincipal = _sumOutcomeAmounts(sourcePrincipalByOutcome);
		require(sourcePrincipal > 0, 'No vault escalation REP');
		uint256 totalCurrentRep = _sumOutcomeAmounts(currentRepByOutcome);
		entitlement.sourcePrincipalByOutcome = sourcePrincipalByOutcome;
		entitlement.currentRepByOutcome = currentRepByOutcome;
		entitlement.totalCurrentRep = totalCurrentRep;
		entitlement.initialized = true;
		emit EscalationMigrationEntitlementInitialized(
			parent,
			vault,
			sourcePrincipalByOutcome,
			currentRepByOutcome,
			totalCurrentRep
		);
	}

	function _requireContinuationMigrationOpen(ISecurityPool child, EscalationGame childEscalationGame) private view {
		SystemState childState = child.systemState();
		bool migrationOpen =
			childState == SystemState.ForkMigration ||
				(childState == SystemState.Operational && childEscalationGame.forkContinuation());
		require(migrationOpen, 'Child not migrating');
	}

	function _exportUnresolvedRep(
		EscalationGame parentEscalationGame,
		address vault
	) private returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory currentRepByOutcome) {
		if (parentEscalationGame.forkContinuation()) {
			(
				uint256[3] memory forkedSourcePrincipalByOutcome,
				uint256[3] memory forkedChildRepByOutcome
			) = parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(vault);
			_addOutcomeAmounts(sourcePrincipalByOutcome, forkedSourcePrincipalByOutcome);
			_addOutcomeAmounts(currentRepByOutcome, forkedChildRepByOutcome);
		}
		uint256[3] memory localPrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedTotalsWithoutTransfer(
			vault
		);
		_addOutcomeAmounts(sourcePrincipalByOutcome, localPrincipalByOutcome);
		_addOutcomeAmounts(currentRepByOutcome, localPrincipalByOutcome);
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
