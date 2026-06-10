// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ImportedEscalationPosition, SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';

contract SecurityPoolForkerInheritedEscalationLogic is SecurityPoolForkerBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function migrateInheritedEscalationToBranch(
		ISecurityPool parent,
		address vault,
		uint256 branchOutcomeIndex,
		BinaryOutcomes.BinaryOutcome marketOutcome,
		uint256[] memory depositIndexes
	) public {
		require(vault != address(0x0), 'bad vault');
		require(!_forkQuestionMatchesPool(parent), 'use own path');
		require(marketOutcome != BinaryOutcomes.BinaryOutcome.None, 'bad outcome');
		EscalationGame escalationGame = parent.escalationGame();
		require(address(escalationGame) != address(0x0), 'missing game');
		ISecurityPool child = _getOrDeployChildPool(parent, branchOutcomeIndex);
		require(address(inheritedEscalationRootPoolByChild[child]) == address(0x0) || address(inheritedEscalationRootPoolByChild[child]) == address(parent), 'wrong root');
		inheritedEscalationRootPoolByChild[child] = parent;
		uint8 marketOutcomeIndex = uint8(marketOutcome);
		uint256 totalPrincipal = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			uint256 depositIndex = depositIndexes[index];
			ImportedEscalationPosition storage position = importedEscalationPositionsByPool[child][marketOutcomeIndex][depositIndex];
			require(position.beneficiaryVault == address(0x0), 'deposit already imported');
			(address depositor, uint256 amount, ) = escalationGame.deposits(marketOutcomeIndex, depositIndex);
			require(depositor == vault, 'deposit was not for this vault');
			require(amount > 0, 'deposit already settled');
			totalPrincipal += amount;
			position.rootPool = parent;
			position.beneficiaryVault = vault;
			position.principal = amount;
		}
		if (totalPrincipal == 0) return;
		child.creditImportedEscalationPosition(vault, totalPrincipal);
		forkDataByPool[child].migratedRep += totalPrincipal;
		parent.clearEscalationLockForForkMigration(vault, totalPrincipal);
		_transferMigratedCollateral(parent, child, totalPrincipal, forkDataByPool[parent].repAtFork);
	}

	function settleInheritedEscalation(
		ISecurityPool child,
		address vault,
		BinaryOutcomes.BinaryOutcome marketOutcome,
		uint256[] memory depositIndexes
	) public {
		require(vault != address(0x0), 'bad vault');
		require(marketOutcome != BinaryOutcomes.BinaryOutcome.None, 'bad outcome');
		ISecurityPool rootPool = inheritedEscalationRootPoolByChild[child];
		require(address(rootPool) != address(0x0), 'no inherited');
		EscalationGame escalationGame = rootPool.escalationGame();
		require(address(escalationGame) != address(0x0), 'missing game');
		require(escalationGame.nonDecisionTimestamp() == 0, 'use fork path');
		require(block.timestamp > escalationGame.getEscalationGameEndDate(), 'Question has not finalized!');
		BinaryOutcomes.BinaryOutcome questionResolution = escalationGame.getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question has not finalized!');
		uint8 marketOutcomeIndex = uint8(marketOutcome);
		uint256 totalPrincipal = 0;
		uint256 totalAmountToWithdraw = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			uint256 depositIndex = depositIndexes[index];
			ImportedEscalationPosition storage position = importedEscalationPositionsByPool[child][marketOutcomeIndex][depositIndex];
			require(position.beneficiaryVault == vault, 'deposit was not for this vault');
			require(!position.settledOrMigrated, 'deposit already settled');
			position.settledOrMigrated = true;
			uint256 originalDepositAmount = position.principal;
			totalPrincipal += originalDepositAmount;
			if (marketOutcome == questionResolution) {
				(address depositor, uint256 amountToWithdraw, uint256 settledPrincipal) = escalationGame.withdrawDeposit(depositIndex);
				require(depositor == vault, 'deposit was not for this vault');
				require(settledPrincipal == originalDepositAmount, 'principal mismatch');
				totalAmountToWithdraw += amountToWithdraw;
			} else {
				(address depositor, uint256 settledPrincipal) = escalationGame.forfeitLosingDeposit(depositIndex, marketOutcome);
				require(depositor == vault, 'deposit was not for this vault');
				require(settledPrincipal == originalDepositAmount, 'principal mismatch');
			}
		}
		if (totalPrincipal == 0) return;
		child.settleImportedEscalation(vault, totalPrincipal, totalAmountToWithdraw);
	}

	function forkZoltarWithInheritedEscalationGame(ISecurityPool securityPool) public {
		ISecurityPool rootPool = inheritedEscalationRootPoolByChild[securityPool];
		require(address(rootPool) != address(0x0), 'no inherited');
		EscalationGame escalationGame = rootPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'no nondecision');
		_forkSecurityPoolOnQuestion(securityPool);
	}

	function migrateInheritedEscalationToGrandchild(
		ISecurityPool child,
		address vault,
		BinaryOutcomes.BinaryOutcome marketOutcome,
		uint256[] memory depositIndexes
	) public {
		require(vault != address(0x0), 'bad vault');
		require(marketOutcome != BinaryOutcomes.BinaryOutcome.None, 'bad outcome');
		require(_forkQuestionMatchesPool(child), 'not market fork');
		ISecurityPool rootPool = inheritedEscalationRootPoolByChild[child];
		require(address(rootPool) != address(0x0), 'no inherited');
		EscalationGame escalationGame = rootPool.escalationGame();
		require(address(escalationGame) != address(0x0) && escalationGame.nonDecisionTimestamp() > 0, 'no nondecision');
		ISecurityPool grandchild = _getOrDeployChildPool(child, uint256(uint8(marketOutcome)));
		uint8 marketOutcomeIndex = uint8(marketOutcome);
		uint256 repMigratedFromEscalationGame = 0;
		uint256 migratedPrincipal = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			uint256 depositIndex = depositIndexes[index];
			ImportedEscalationPosition storage position = importedEscalationPositionsByPool[child][marketOutcomeIndex][depositIndex];
			require(position.beneficiaryVault == vault, 'deposit was not for this vault');
			require(!position.settledOrMigrated, 'deposit already settled');
			position.settledOrMigrated = true;
			(address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) = escalationGame.claimDepositForWinning(depositIndex, marketOutcome);
			require(depositor == vault, 'deposit was not for this vault');
			require(originalDepositAmount == position.principal, 'principal mismatch');
			repMigratedFromEscalationGame += amountToWithdraw;
			migratedPrincipal += originalDepositAmount;
		}
		if (migratedPrincipal == 0) return;
		child.clearEscalationLockForForkMigration(vault, migratedPrincipal);
		_applyRepClaimToVault(grandchild, vault, repMigratedFromEscalationGame);
		forkDataByPool[grandchild].migratedRep += migratedPrincipal;
		_transferMigratedCollateral(child, grandchild, migratedPrincipal, forkDataByPool[child].repAtFork);
	}

	function hasInheritedEscalation(ISecurityPool securityPool) external view returns (bool) {
		return address(inheritedEscalationRootPoolByChild[securityPool]) != address(0x0);
	}

	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		SystemState systemState = securityPool.systemState();
		if (systemState == SystemState.PoolForked) return BinaryOutcomes.BinaryOutcome.None;
		ISecurityPool parent = securityPool.parent();
		if (address(parent) != address(0x0)) {
			if (_forkQuestionMatchesPool(parent)) {
				uint256 childOutcomeIndex = forkDataByPool[securityPool].outcomeIndex;
				if (childOutcomeIndex == 0) return BinaryOutcomes.BinaryOutcome.Invalid;
				if (childOutcomeIndex == 1) return BinaryOutcomes.BinaryOutcome.Yes;
				if (childOutcomeIndex == 2) return BinaryOutcomes.BinaryOutcome.No;
				return BinaryOutcomes.BinaryOutcome.None;
			}
			ISecurityPool inheritedRootPool = inheritedEscalationRootPoolByChild[securityPool];
			if (address(inheritedRootPool) != address(0x0)) {
				EscalationGame inheritedEscalationGame = inheritedRootPool.escalationGame();
				if (address(inheritedEscalationGame) != address(0x0)) {
					if (inheritedEscalationGame.nonDecisionTimestamp() > 0) return BinaryOutcomes.BinaryOutcome.None;
					uint256 inheritedEscalationEndDate = inheritedEscalationGame.getEscalationGameEndDate();
					if (block.timestamp > inheritedEscalationEndDate) return inheritedEscalationGame.getQuestionResolution();
				}
			}
		}
		if (systemState == SystemState.Operational) {
			EscalationGame escalationGame = securityPool.escalationGame();
			uint256 forkTime = zoltar.getForkTime(securityPool.universeId());
			if (address(escalationGame) != address(0x0)) {
				uint256 escalationEndDate = escalationGame.getEscalationGameEndDate();
				if (block.timestamp > escalationEndDate && (forkTime == 0 || escalationEndDate < forkTime)) return escalationGame.getQuestionResolution();
			}
		}
		return BinaryOutcomes.BinaryOutcome.None;
	}
}
