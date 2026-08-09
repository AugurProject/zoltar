// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultBadDebtRecorded(
		address indexed targetVault,
		uint256 badDebtAttoEth,
		uint256 resultingVaultBadDebtAttoEth,
		uint256 resultingTotalBadDebtAttoEth
	);
	event VaultTargetHealthFactorSet(
		address indexed vault,
		uint256 targetHealthFactorBps,
		uint256 capacityOwnershipAttoRep,
		uint256 resultingTotalCapacityOwnershipAttoRep
	);

	function setVaultCapacity(
		address vault,
		uint256 nextCapacityOwnershipAttoRep,
		uint256 targetHealthFactorBps
	) external {
		uint256 previousCapacityOwnershipAttoRep = securityVaults[vault].capacityOwnershipAttoRep;
		feeIndexRemainder = 0;
		totalCapacityOwnershipAttoRep =
			totalCapacityOwnershipAttoRep -
			previousCapacityOwnershipAttoRep +
			nextCapacityOwnershipAttoRep;
		feeEligibleCapacityOwnershipAttoRep =
			feeEligibleCapacityOwnershipAttoRep -
			previousCapacityOwnershipAttoRep +
			nextCapacityOwnershipAttoRep;
		securityVaults[vault].capacityOwnershipAttoRep = nextCapacityOwnershipAttoRep;
		if (targetHealthFactorBps != 0) vaultTargetHealthFactorBps[vault] = targetHealthFactorBps;
		emit VaultTargetHealthFactorSet(
			vault,
			vaultTargetHealthFactorBps[vault],
			nextCapacityOwnershipAttoRep,
			totalCapacityOwnershipAttoRep
		);
	}

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
		address receiverVault,
		address targetVault,
		uint256 requestedDebtAttoEth,
		uint256 snapshotTargetBackingUnits,
		uint256 snapshotTargetCapacityOwnershipAttoRep,
		uint256 repEthPrice,
		uint256 minimumReceiverHealthFactorBps,
		uint256 minLiquidationPriceDistanceBps
	) external returns (uint256 debtToMoveAttoEth, uint256 capacityOwnershipToMoveAttoRep, uint256 badDebtAttoEth) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(receiverVault != targetVault, 'Receiver bad');
		require(
			securityVaults[targetVault].repBackingUnits == snapshotTargetBackingUnits,
			'Target backingUnits changed'
		);
		require(
			securityVaults[targetVault].capacityOwnershipAttoRep == snapshotTargetCapacityOwnershipAttoRep,
			'Target commitment changed'
		);
		uint256 targetVaultRepBackingAttoRep = pool.backingUnitsToAttoRep(snapshotTargetBackingUnits);
		uint256 targetDisputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(targetVault);
		uint256 targetOpenInterestAttoEth = pool.getVaultOpenInterestAttoEth(targetVault);
		uint256 receiverOpenInterestBeforeAttoEth = pool.getVaultOpenInterestAttoEth(receiverVault);
		require(
			SecurityPoolUtils._isLiquidationBeyondMinPriceDistance(
				targetVaultRepBackingAttoRep,
				targetDisputeStakedAttoRep,
				targetOpenInterestAttoEth,
				statoblastSecurityMultiplierBps,
				repEthPrice,
				minLiquidationPriceDistanceBps
			),
			'Liquidation distance too low'
		);
		require(
			!SecurityPoolUtils.isVaultHealthy(
				targetVaultRepBackingAttoRep,
				targetDisputeStakedAttoRep,
				targetOpenInterestAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Target safe'
		);
		uint256 nominalDebtToMoveAttoEth;
		uint256 maximumBackingUnitsToTransfer;
		uint256 minimumRemainingAttoRep =
			requestedDebtAttoEth >= targetOpenInterestAttoEth ? 0 : minimumVaultRepDepositAttoRep;
		(nominalDebtToMoveAttoEth, capacityOwnershipToMoveAttoRep, , maximumBackingUnitsToTransfer) = SecurityPoolUtils
			.calculateBundledLiquidationTransfer(
				securityVaults[targetVault].repBackingUnits,
				snapshotTargetCapacityOwnershipAttoRep,
				targetOpenInterestAttoEth,
				requestedDebtAttoEth,
				repEthPrice,
				pool.getTotalPoolHeldAttoRep(),
				totalRepBackingUnits,
				minimumRemainingAttoRep
			);
		uint256 receiverGrossOpenInterestAfterAttoEth = SecurityPoolUtils.calculateVaultOpenInterestAttoEth(
			settlementCollateralAttoEth,
			securityVaults[receiverVault].capacityOwnershipAttoRep + capacityOwnershipToMoveAttoRep,
			totalCapacityOwnershipAttoRep
		);
		uint256 receiverOpenInterestAfterAttoEth =
			receiverGrossOpenInterestAfterAttoEth > vaultBadDebtAttoEth[receiverVault]
				? receiverGrossOpenInterestAfterAttoEth - vaultBadDebtAttoEth[receiverVault]
				: 0;
		require(receiverOpenInterestAfterAttoEth >= receiverOpenInterestBeforeAttoEth, 'Receiver debt decreased');
		debtToMoveAttoEth = receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth;
		require(
			debtToMoveAttoEth <= nominalDebtToMoveAttoEth && debtToMoveAttoEth <= requestedDebtAttoEth,
			'Debt exceeds request'
		);
		if (nominalDebtToMoveAttoEth != 0 && debtToMoveAttoEth == 0) revert('Receiver debt below minimum');
		uint256 backingUnitsToTransfer = SecurityPoolUtils.calculateLiquidationBackingUnitsAward(
			debtToMoveAttoEth,
			repEthPrice,
			pool.getTotalPoolHeldAttoRep(),
			totalRepBackingUnits
		);
		require(backingUnitsToTransfer <= maximumBackingUnitsToTransfer, 'Award exceeds funded quote');
		if (requestedDebtAttoEth >= targetOpenInterestAttoEth) {
			badDebtAttoEth = targetOpenInterestAttoEth - debtToMoveAttoEth;
			if (badDebtAttoEth != 0) {
				totalBadDebtAttoEth += badDebtAttoEth;
				vaultBadDebtAttoEth[targetVault] += badDebtAttoEth;
				emit VaultBadDebtRecorded(
					targetVault,
					badDebtAttoEth,
					vaultBadDebtAttoEth[targetVault],
					totalBadDebtAttoEth
				);
			}
		}
		require(debtToMoveAttoEth > 0 || badDebtAttoEth > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[targetVault].capacityOwnershipAttoRep =
			snapshotTargetCapacityOwnershipAttoRep - capacityOwnershipToMoveAttoRep;
		securityVaults[targetVault].repBackingUnits -= backingUnitsToTransfer;
		if (debtToMoveAttoEth == 0) return (debtToMoveAttoEth, capacityOwnershipToMoveAttoRep, badDebtAttoEth);
		securityVaults[receiverVault].capacityOwnershipAttoRep += capacityOwnershipToMoveAttoRep;
		securityVaults[receiverVault].repBackingUnits += backingUnitsToTransfer;
		uint256 receiverOpenInterestAttoEth = pool.getVaultOpenInterestAttoEth(receiverVault);
		require(
			receiverOpenInterestAttoEth - receiverOpenInterestBeforeAttoEth == debtToMoveAttoEth,
			'Debt settlement mismatch'
		);
		if (receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth) revert('Receiver debt below minimum');
		uint256 receiverDisputeStakedAttoRep;
		if (address(escalationGame) != address(0x0)) {
			try escalationGame.disputeStakedRepByVaultAttoRep(receiverVault) returns (uint256 claimRep) {
				receiverDisputeStakedAttoRep = claimRep;
			} catch {
				revert('Claim balance failed');
			}
		}
		require(
			SecurityPoolUtils.isVaultHealthyAtFactor(
				pool.backingUnitsToAttoRep(securityVaults[receiverVault].repBackingUnits),
				receiverDisputeStakedAttoRep,
				receiverOpenInterestAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps,
				minimumReceiverHealthFactorBps
			),
			'Receiver bad'
		);
		uint256 targetOpenInterestAttoEthAfter = pool.getVaultOpenInterestAttoEth(targetVault);
		uint256 targetVaultRepBackingAfterAttoRep = pool.backingUnitsToAttoRep(
			securityVaults[targetVault].repBackingUnits
		);
		require(
			targetOpenInterestAttoEthAfter == 0 || targetOpenInterestAttoEthAfter >= minimumSecurityBondDebtAttoEth,
			'Target debt'
		);
		require(
			targetOpenInterestAttoEthAfter == 0 || targetVaultRepBackingAfterAttoRep >= minimumVaultRepDepositAttoRep,
			'Target REP'
		);
		require(
			pool.backingUnitsToAttoRep(securityVaults[receiverVault].repBackingUnits) >= minimumVaultRepDepositAttoRep,
			'Receiver REP'
		);
	}
}
