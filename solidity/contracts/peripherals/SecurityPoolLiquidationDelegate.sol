// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultBadDebtRecorded(
		address indexed targetVault,
		uint256 badDebtAmount,
		uint256 resultingVaultBadDebt,
		uint256 resultingTotalBadDebt
	);

	function resumeForkedEscalationGame() external {
		// This is permissionless for liveness. The immutable carry commitment was
		// installed during child initialization, so resumption does no unbounded work.
		if (!awaitingForkContinuation || systemState != SystemState.Operational) revert();
		escalationGame.resumeFromFork();
		if (escalationGame.forkResumedAt() == 0) return;
		awaitingForkContinuation = false;
		emit AwaitingForkContinuationSet(false);
	}

	function performBundledLiquidation(
		address callerVault,
		address targetVault,
		uint256 debtAmount,
		uint256 snapshotTargetOwnership,
		uint256 snapshotTargetAllowance,
		uint256 repEthPrice
	) external returns (uint256 debtToMove, uint256 repToMove, uint256 badDebtRecorded) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(callerVault != targetVault, 'Caller bad');
		require(securityVaults[targetVault].poolOwnership == snapshotTargetOwnership, 'Target ownership changed');
		require(
			securityVaults[targetVault].securityBondAllowance == snapshotTargetAllowance,
			'Target allowance changed'
		);
		uint256 targetFreeRep = pool.poolOwnershipToRep(snapshotTargetOwnership);
		uint256 targetEscalationRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.escrowedRepByVault(targetVault);
		require(
			!SecurityPoolUtils.isVaultHealthy(
				targetFreeRep,
				targetEscalationRep,
				snapshotTargetAllowance,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Target safe'
		);
		uint256 ownershipToMove;
		(debtToMove, repToMove, ownershipToMove) = SecurityPoolUtils.calculateBundledLiquidationTransfer(
			securityVaults[targetVault].poolOwnership,
			snapshotTargetAllowance,
			debtAmount,
			repEthPrice,
			pool.getTotalRepBalance(),
			poolOwnershipDenominator
		);
		if (
			debtToMove != 0 &&
			securityVaults[callerVault].securityBondAllowance + debtToMove < SecurityPoolUtils.MIN_SECURITY_BOND_DEBT
		) {
			require(debtAmount >= snapshotTargetAllowance, 'Caller debt');
			debtToMove = 0;
			repToMove = 0;
			ownershipToMove = 0;
		}
		if (debtAmount >= snapshotTargetAllowance) {
			badDebtRecorded = snapshotTargetAllowance - debtToMove;
			if (badDebtRecorded != 0) {
				totalBadDebt += badDebtRecorded;
				vaultBadDebt[targetVault] += badDebtRecorded;
				totalSecurityBondAllowance -= badDebtRecorded;
				feeEligibleSecurityBondAllowance -= badDebtRecorded;
				emit VaultBadDebtRecorded(targetVault, badDebtRecorded, vaultBadDebt[targetVault], totalBadDebt);
			}
		}
		require(debtToMove > 0 || badDebtRecorded > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[targetVault].securityBondAllowance = snapshotTargetAllowance - debtToMove - badDebtRecorded;
		securityVaults[targetVault].poolOwnership -= ownershipToMove;
		if (debtToMove == 0) return (debtToMove, repToMove, badDebtRecorded);
		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += ownershipToMove;
		uint256 callerEscalationRep;
		if (address(escalationGame) != address(0x0)) {
			try escalationGame.escrowedRepByVault(callerVault) returns (uint256 claimRep) {
				callerEscalationRep = claimRep;
			} catch {
				revert('Claim balance failed');
			}
		}
		require(
			SecurityPoolUtils.isVaultHealthy(
				pool.poolOwnershipToRep(securityVaults[callerVault].poolOwnership),
				callerEscalationRep,
				securityVaults[callerVault].securityBondAllowance,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Caller bad'
		);
		uint256 targetAllowanceAfter = securityVaults[targetVault].securityBondAllowance;
		uint256 targetFreeRepAfter = pool.poolOwnershipToRep(securityVaults[targetVault].poolOwnership);
		require(
			targetAllowanceAfter == 0 || targetAllowanceAfter >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT,
			'Target debt'
		);
		require(targetAllowanceAfter == 0 || targetFreeRepAfter >= SecurityPoolUtils.MIN_REP_DEPOSIT, 'Target REP');
		require(
			securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT,
			'Caller debt'
		);
		require(
			pool.poolOwnershipToRep(securityVaults[callerVault].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT,
			'Caller REP'
		);
	}
}
