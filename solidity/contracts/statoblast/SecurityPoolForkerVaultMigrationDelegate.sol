// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerChildEscalationGameInitializer } from './interfaces/ISecurityPoolForkerChildEscalationGameInitializer.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGame } from './EscalationGame.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolForkerVaultMigrationBase } from './SecurityPoolForkerVaultMigrationBase.sol';
import { SecurityPoolForkerAuctionSettlementBase } from './SecurityPoolForkerAuctionSettlementBase.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';

contract SecurityPoolForkerVaultMigrationDelegate is
	SecurityPoolForkerVaultMigrationBase,
	SecurityPoolForkerAuctionSettlementBase
{
	constructor(Zoltar _zoltar) SecurityPoolForkerAuctionSettlementBase(_zoltar) {}

	function _assignAuctionBadDebt(ISecurityPool securityPool, uint256 nextClaimedCapacityOwnershipAttoRep, uint256 auctionedCapacityOwnershipAttoRep) internal override returns (uint256 badDebtToAssignAttoEth) {
		uint256 nextClaimedBadDebtAttoEth;
		(badDebtToAssignAttoEth, nextClaimedBadDebtAttoEth) = SecurityPoolUtils.calculateCumulativeAuctionBadDebt(auctionedBadDebtByPool[securityPool], nextClaimedCapacityOwnershipAttoRep, auctionedCapacityOwnershipAttoRep, claimedAuctionedBadDebtByPool[securityPool]);
		claimedAuctionedBadDebtByPool[securityPool] = nextClaimedBadDebtAttoEth;
	}

	function creditAuctionProceeds(ISecurityPool securityPool, address vault, uint256 amountAttoRep, uint256 newCapacityOwnershipAttoRep, uint256 totalAttoRepPurchased) public {
		_creditAuctionProceeds(securityPool, vault, forkDataByPool[securityPool], amountAttoRep, newCapacityOwnershipAttoRep, totalAttoRepPurchased);
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool parent, ISecurityPool child, EscalationGame childEscalationGame) internal override returns (EscalationGame) {
		return
			ISecurityPoolForkerChildEscalationGameInitializer(address(this)).initializeChildForkedEscalationGameIfNeeded(parent, child, childEscalationGame);
	}

	function createChildUniverse(ISecurityPool parent, uint256 outcomeIndex) public {
		require(address(childrenByPoolAndOutcome[parent][outcomeIndex]) == address(0x0), 'Child pool exists');
		_getOrDeployChildPool(parent, outcomeIndex);
	}

	function migrateVault(ISecurityPool parent, uint256 outcomeIndex) public returns (ISecurityPool child, EscalationGame childEscalationGame) {
		require(block.timestamp <= forkDataByPool[parent].forkActivationTime + SecurityPoolUtils.MIGRATION_TIME, 'Migration window closed');
		(child, childEscalationGame) = _getOrDeployChildPool(parent, outcomeIndex);
		_migrateNonEscrowedVaultAccounting(parent, child, msg.sender);
		return (child, childEscalationGame);
	}

	function ensureChildPoolRepSplit(ISecurityPool parent, uint256 outcomeIndex, uint256 requiredSplitAttoRep) public {
		_ensureChildPoolRepSplit(parent, outcomeIndex, requiredSplitAttoRep);
	}

	function finalizeTruthAuctionRepair(ISecurityPool securityPool, uint256 auctionSettlementCollateralReceivedAttoEth, uint256 parentSettlementCollateralAtForkAttoEth) public payable {
		require(msg.value == 0, 'No repair ETH');
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		uint256 settlementCollateralAttoEth =
			data.forkSettlementCollateralReceivedAttoEth + auctionSettlementCollateralReceivedAttoEth;
		require(settlementCollateralAttoEth <= parentSettlementCollateralAtForkAttoEth, 'Repair');
		uint256 parentTotalCapacityOwnershipAttoRep = securityPool.parent().totalCapacityOwnershipAttoRep();
		uint256 unmigratedCapacityOwnershipAttoRep =
			parentTotalCapacityOwnershipAttoRep - data.migratedCapacityOwnershipAttoRep;
		data.auctionedCapacityOwnershipAttoRep = unmigratedCapacityOwnershipAttoRep;
		uint256 totalAttoRepPurchased = data.truthAuction.totalAttoRepPurchased();
		uint256 parentBadDebtAtForkAttoEth = badDebtAtForkByPool[securityPool.parent()];
		uint256 migratedBadDebtAttoEth = migratedBadDebtByPool[securityPool];
		require(migratedBadDebtAttoEth <= parentBadDebtAtForkAttoEth, 'Bad debt high');
		auctionedBadDebtByPool[securityPool] = parentBadDebtAtForkAttoEth - migratedBadDebtAttoEth;
		uint256 feeEligibleAuctionCapacityOwnershipAttoRep =
			totalAttoRepPurchased == 0 ? 0 : data.auctionedCapacityOwnershipAttoRep;
		securityPool.setPoolFinancials(settlementCollateralAttoEth, parentTotalCapacityOwnershipAttoRep, data.migratedCapacityOwnershipAttoRep + feeEligibleAuctionCapacityOwnershipAttoRep, parentBadDebtAtForkAttoEth);
		data.auctionFeeIndexAtFinalization = securityPool.feeIndex();
		securityPool.setSystemState(SystemState.Operational);
	}
}
