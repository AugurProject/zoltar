// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultBadDebtRecorded(
		address indexed targetVault,
		uint256 badDebtAttoEth,
		uint256 resultingVaultBadDebtAttoEth,
		uint256 resultingTotalBadDebtAttoEth
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
		uint256 requestedCommitmentTransferAttoEth,
		uint256 snapshotTargetBackingUnits,
		uint256 snapshotTargetCoverageCommitmentAttoEth,
		uint256 repEthPrice
	)
		external
		returns (
			uint256 coverageCommitmentToTransferAttoEth,
			uint256 vaultAttoRepBackingToTransfer,
			uint256 badDebtAttoEth
		)
	{
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(callerVault != targetVault, 'Caller bad');
		require(
			securityVaults[targetVault].repBackingUnits == snapshotTargetBackingUnits,
			'Target backingUnits changed'
		);
		require(
			securityVaults[targetVault].coverageCommitmentAttoEth == snapshotTargetCoverageCommitmentAttoEth,
			'Target commitment changed'
		);
		uint256 targetVaultRepBackingAttoRep = pool.backingUnitsToAttoRep(snapshotTargetBackingUnits);
		uint256 targetDisputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(targetVault);
		require(
			!SecurityPoolUtils.isVaultHealthy(
				targetVaultRepBackingAttoRep,
				targetDisputeStakedAttoRep,
				snapshotTargetCoverageCommitmentAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Target safe'
		);
		uint256 backingUnitsToTransfer;
		(coverageCommitmentToTransferAttoEth, vaultAttoRepBackingToTransfer, backingUnitsToTransfer) = SecurityPoolUtils
			.calculateBundledLiquidationTransfer(
				securityVaults[targetVault].repBackingUnits,
				snapshotTargetCoverageCommitmentAttoEth,
				requestedCommitmentTransferAttoEth,
				repEthPrice,
				pool.getTotalPoolHeldAttoRep(),
				totalRepBackingUnits
			);
		if (
			coverageCommitmentToTransferAttoEth != 0 &&
			securityVaults[callerVault].coverageCommitmentAttoEth + coverageCommitmentToTransferAttoEth <
				SecurityPoolUtils.MIN_COVERAGE_COMMITMENT_ATTO_ETH
		) {
			require(
				requestedCommitmentTransferAttoEth >= snapshotTargetCoverageCommitmentAttoEth,
				'Commitment request low'
			);
			coverageCommitmentToTransferAttoEth = 0;
			vaultAttoRepBackingToTransfer = 0;
			backingUnitsToTransfer = 0;
		}
		if (requestedCommitmentTransferAttoEth >= snapshotTargetCoverageCommitmentAttoEth) {
			badDebtAttoEth = snapshotTargetCoverageCommitmentAttoEth - coverageCommitmentToTransferAttoEth;
			if (badDebtAttoEth != 0) {
				totalBadDebtAttoEth += badDebtAttoEth;
				vaultBadDebtAttoEth[targetVault] += badDebtAttoEth;
				totalCoverageCommitmentAttoEth -= badDebtAttoEth;
				feeEligibleCoverageCommitmentAttoEth -= badDebtAttoEth;
				emit VaultBadDebtRecorded(
					targetVault,
					badDebtAttoEth,
					vaultBadDebtAttoEth[targetVault],
					totalBadDebtAttoEth
				);
			}
		}
		require(coverageCommitmentToTransferAttoEth > 0 || badDebtAttoEth > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[targetVault].coverageCommitmentAttoEth =
			snapshotTargetCoverageCommitmentAttoEth -
			coverageCommitmentToTransferAttoEth -
			badDebtAttoEth;
		securityVaults[targetVault].repBackingUnits -= backingUnitsToTransfer;
		if (coverageCommitmentToTransferAttoEth == 0)
			return (coverageCommitmentToTransferAttoEth, vaultAttoRepBackingToTransfer, badDebtAttoEth);
		securityVaults[callerVault].coverageCommitmentAttoEth += coverageCommitmentToTransferAttoEth;
		securityVaults[callerVault].repBackingUnits += backingUnitsToTransfer;
		uint256 callerDisputeStakedAttoRep;
		if (address(escalationGame) != address(0x0)) {
			try escalationGame.disputeStakedRepByVaultAttoRep(callerVault) returns (uint256 claimRep) {
				callerDisputeStakedAttoRep = claimRep;
			} catch {
				revert('Claim balance failed');
			}
		}
		require(
			SecurityPoolUtils.isVaultHealthy(
				pool.backingUnitsToAttoRep(securityVaults[callerVault].repBackingUnits),
				callerDisputeStakedAttoRep,
				securityVaults[callerVault].coverageCommitmentAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Caller bad'
		);
		uint256 targetCoverageCommitmentAttoEthAfter = securityVaults[targetVault].coverageCommitmentAttoEth;
		uint256 targetVaultRepBackingAfterAttoRep = pool.backingUnitsToAttoRep(
			securityVaults[targetVault].repBackingUnits
		);
		require(
			targetCoverageCommitmentAttoEthAfter == 0 ||
				targetCoverageCommitmentAttoEthAfter >= SecurityPoolUtils.MIN_COVERAGE_COMMITMENT_ATTO_ETH,
			'Target commitment'
		);
		require(
			targetCoverageCommitmentAttoEthAfter == 0 ||
				targetVaultRepBackingAfterAttoRep >= SecurityPoolUtils.MIN_REP_DEPOSIT_ATTO_REP,
			'Target REP'
		);
		require(
			securityVaults[callerVault].coverageCommitmentAttoEth >= SecurityPoolUtils.MIN_COVERAGE_COMMITMENT_ATTO_ETH,
			'Caller commitment'
		);
		require(
			pool.backingUnitsToAttoRep(securityVaults[callerVault].repBackingUnits) >=
				SecurityPoolUtils.MIN_REP_DEPOSIT_ATTO_REP,
			'Caller REP'
		);
	}
}
