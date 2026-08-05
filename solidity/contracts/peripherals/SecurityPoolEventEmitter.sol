// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { AccountingReason, ISecurityPool, PoolAccountingSnapshot } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerEvents } from './interfaces/ISecurityPoolForker.sol';
import { SecurityPoolForkerStorage } from './SecurityPoolForkerStorage.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

/// @notice Delegate-called event encoder that keeps verbose checkpoint schemas out of SecurityPool runtime code.
contract SecurityPoolEventEmitter is SecurityPoolForkerStorage, ISecurityPoolForkerEvents {
	// SecurityPool accounting occupies slots 1-14, its SecurityVault mapping is slot 16,
	// and its per-vault fee remainder mapping is slot 17.
	// This delegate is intentionally storage-layout coupled; storage-layout tests protect these anchors.
	uint256 private constant SECURITY_VAULTS_SLOT = 16;
	uint256 private constant VAULT_FEE_REMAINDERS_SLOT = 17;
	event PoolAccountingCheckpoint(
		AccountingReason reason,
		address indexed vault,
		uint256 settlementCollateralAttoEth,
		uint256 totalCoverageCommitmentAttoEth,
		uint256 feeEligibleCoverageCommitmentAttoEth,
		uint256 totalClaimableVaultFeesAttoEth,
		uint256 unallocatedAccruedFeesAttoEth,
		uint256 feeIndex,
		uint256 feeIndexRemainder,
		uint256 totalFeesOwedRemainder,
		uint256 uncheckpointedFeeEligibleCoverageCommitmentAttoEth,
		uint256 lastUpdatedFeeAccumulator,
		uint256 currentRetentionRate
	);
	event VaultAccountingCheckpoint(
		address indexed vault,
		uint256 repBackingUnits,
		uint256 coverageCommitmentAttoEth,
		uint256 claimableFeesAttoEth,
		uint256 feeIndex,
		uint256 vaultFeeRemainder,
		uint256 resultingTotalRepBackingUnits,
		uint256 resultingFeeEligibleCoverageCommitmentAttoEth
	);

	function emitPoolAccountingCheckpoint(AccountingReason reason, address vault) external payable {
		PoolAccountingSnapshot memory snapshot;
		assembly ('memory-safe') {
			snapshot := mload(0x40)
			mstore(0x40, add(snapshot, 0x160))
			mstore(snapshot, sload(2))
			mstore(add(snapshot, 0x20), sload(1))
			mstore(add(snapshot, 0x40), sload(12))
			mstore(add(snapshot, 0x60), sload(6))
			mstore(add(snapshot, 0x80), sload(11))
			mstore(add(snapshot, 0xa0), sload(8))
			mstore(add(snapshot, 0xc0), sload(9))
			mstore(add(snapshot, 0xe0), sload(10))
			mstore(add(snapshot, 0x100), sload(13))
			mstore(add(snapshot, 0x120), sload(7))
			mstore(add(snapshot, 0x140), sload(14))
		}
		emit PoolAccountingCheckpoint(
			reason,
			vault,
			snapshot.settlementCollateralAttoEth,
			snapshot.totalCoverageCommitmentAttoEth,
			snapshot.feeEligibleCoverageCommitmentAttoEth,
			snapshot.totalClaimableVaultFeesAttoEth,
			snapshot.unallocatedAccruedFeesAttoEth,
			snapshot.feeIndex,
			snapshot.feeIndexRemainder,
			snapshot.totalFeesOwedRemainder,
			snapshot.uncheckpointedFeeEligibleCoverageCommitmentAttoEth,
			snapshot.lastUpdatedFeeAccumulator,
			snapshot.currentRetentionRate
		);
	}

	function emitVaultAccountingCheckpoint(address vault) external payable {
		bytes32 vaultSlot = keccak256(abi.encode(vault, SECURITY_VAULTS_SLOT));
		uint256 repBackingUnits;
		uint256 coverageCommitmentAttoEth;
		uint256 claimableFeesAttoEth;
		uint256 vaultFeeIndex;
		uint256 vaultFeeRemainder;
		uint256 resultingTotalRepBackingUnits;
		uint256 resultingFeeEligibleCoverageCommitmentAttoEth;
		bytes32 vaultFeeRemainderSlot = keccak256(abi.encode(vault, VAULT_FEE_REMAINDERS_SLOT));
		assembly {
			repBackingUnits := sload(vaultSlot)
			coverageCommitmentAttoEth := sload(add(vaultSlot, 1))
			claimableFeesAttoEth := sload(add(vaultSlot, 2))
			vaultFeeIndex := sload(add(vaultSlot, 3))
			vaultFeeRemainder := sload(vaultFeeRemainderSlot)
			resultingTotalRepBackingUnits := sload(3)
			resultingFeeEligibleCoverageCommitmentAttoEth := sload(12)
		}
		emit VaultAccountingCheckpoint(
			vault,
			repBackingUnits,
			coverageCommitmentAttoEth,
			claimableFeesAttoEth,
			vaultFeeIndex,
			vaultFeeRemainder,
			resultingTotalRepBackingUnits,
			resultingFeeEligibleCoverageCommitmentAttoEth
		);
	}

	function emitForkSnapshotEvents(
		ISecurityPool parent,
		address migrationProxy,
		address sourceGame,
		uint256 totalPoolHeldRepAtForkAttoRep,
		uint256 disputeStakedRepAtForkAttoRep,
		uint256 resultingLockedRepAttoRep
	) external payable {
		SecurityPoolForkerForkData storage data = forkDataByPool[parent];
		if (data.unresolvedEscalationAtFork) {
			emit DisputeStakedRepDrainedAtFork(parent, sourceGame, disputeStakedRepAtForkAttoRep);
		}
		emit ParentRepLocked(
			parent,
			migrationProxy,
			totalPoolHeldRepAtForkAttoRep,
			disputeStakedRepAtForkAttoRep,
			resultingLockedRepAttoRep
		);
		emit SecurityPoolForkSnapshot(
			parent,
			migrationProxy,
			data.ownFork,
			data.unresolvedEscalationAtFork,
			data.settlementCollateralAtForkAttoEth,
			totalPoolHeldRepAtForkAttoRep,
			data.auctionableRepAtForkAttoRep,
			data.escalationSourceRepAtForkAttoRep,
			data.escalationChildRepAtForkAttoRep,
			data.escalationStartBondAtForkAttoRep,
			data.escalationNonDecisionThresholdAtForkAttoRep,
			data.escalationElapsedAtFork,
			data.escalationSnapshotId
		);
	}
}
