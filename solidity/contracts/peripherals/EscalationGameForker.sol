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
import { EscalationMigrationEntitlement, SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

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

	function _initializeChildForkedEscalationGameIfNeeded(
		ISecurityPool parent,
		ISecurityPool child,
		EscalationGame childEscalationGame
	) internal override returns (EscalationGame) {
		return
			ISecurityPoolForkerChildEscalationGameInitializer(address(this))
				.initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame);
	}

	function claimForkedEscalationDeposits(
		ISecurityPool parent,
		address vault,
		BinaryOutcomes.BinaryOutcome outcomeIndex,
		uint256[] calldata depositIndexes
	) public {
		EscalationGame escalationGame = parent.escalationGame();
		// A non-decision alone does not authorize forked escrow claims; fork-time escrow state is also required.
		// This module is embedded in SecurityPoolForker's creation code. Data-free
		// guards keep that initcode below EIP-3860's hard deployment limit.
		if (!forkDataByPool[parent].unresolvedEscalationAtFork || !escalationGame.canTriggerOwnFork()) revert();
		if (!forkDataByPool[parent].ownFork) revert();
		(ISecurityPool child, EscalationGame childEscalationGame) = _getOrDeployChildPool(parent, uint8(outcomeIndex));
		if (child.systemState() != SystemState.ForkMigration) revert();
		if (block.timestamp > forkDataByPool[parent].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME) revert();
		if (address(childEscalationGame) == address(0x0)) revert();
		(uint256 repMigratedFromEscalationGame, uint256 sourcePrincipalClaimed) = _claimWinningDepositsFromGame(
			escalationGame,
			childEscalationGame,
			vault,
			outcomeIndex,
			depositIndexes
		);
		directlyClaimedEscalationPrincipalByPoolAndOutcome[parent][uint8(outcomeIndex)] += sourcePrincipalClaimed;
		uint256 childRepToSweep = repMigratedFromEscalationGame;
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
		EscalationGame childEscalationGame,
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
			if (depositor != vault) revert();
			childEscalationGame.recordForkedEscrowForOutcome(
				depositor,
				outcomeIndex,
				sourcePrincipal,
				amountToWithdraw
			);
			childEscalationGame.exportForkedEscrowByOutcome(depositor, depositor);
			uint256 stableParentDepositIndex = depositIndex;
			if (escalationGame.forkContinuation()) {
				if (depositIndex >= (uint256(1) << 88)) revert();
				stableParentDepositIndex =
					(uint256(uint160(address(escalationGame))) << 96) |
					(uint256(uint8(outcomeIndex)) << 88) |
					depositIndex;
			}
			bytes32 depositId = _getEscalationDepositId(
				escalationGame.securityPool(),
				uint8(outcomeIndex),
				stableParentDepositIndex
			);
			directlyClaimedEscalationDepositById[depositId] = true;
			totalRepMigrated += amountToWithdraw;
			totalSourcePrincipal += sourcePrincipal;
		}
	}

	function migrateVaultWithUnresolvedEscalation(
		ISecurityPool parent,
		address vault,
		uint256 childOutcomeIndex,
		ISecurityPool migratedChild,
		EscalationGame migratedChildEscalationGame
	) public {
		if (msg.sender != vault) revert();
		if (block.timestamp > forkDataByPool[parent].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME) revert();
		SecurityPoolForkerForkData storage parentForkData = forkDataByPool[parent];
		if (!parentForkData.unresolvedEscalationAtFork) revert();
		if (escalationEntitlementMaterializedByPoolVaultAndOutcome[parent][vault][childOutcomeIndex]) revert();
		ISecurityPool child = migratedChild;
		EscalationGame childEscalationGame = migratedChildEscalationGame;
		if (address(child) == address(0x0)) {
			(child, childEscalationGame) = _getOrDeployChildPool(parent, childOutcomeIndex);
		} else {
			if (address(childrenByPoolAndOutcome[parent][childOutcomeIndex]) != address(child)) revert();
			_validateChildEscalationGame(child, childEscalationGame);
		}
		EscalationMigrationEntitlement storage entitlement = escalationMigrationEntitlementByPoolAndVault[parent][
			vault
		];
		if (!entitlement.initialized) {
			_initializeEscalationMigrationEntitlement(parent, parent.escalationGame(), vault, entitlement);
		}
		if (address(childEscalationGame) == address(0x0)) revert();
		escalationEntitlementMaterializedByPoolVaultAndOutcome[parent][vault][childOutcomeIndex] = true;
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
		emit EscalationMigrationEntitlementMaterialized(
			parent,
			vault,
			childOutcomeIndex,
			child,
			entitlement.totalCurrentRep
		);
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
		entitlement.sourcePrincipalByOutcome = sourcePrincipalByOutcome;
		entitlement.currentRepByOutcome = currentRepByOutcome;
		entitlement.totalCurrentRep = _sumOutcomeAmounts(currentRepByOutcome);
		entitlement.initialized = true;
		emit EscalationMigrationEntitlementInitialized(
			parent,
			vault,
			sourcePrincipalByOutcome,
			currentRepByOutcome,
			entitlement.totalCurrentRep
		);
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

	function _sumOutcomeAmounts(uint256[3] memory amounts) private pure returns (uint256 total) {
		return amounts[0] + amounts[1] + amounts[2];
	}

	function _addOutcomeAmounts(uint256[3] memory target, uint256[3] memory source) private pure {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			target[outcomeIndex] += source[outcomeIndex];
		}
	}
}
