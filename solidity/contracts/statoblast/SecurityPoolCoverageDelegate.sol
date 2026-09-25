// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { ISecurityPool, SystemState, AccountingReason } from './interfaces/ISecurityPool.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolEventEmitter } from './SecurityPoolEventEmitter.sol';
import { DelegateCallForwarder } from './DelegateCallForwarder.sol';

interface ICoveragePoolContext {
	function eventEmitter() external view returns (SecurityPoolEventEmitter);
}

/// @dev Called by the pool's access-controlled forker entry points through delegatecall.
abstract contract SecurityPoolCoverageDelegate is SecurityPoolStorage {
	function configureCoverageVault(address vault, uint256 units) external {
		ISecurityPool(payable(address(this))).updateVaultFees(vault);
		uint256 previous = getVaultObligationUnits(vault);
		if (systemState == SystemState.PoolForked) {
			require(units == 0, 'Frozen coverage can only migrate out');
			migratedOutObligationUnits += previous;
			activeObligationUnits -= previous;
		} else {
			require(systemState == SystemState.ForkMigration, 'Coverage migration closed');
			require(units >= previous, 'Migrated units decreased');
			unassignedObligationUnits -= units - previous;
			activeObligationUnits += units - previous;
		}
		coveragePositions[vault] = CoveragePosition(units, badDebtGeneration);
	}

	function setCoverageFinancials(uint256 totalUnits, uint256 writtenOffUnits, uint256 unassignedUnits) external {
		require(systemState != SystemState.Operational, 'Coverage already active');
		require(totalObligationUnits == 0 || totalObligationUnits == totalUnits, 'Coverage denominator changed');
		require(writtenOffUnits + unassignedUnits <= totalUnits, 'Coverage buckets exceed total');
		totalObligationUnits = totalUnits;
		writtenOffObligationUnits = writtenOffUnits;
		unassignedObligationUnits = unassignedUnits;
	}

	function creditFinalizedAuctionCoverage(address vault, uint256 units, uint256 epoch, uint256 initialFeeIndex) external {
		ISecurityPool(payable(address(this))).updateVaultFees(vault);
		uint256 finalIndex = epoch == badDebtGeneration ? feeIndex : finalFeeIndexByEpoch[epoch];
		require(initialFeeIndex <= finalIndex, 'Auction fee index');
		(uint256 fees, uint256 remainder) = SecurityPoolUtils.calculateVaultFee(units, finalIndex - initialFeeIndex, vaultFeeRemainders[epoch][vault]);
		vaultFeeRemainders[epoch][vault] = remainder;
		unallocatedAccruedFeesAttoEth -= fees;
		totalClaimableVaultFeesAttoEth += fees;
		securityVaults[vault].claimableFeesAttoEth += fees;
		if (epoch == badDebtGeneration) {
			unassignedObligationUnits -= units;
			coveragePositions[vault].units += units;
			if (initialFeeIndex != feeIndex) uncheckpointedActiveObligationUnits -= units;
		}
		DelegateCallForwarder.invoke(address(ICoveragePoolContext(address(this)).eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
		DelegateCallForwarder.invoke(address(ICoveragePoolContext(address(this)).eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.AuctionClaim, vault)));
	}
}
