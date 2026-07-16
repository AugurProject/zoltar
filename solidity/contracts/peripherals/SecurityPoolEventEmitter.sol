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
		uint256 completeSetCollateralAmount,
		uint256 totalSecurityBondAllowance,
		uint256 feeEligibleSecurityBondAllowance,
		uint256 totalFeesOwedToVaults,
		uint256 unallocatedFeeReserve,
		uint256 feeIndex,
		uint256 feeIndexRemainder,
		uint256 totalFeesOwedRemainder,
		uint256 uncheckpointedFeeEligibleAllowance,
		uint256 lastUpdatedFeeAccumulator,
		uint256 currentRetentionRate
	);
	event VaultAccountingCheckpoint(
		address indexed vault,
		uint256 poolOwnershipAmount,
		uint256 securityBondAllowance,
		uint256 unpaidEthFees,
		uint256 feeIndex,
		uint256 vaultFeeRemainder,
		uint256 resultingPoolOwnershipDenominator,
		uint256 resultingFeeEligibleSecurityBondAllowance
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
			snapshot.completeSetCollateralAmount,
			snapshot.totalSecurityBondAllowance,
			snapshot.feeEligibleSecurityBondAllowance,
			snapshot.totalFeesOwedToVaults,
			snapshot.unallocatedFeeReserve,
			snapshot.feeIndex,
			snapshot.feeIndexRemainder,
			snapshot.totalFeesOwedRemainder,
			snapshot.uncheckpointedFeeEligibleAllowance,
			snapshot.lastUpdatedFeeAccumulator,
			snapshot.currentRetentionRate
		);
	}

	function emitVaultAccountingCheckpoint(address vault) external payable {
		bytes32 vaultSlot = keccak256(abi.encode(vault, SECURITY_VAULTS_SLOT));
		uint256 poolOwnershipAmount;
		uint256 securityBondAllowance;
		uint256 unpaidEthFees;
		uint256 vaultFeeIndex;
		uint256 vaultFeeRemainder;
		uint256 resultingPoolOwnershipDenominator;
		uint256 resultingFeeEligibleSecurityBondAllowance;
		bytes32 vaultFeeRemainderSlot = keccak256(abi.encode(vault, VAULT_FEE_REMAINDERS_SLOT));
		assembly {
			poolOwnershipAmount := sload(vaultSlot)
			securityBondAllowance := sload(add(vaultSlot, 1))
			unpaidEthFees := sload(add(vaultSlot, 2))
			vaultFeeIndex := sload(add(vaultSlot, 3))
			vaultFeeRemainder := sload(vaultFeeRemainderSlot)
			resultingPoolOwnershipDenominator := sload(3)
			resultingFeeEligibleSecurityBondAllowance := sload(12)
		}
		emit VaultAccountingCheckpoint(
			vault,
			poolOwnershipAmount,
			securityBondAllowance,
			unpaidEthFees,
			vaultFeeIndex,
			vaultFeeRemainder,
			resultingPoolOwnershipDenominator,
			resultingFeeEligibleSecurityBondAllowance
		);
	}

	function emitForkSnapshotEvents(
		ISecurityPool parent,
		address migrationProxy,
		address sourceGame,
		uint256 poolRepAtFork,
		uint256 escalationRepAtFork,
		uint256 resultingLockedRep
	) external payable {
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
