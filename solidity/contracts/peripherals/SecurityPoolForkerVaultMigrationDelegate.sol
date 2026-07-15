// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';

contract SecurityPoolForkerVaultMigrationDelegate is SecurityPoolForkerVaultMigrationBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child) internal override {
		ISecurityPoolForkerChildEscalationGameInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(
			parent,
			child
		);
	}

	function createChildUniverse(ISecurityPool parent, uint256 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'Child pool exists');
		_getOrDeployChildPool(parent, outcomeIndex);
	}

	function migrateVault(ISecurityPool parent, uint256 outcomeIndex) public {
		require(
			block.timestamp <= zoltar.getForkTime(parent.universeId()) + SecurityPoolUtils.MIGRATION_TIME,
			'Migration window closed'
		);
		ISecurityPool child = _getOrDeployChildPool(parent, outcomeIndex);
		_migrateVaultUnlockedState(parent, child, msg.sender);
	}

	function ensureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 requiredSplit) public {
		_ensureChildPoolRepSplit(parent, outcomeIndex, requiredSplit);
	}

	function emitForkSnapshotEvents(
		ISecurityPool parent,
		address migrationProxy,
		address sourceGame,
		uint256 poolRepAtFork,
		uint256 escalationRepAtFork,
		uint256 resultingLockedRep
	) external {
		SecurityPoolForkerForkData storage data = forkDataByPool[parent];
		if (data.unresolvedEscalationAtFork) {
			emit EscalationRepDrainedAtFork(parent, sourceGame, escalationRepAtFork);
		}
		emit ParentRepLocked(parent, migrationProxy, poolRepAtFork, escalationRepAtFork, resultingLockedRep);
		emit SecurityPoolForkSnapshot(
			parent,
			migrationProxy,
			data.ownFork,
			data.unresolvedEscalationAtFork,
			data.collateralAtFork,
			poolRepAtFork,
			data.auctionableRepAtFork,
			data.escalationSourceRepAtFork,
			data.escalationChildRepAtFork,
			data.escalationStartBondAtFork,
			data.escalationNonDecisionThresholdAtFork,
			data.escalationElapsedAtFork,
			data.escalationSnapshotId
		);
	}
}
