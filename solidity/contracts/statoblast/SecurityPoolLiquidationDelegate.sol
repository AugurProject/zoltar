// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { CoverageObligationMath } from './CoverageObligationMath.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, LiquidationExecutionRequest } from './interfaces/ISecurityPool.sol';

abstract contract SecurityPoolLiquidationDelegate is SecurityPoolStorage {
	event VaultBadDebtRecorded(address indexed targetVault, uint256 badDebtAttoEth, uint256 resultingVaultBadDebtAttoEth, uint256 resultingTotalBadDebtAttoEth);

	function performBundledLiquidation(LiquidationExecutionRequest calldata request) external returns (uint256 debtToMoveAttoEth, uint256 obligationUnitsToMove, uint256 badDebtAttoEth) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(request.receiverVault != request.targetVault, 'Receiver bad');
		require(securityVaults[request.targetVault].repBackingUnits == request.snapshotTargetBackingUnits, 'Target backingUnits changed');
		require(getVaultObligationUnits(request.targetVault) == request.snapshotTargetObligationUnits, 'Target commitment changed');
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
		(nominalDebtToMoveAttoEth, obligationUnitsToMove, , maximumBackingUnitsToTransfer) = SecurityPoolUtils.calculateBundledLiquidationTransfer(securityVaults[request.targetVault].repBackingUnits, request.snapshotTargetObligationUnits, targetOpenInterestAttoEth, request.requestedDebtAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits, minimumRemainingAttoRep);
		uint256 receiverOpenInterestAfterAttoEth = CoverageObligationMath.obligation(settlementCollateralAttoEth, getVaultObligationUnits(request.receiverVault) + obligationUnitsToMove, totalObligationUnits);
		require(receiverOpenInterestAfterAttoEth >= receiverOpenInterestBeforeAttoEth, 'Receiver debt decreased');
		debtToMoveAttoEth = receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth;
		require(debtToMoveAttoEth <= nominalDebtToMoveAttoEth && debtToMoveAttoEth <= request.requestedDebtAttoEth, 'Debt exceeds request');
		if (nominalDebtToMoveAttoEth != 0 && debtToMoveAttoEth == 0) revert('Receiver debt below minimum');
		uint256 backingUnitsToTransfer = SecurityPoolUtils.calculateLiquidationBackingUnitsAward(debtToMoveAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits);
		require(backingUnitsToTransfer <= maximumBackingUnitsToTransfer, 'Award exceeds funded quote');
		uint256 remainingTargetUnits = getVaultObligationUnits(request.targetVault) - obligationUnitsToMove;
		if (request.requestedDebtAttoEth >= targetOpenInterestAttoEth && remainingTargetUnits != 0) {
			badDebtAttoEth = CoverageObligationMath.obligation(settlementCollateralAttoEth, remainingTargetUnits, totalObligationUnits);
			writtenOffObligationUnits += remainingTargetUnits;
			activeObligationUnits -= remainingTargetUnits;
			totalBadDebtAttoEth += badDebtAttoEth;
			_setVaultBadDebtAttoEth(request.targetVault, _getVaultBadDebtAttoEth(request.targetVault) + badDebtAttoEth);
			remainingTargetUnits = 0;
			emit VaultBadDebtRecorded(request.targetVault, badDebtAttoEth, _getVaultBadDebtAttoEth(request.targetVault), totalBadDebtAttoEth);
		}
		require(debtToMoveAttoEth > 0 || badDebtAttoEth > 0, 'No liq');
		feeIndexRemainder = 0;
		coveragePositions[request.targetVault].units = remainingTargetUnits;
		securityVaults[request.targetVault].repBackingUnits -= backingUnitsToTransfer;
		if (debtToMoveAttoEth == 0) return (debtToMoveAttoEth, obligationUnitsToMove, badDebtAttoEth);
		coveragePositions[request.receiverVault].units += obligationUnitsToMove;
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
