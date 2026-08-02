// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);

	function resumeForkedEscalationGame() external {
		// This is permissionless for liveness, but each game call imports no more
		// than its fixed checkpoint batch. The fork itself must already be final.
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
		uint256 snapshotTotalRep,
		uint256 snapshotDenominator,
		uint256 repEthPrice
	) external returns (uint256 debtToMove, uint256 repToMove) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(securityVaults[targetVault].poolOwnership == snapshotTargetOwnership, 'Target ownership changed');
		require(
			securityVaults[targetVault].securityBondAllowance == snapshotTargetAllowance,
			'Target allowance changed'
		);
		require(
			_samePoolRepRate(
				pool.getTotalRepBalance(),
				pool.poolOwnershipDenominator(),
				snapshotTotalRep,
				snapshotDenominator
			),
			'Pool REP rate changed'
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
			IERC20(address(pool.repToken())).balanceOf(address(this)),
			poolOwnershipDenominator
		);
		require(debtToMove > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[targetVault].securityBondAllowance = snapshotTargetAllowance - debtToMove;
		securityVaults[targetVault].poolOwnership -= ownershipToMove;
		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += ownershipToMove;
		uint256 targetFees = securityVaults[targetVault].unpaidEthFees;
		uint256 feesToMove =
			debtToMove == snapshotTargetAllowance ? targetFees : (targetFees * debtToMove) / snapshotTargetAllowance;
		securityVaults[targetVault].unpaidEthFees = targetFees - feesToMove;
		securityVaults[callerVault].unpaidEthFees += feesToMove;
		if (address(escalationGame) != address(0x0)) {
			// The current game carries a consolidated payout-owner checkpoint for
			// the complete fork lineage, so liquidation never walks fork ancestry.
			_moveEscalationClaim(
				address(escalationGame),
				targetVault,
				callerVault,
				debtToMove,
				snapshotTargetAllowance
			);
		}
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

	function _samePoolRepRate(
		uint256 currentRep,
		uint256 currentDenominator,
		uint256 snapshotRep,
		uint256 snapshotDenominator
	) private pure returns (bool sameRate) {
		if (currentDenominator == 0 || snapshotDenominator == 0) {
			return currentDenominator == snapshotDenominator && currentRep == snapshotRep;
		}
		uint256 currentLow;
		uint256 currentHigh;
		uint256 snapshotLow;
		uint256 snapshotHigh;
		assembly ('memory-safe') {
			let currentMm := mulmod(currentRep, snapshotDenominator, not(0))
			currentLow := mul(currentRep, snapshotDenominator)
			currentHigh := sub(sub(currentMm, currentLow), lt(currentMm, currentLow))
			let snapshotMm := mulmod(snapshotRep, currentDenominator, not(0))
			snapshotLow := mul(snapshotRep, currentDenominator)
			snapshotHigh := sub(sub(snapshotMm, snapshotLow), lt(snapshotMm, snapshotLow))
		}
		return currentLow == snapshotLow && currentHigh == snapshotHigh;
	}

	function _moveEscalationClaim(
		address game,
		address fromVault,
		address toVault,
		uint256 numerator,
		uint256 denominator
	) private {
		(bool claimMoved, ) = game.call(
			abi.encodeWithSignature(
				'moveEscalationClaim(address,address,uint256,uint256)',
				fromVault,
				toVault,
				numerator,
				denominator
			)
		);
		require(claimMoved, 'Claim move failed');
	}
}
