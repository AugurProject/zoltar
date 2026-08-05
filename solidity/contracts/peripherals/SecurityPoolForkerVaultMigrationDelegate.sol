// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGame } from './EscalationGame.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';

contract SecurityPoolForkerVaultMigrationDelegate is SecurityPoolForkerVaultMigrationBase {
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

	function createChildUniverse(ISecurityPool parent, uint256 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'Child pool exists');
		_getOrDeployChildPool(parent, outcomeIndex);
	}

	function migrateVault(
		ISecurityPool parent,
		uint256 outcomeIndex
	) public returns (ISecurityPool child, EscalationGame childEscalationGame) {
		require(
			block.timestamp <= forkDataByPool[parent].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME,
			'Migration window closed'
		);
		(child, childEscalationGame) = _getOrDeployChildPool(parent, outcomeIndex);
		_migrateNonEscrowedVaultAccounting(parent, child, msg.sender);
		return (child, childEscalationGame);
	}

	function ensureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 requiredSplitAttoRep) public {
		_ensureChildPoolRepSplit(parent, outcomeIndex, requiredSplitAttoRep);
	}

	function finalizeTruthAuctionRepair(
		ISecurityPool securityPool,
		uint256 auctionSettlementCollateralReceivedAttoEth,
		uint256 parentSettlementCollateralAtForkAttoEth
	) public payable {
		require(msg.value == 0, 'Auction finalization does not accept repair contributions');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 settlementCollateralAttoEth =
			data.forkSettlementCollateralReceivedAttoEth + auctionSettlementCollateralReceivedAttoEth;
		require(settlementCollateralAttoEth <= parentSettlementCollateralAtForkAttoEth, 'Repair');
		uint256 parentTotalCoverageCommitmentAttoEth = securityPool.parent().totalCoverageCommitmentAttoEth();
		uint256 unmigratedCoverageCommitmentAttoEth =
			parentTotalCoverageCommitmentAttoEth - data.migratedCoverageCommitmentAttoEth;
		uint256 totalAttoRepPurchased = data.truthAuction.totalAttoRepPurchased();
		data.auctionedCoverageCommitmentAttoEth =
			totalAttoRepPurchased == 0 ? 0 : unmigratedCoverageCommitmentAttoEth;
		securityPool.setPoolFinancials(
			settlementCollateralAttoEth,
			parentTotalCoverageCommitmentAttoEth,
			data.migratedCoverageCommitmentAttoEth
		);
		securityPool.setSystemState(SystemState.Operational);
	}
}
