// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState, LiquidationExecutionRequest } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultBadDebtRecorded(address indexed targetVault, uint256 badDebtAttoEth, uint256 resultingVaultBadDebtAttoEth, uint256 resultingTotalBadDebtAttoEth);
	event VaultDepositTargetHealthFactorRecorded(address indexed vault, uint256 depositTargetHealthFactorBps, uint256 capacityOwnershipAttoRep, uint256 resultingTotalCapacityOwnershipAttoRep);

	function setValidatedSettlementCollateral(uint256 nextSettlementCollateralAttoEth) external payable {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(pool.getCurrentMintingCapacityAttoEth() >= nextSettlementCollateralAttoEth, 'Over capacity');
		settlementCollateralAttoEth = nextSettlementCollateralAttoEth;
		uint256 activeOpenInterestAttoEth =
			nextSettlementCollateralAttoEth > totalBadDebtAttoEth
				? nextSettlementCollateralAttoEth - totalBadDebtAttoEth
				: 0;
		uint256 disputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.totalDisputeStakedAttoRep();
		require(SecurityPoolUtils.isVaultHealthy(pool.getTotalPoolHeldAttoRep(), disputeStakedAttoRep, activeOpenInterestAttoEth, pool.priceOracleManagerAndOperatorQueuer().lastPrice(), statoblastSecurityMultiplierBps), 'Pool backing insufficient');
	}

	function setVaultCapacity(address vault, uint256 nextCapacityOwnershipAttoRep, uint256 depositTargetHealthFactorBps) external {
		uint256 previousCapacityOwnershipAttoRep = securityVaults[vault].capacityOwnershipAttoRep;
		// Reducing the denominator would reallocate live settlement collateral to every remaining vault.
		if (nextCapacityOwnershipAttoRep < previousCapacityOwnershipAttoRep)
			require(settlementCollateralAttoEth == 0, 'Capacity committed');
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
		if (depositTargetHealthFactorBps != 0) {
			lastDepositTargetHealthFactorBpsByVault[vault] = depositTargetHealthFactorBps;
			emit VaultDepositTargetHealthFactorRecorded(vault, depositTargetHealthFactorBps, nextCapacityOwnershipAttoRep, totalCapacityOwnershipAttoRep);
		}
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
		uint256 receiverBadDebtAttoEth = _getVaultBadDebtAttoEth(request.receiverVault);
		uint256 receiverOpenInterestAfterAttoEth =
			receiverGrossOpenInterestAfterAttoEth > receiverBadDebtAttoEth
				? receiverGrossOpenInterestAfterAttoEth - receiverBadDebtAttoEth
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
				uint256 resultingVaultBadDebtAttoEth = _getVaultBadDebtAttoEth(request.targetVault) + badDebtAttoEth;
				_setVaultBadDebtAttoEth(request.targetVault, resultingVaultBadDebtAttoEth);
				emit VaultBadDebtRecorded(request.targetVault, badDebtAttoEth, resultingVaultBadDebtAttoEth, totalBadDebtAttoEth);
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
