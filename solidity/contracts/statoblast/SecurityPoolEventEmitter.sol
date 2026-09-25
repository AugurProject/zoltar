// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { AccountingReason, ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerEvents } from './interfaces/ISecurityPoolForker.sol';
import { SecurityPoolForkerStorage } from './SecurityPoolForkerStorage.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolStorage } from './SecurityPoolStorage.sol';

/// @notice Delegate-called event encoder that keeps verbose checkpoint schemas out of SecurityPool runtime code.
contract SecurityPoolEventEmitter is SecurityPoolStorage {
	event PoolAccountingCheckpoint(AccountingReason reason, address indexed vault, uint256 settlementCollateralAttoEth, uint256 totalCapacityOwnershipAttoRep, uint256 activeObligationUnits, uint256 totalClaimableVaultFeesAttoEth, uint256 unallocatedAccruedFeesAttoEth, uint256 feeIndex, uint256 feeIndexRemainder, uint256 totalFeesOwedRemainder, uint256 uncheckpointedActiveObligationUnits, uint256 lastUpdatedFeeAccumulator, uint256 currentRetentionRate);
	event VaultAccountingCheckpoint(address indexed vault, uint256 repBackingUnits, uint256 capacityOwnershipAttoRep, uint256 claimableFeesAttoEth, uint256 feeIndex, uint256 vaultFeeRemainder, uint256 resultingTotalRepBackingUnits, uint256 resultingActiveObligationUnits);

	event PoolCoverageCheckpoint(uint256 indexed epoch, uint256 totalUnits, uint256 activeUnits, uint256 writtenOffUnits, uint256 unassignedUnits, uint256 migratedOutUnits);
	event VaultCoverageCheckpoint(address indexed vault, uint256 indexed epoch, uint256 obligationUnits);

	function emitPoolAccountingCheckpoint(AccountingReason reason, address vault) external payable {
		emit PoolCoverageCheckpoint(badDebtGeneration, totalObligationUnits, activeObligationUnits, writtenOffObligationUnits, unassignedObligationUnits, migratedOutObligationUnits);
		emit PoolAccountingCheckpoint(reason, vault, settlementCollateralAttoEth, totalCapacityOwnershipAttoRep, activeObligationUnits, totalClaimableVaultFeesAttoEth, unallocatedAccruedFeesAttoEth, feeIndex, feeIndexRemainder, totalFeesOwedRemainder, uncheckpointedActiveObligationUnits, lastUpdatedFeeAccumulator, currentRetentionRate);
	}

	function emitVaultAccountingCheckpoint(address vault) external payable {
		emit VaultCoverageCheckpoint(vault, badDebtGeneration, getVaultObligationUnits(vault));
		emit VaultAccountingCheckpoint(vault, securityVaults[vault].repBackingUnits, securityVaults[vault].capacityOwnershipAttoRep, securityVaults[vault].claimableFeesAttoEth, securityVaults[vault].feeIndex, vaultFeeRemainders[badDebtGeneration][vault], totalRepBackingUnits, activeObligationUnits);
	}
}

/// @notice Delegate-called fork event encoder sharing the forker's typed storage base.
contract SecurityPoolForkEventEmitter is SecurityPoolForkerStorage, ISecurityPoolForkerEvents {
	function emitForkSnapshotEvents(ISecurityPool parent, address migrationProxy, address sourceGame, uint256 totalPoolHeldRepAtForkAttoRep, uint256 disputeStakedRepAtForkAttoRep, uint256 resultingLockedAttoRep) external payable {
		SecurityPoolForkerForkData storage data = forkDataByPool[parent];
		if (data.unresolvedEscalationAtFork) {
			emit DisputeStakedRepDrainedAtFork(parent, sourceGame, disputeStakedRepAtForkAttoRep);
		}
		emit ParentRepLocked(parent, migrationProxy, totalPoolHeldRepAtForkAttoRep, disputeStakedRepAtForkAttoRep, resultingLockedAttoRep);
		emit SecurityPoolForkSnapshot(parent, migrationProxy, data.ownFork, data.unresolvedEscalationAtFork, data.settlementCollateralAtForkAttoEth, totalPoolHeldRepAtForkAttoRep, data.auctionableAttoRepAtFork, data.escalationSourceRepAtForkAttoRep, data.escalationChildRepAtForkAttoRep, data.escalationStartBondAtForkAttoRep, data.escalationNonDecisionThresholdAtForkAttoRep, data.escalationElapsedAtFork, data.escalationSnapshotId);
	}
}
