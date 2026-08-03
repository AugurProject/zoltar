// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);

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
	) external returns (uint256 debtToMove, uint256 repToMove) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
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
		uint256 candidateDebtToMove = debtAmount > snapshotTargetAllowance ? snapshotTargetAllowance : debtAmount;
		uint256 debtRemaining = snapshotTargetAllowance - candidateDebtToMove;
		if (debtRemaining > 0 && debtRemaining < SecurityPoolUtils.MIN_SECURITY_BOND_DEBT) {
			candidateDebtToMove = snapshotTargetAllowance;
		}
		(debtToMove, repToMove, ownershipToMove) = SecurityPoolUtils.calculateBundledLiquidationTransfer(
			securityVaults[targetVault].poolOwnership,
			snapshotTargetAllowance,
			candidateDebtToMove,
			repEthPrice,
			pool.getTotalRepBalance(),
			poolOwnershipDenominator
		);
		if (debtToMove != candidateDebtToMove) {
			(debtToMove, repToMove, ownershipToMove) = SecurityPoolUtils.calculateBundledLiquidationTransfer(
				securityVaults[targetVault].poolOwnership,
				snapshotTargetAllowance,
				debtToMove,
				repEthPrice,
				pool.getTotalRepBalance(),
				poolOwnershipDenominator
			);
		}
		require(debtToMove > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[targetVault].securityBondAllowance = snapshotTargetAllowance - debtToMove;
		securityVaults[targetVault].poolOwnership -= ownershipToMove;
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
	}
}
