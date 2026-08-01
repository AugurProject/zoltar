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
import { MAX_CLAIM_OWNERS_PER_BUNDLE } from './EscalationGameTypes.sol';
import { EscalationMigrationEntitlement, SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

interface IEscalationClaimReader {
	function getClaimOwner(
		address bundleId,
		uint256 ownerIndex
	) external view returns (address ownerAddress, uint256 ownerShares, uint256 totalShares);
}

contract EscalationGameForker is SecurityPoolForkerVaultMigrationBase {
	struct ClaimSplitState {
		uint256 remainingSourcePrincipal;
		uint256 remainingChildRep;
		uint256 remainingShares;
		uint256 totalShares;
		bool claimingVaultOwnsClaim;
	}

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
			if (
				!_recordAndExportCurrentClaimOwners(
					escalationGame,
					childEscalationGame,
					depositor,
					vault,
					outcomeIndex,
					sourcePrincipal,
					amountToWithdraw
				)
			) revert();
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

	function _recordAndExportCurrentClaimOwners(
		EscalationGame sourceGame,
		EscalationGame childGame,
		address bundleId,
		address claimingVault,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipal,
		uint256 childRep
	) private returns (bool) {
		ClaimSplitState memory state = ClaimSplitState(sourcePrincipal, childRep, 0, 0, false);
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			(address ownerAddress, uint256 shares, uint256 bundleTotalShares) = IEscalationClaimReader(
				address(sourceGame)
			).getClaimOwner(bundleId, ownerIndex);
			if (state.totalShares == 0) {
				state.totalShares = bundleTotalShares;
				state.remainingShares = bundleTotalShares;
			}
			if (ownerAddress == address(0x0) || shares == 0) continue;
			if (ownerAddress == claimingVault) state.claimingVaultOwnsClaim = true;
			uint256 ownerSourcePrincipal =
				shares == state.remainingShares
					? state.remainingSourcePrincipal
					: (sourcePrincipal * shares) / state.totalShares;
			uint256 ownerChildRep =
				shares == state.remainingShares ? state.remainingChildRep : (childRep * shares) / state.totalShares;
			state.remainingSourcePrincipal -= ownerSourcePrincipal;
			state.remainingChildRep -= ownerChildRep;
			state.remainingShares -= shares;
			childGame.recordForkedEscrowForOutcome(ownerAddress, outcome, ownerSourcePrincipal, ownerChildRep);
			childGame.exportForkedEscrowByOutcome(ownerAddress, ownerAddress);
		}
		if (state.totalShares == 0 || state.remainingSourcePrincipal != 0 || state.remainingChildRep != 0) revert();
		return state.claimingVaultOwnsClaim;
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
