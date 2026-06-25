// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';

contract SecurityPoolForkerVaultMigrationDelegate is SecurityPoolForkerVaultMigrationBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerVaultMigrationBase(_zoltar) {}

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
		parent.updateVaultFees(msg.sender);
		ISecurityPool child = _getOrDeployChildPool(parent, outcomeIndex);
		_migrateVaultUnlockedState(parent, child, msg.sender);
	}
}
