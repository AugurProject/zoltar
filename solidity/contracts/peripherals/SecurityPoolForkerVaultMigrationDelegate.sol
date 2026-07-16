// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

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

	function finalizeTruthAuctionRepair(
		ISecurityPool securityPool,
		uint256 auctionEthReceived,
		uint256 parentCollateralAtFork
	) public payable {
		if (msg.value > 0) {
			(bool sent, ) = payable(address(securityPool)).call{ value: msg.value }('');
			require(sent, 'ETH');
		}
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 collateralAmount = data.forkCollateralReceived + auctionEthReceived + msg.value;
		uint256 wholeRepairUnits = parentCollateralAtFork / SecurityPoolUtils.BPS_DENOMINATOR;
		uint256 remainingCollateral = parentCollateralAtFork % SecurityPoolUtils.BPS_DENOMINATOR;
		uint256 minimumRepair =
			wholeRepairUnits * SecurityPoolUtils.MIN_TRUTH_AUCTION_REPAIR_BPS +
				(remainingCollateral * SecurityPoolUtils.MIN_TRUTH_AUCTION_REPAIR_BPS +
					SecurityPoolUtils.BPS_DENOMINATOR -
					1) /
					SecurityPoolUtils.BPS_DENOMINATOR;
		require(collateralAmount >= minimumRepair && collateralAmount <= parentCollateralAtFork, 'Repair');
		uint256 parentTotalSecurityBondAllowance = securityPool.parent().totalSecurityBondAllowance();
		uint256 unmigratedSecurityBondAllowance = parentTotalSecurityBondAllowance - data.migratedSecurityBondAllowance;
		uint256 ethRaiseCap = data.truthAuction.ethRaiseCap();
		data.auctionedSecurityBondAllowance =
			ethRaiseCap == 0 ? 0 : Math.mulDiv(unmigratedSecurityBondAllowance, auctionEthReceived, ethRaiseCap);
		securityPool.setPoolFinancials(
			collateralAmount,
			parentTotalSecurityBondAllowance,
			data.migratedSecurityBondAllowance
		);
		securityPool.setSystemState(SystemState.Operational);
	}
}
