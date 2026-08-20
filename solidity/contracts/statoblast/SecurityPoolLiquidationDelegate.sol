// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState, LiquidationExecutionRequest } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultBadDebtRecorded(address indexed targetVault, uint256 badDebtAttoEth, uint256 resultingVaultBadDebtAttoEth, uint256 resultingTotalBadDebtAttoEth);
	event VaultTargetHealthFactorSet(address indexed vault, uint256 targetHealthFactorBps, uint256 capacityOwnershipAttoRep, uint256 resultingTotalCapacityOwnershipAttoRep);

	function setVaultCapacity(address vault, uint256 nextCapacityOwnershipAttoRep, uint256 targetHealthFactorBps) external {
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
		emit VaultTargetHealthFactorSet(vault, vaultTargetHealthFactorBps[vault], nextCapacityOwnershipAttoRep, totalCapacityOwnershipAttoRep);
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

	function performBundledLiquidation(LiquidationExecutionRequest calldata request) external returns (uint256 debtToMoveAttoEth, uint256 capacityOwnershipToMoveAttoRep, uint256 badDebtAttoEth) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(request.receiverVault != request.targetVault, 'Receiver bad');
		require(securityVaults[request.targetVault].repBackingUnits == request.snapshotTargetBackingUnits, 'Target backingUnits changed');
		require(securityVaults[request.targetVault].capacityOwnershipAttoRep == request.snapshotTargetCapacityOwnershipAttoRep, 'Target commitment changed');
		uint256 targetVaultRepBackingAttoRep = pool.backingUnitsToAttoRep(request.snapshotTargetBackingUnits);
		uint256 targetDisputeStakedAttoRep =
			address(escalationGame) == address(0x0)
				? 0
				: escalationGame.disputeStakedRepByVaultAttoRep(request.targetVault);
		uint256 targetOpenInterestAttoEth = pool.getVaultOpenInterestAttoEth(request.targetVault);
		uint256 receiverOpenInterestBeforeAttoEth = pool.getVaultOpenInterestAttoEth(request.receiverVault);
		require(SecurityPoolUtils._isLiquidationBeyondMinPriceDistance(targetVaultRepBackingAttoRep, targetDisputeStakedAttoRep, targetOpenInterestAttoEth, statoblastSecurityMultiplierBps, request.repEthPrice, request.minLiquidationPriceDistanceBps), 'Liquidation distance too low');
		require(!SecurityPoolUtils.isVaultHealthy(targetVaultRepBackingAttoRep, targetDisputeStakedAttoRep, targetOpenInterestAttoEth, request.repEthPrice, statoblastSecurityMultiplierBps), 'Target safe');
		uint256 nominalDebtToMoveAttoEth;
		uint256 maximumBackingUnitsToTransfer;
		uint256 minimumRemainingAttoRep =
			request.requestedDebtAttoEth >= targetOpenInterestAttoEth ? 0 : minimumVaultRepDepositAttoRep;
		(nominalDebtToMoveAttoEth, capacityOwnershipToMoveAttoRep, , maximumBackingUnitsToTransfer) = SecurityPoolUtils.calculateBundledLiquidationTransfer(securityVaults[request.targetVault].repBackingUnits, request.snapshotTargetCapacityOwnershipAttoRep, targetOpenInterestAttoEth, request.requestedDebtAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits, minimumRemainingAttoRep);
		uint256 receiverGrossOpenInterestAfterAttoEth = SecurityPoolUtils.calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, securityVaults[request.receiverVault].capacityOwnershipAttoRep + capacityOwnershipToMoveAttoRep, totalCapacityOwnershipAttoRep);
		uint256 receiverOpenInterestAfterAttoEth =
			receiverGrossOpenInterestAfterAttoEth > vaultBadDebtAttoEth[request.receiverVault]
				? receiverGrossOpenInterestAfterAttoEth - vaultBadDebtAttoEth[request.receiverVault]
				: 0;
		require(receiverOpenInterestAfterAttoEth >= receiverOpenInterestBeforeAttoEth, 'Receiver debt decreased');
		debtToMoveAttoEth = receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth;
		require(debtToMoveAttoEth <= nominalDebtToMoveAttoEth && debtToMoveAttoEth <= request.requestedDebtAttoEth, 'Debt exceeds request');
		if (nominalDebtToMoveAttoEth != 0 && debtToMoveAttoEth == 0) revert('Receiver debt below minimum');
		uint256 backingUnitsToTransfer = SecurityPoolUtils.calculateLiquidationBackingUnitsAward(debtToMoveAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits);
		require(backingUnitsToTransfer <= maximumBackingUnitsToTransfer, 'Award exceeds funded quote');
		if (request.requestedDebtAttoEth >= targetOpenInterestAttoEth) {
			badDebtAttoEth = targetOpenInterestAttoEth - debtToMoveAttoEth;
			if (badDebtAttoEth != 0) {
				totalBadDebtAttoEth += badDebtAttoEth;
				vaultBadDebtAttoEth[request.targetVault] += badDebtAttoEth;
				emit VaultBadDebtRecorded(request.targetVault, badDebtAttoEth, vaultBadDebtAttoEth[request.targetVault], totalBadDebtAttoEth);
			}
		}
		require(debtToMoveAttoEth > 0 || badDebtAttoEth > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[request.targetVault].capacityOwnershipAttoRep =
			request.snapshotTargetCapacityOwnershipAttoRep - capacityOwnershipToMoveAttoRep;
		securityVaults[request.targetVault].repBackingUnits -= backingUnitsToTransfer;
		if (debtToMoveAttoEth == 0) return (debtToMoveAttoEth, capacityOwnershipToMoveAttoRep, badDebtAttoEth);
		securityVaults[request.receiverVault].capacityOwnershipAttoRep += capacityOwnershipToMoveAttoRep;
		securityVaults[request.receiverVault].repBackingUnits += backingUnitsToTransfer;
		uint256 receiverOpenInterestAttoEth = pool.getVaultOpenInterestAttoEth(request.receiverVault);
		require(receiverOpenInterestAttoEth - receiverOpenInterestBeforeAttoEth == debtToMoveAttoEth, 'Debt settlement mismatch');
		if (receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth) revert('Receiver debt below minimum');
		uint256 receiverDisputeStakedAttoRep;
		if (address(escalationGame) != address(0x0)) {
			try escalationGame.disputeStakedRepByVaultAttoRep(request.receiverVault) returns (uint256 claimRep) {
				receiverDisputeStakedAttoRep = claimRep;
			} catch {
				revert('Claim balance failed');
			}
		}
		require(SecurityPoolUtils.isVaultHealthyAtFactor(pool.backingUnitsToAttoRep(securityVaults[request.receiverVault].repBackingUnits), receiverDisputeStakedAttoRep, receiverOpenInterestAttoEth, request.repEthPrice, statoblastSecurityMultiplierBps, request.minimumReceiverHealthFactorBps), 'Receiver bad');
		uint256 targetOpenInterestAttoEthAfter = pool.getVaultOpenInterestAttoEth(request.targetVault);
		uint256 targetVaultRepBackingAfterAttoRep = pool.backingUnitsToAttoRep(securityVaults[request.targetVault].repBackingUnits);
		require(targetOpenInterestAttoEthAfter == 0 || targetOpenInterestAttoEthAfter >= minimumSecurityBondDebtAttoEth, 'Target debt');
		require(targetOpenInterestAttoEthAfter == 0 || targetVaultRepBackingAfterAttoRep >= minimumVaultRepDepositAttoRep, 'Target REP');
		require(pool.backingUnitsToAttoRep(securityVaults[request.receiverVault].repBackingUnits) >= minimumVaultRepDepositAttoRep, 'Receiver REP');
	}
}
