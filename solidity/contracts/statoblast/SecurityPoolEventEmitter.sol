// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { AccountingReason, ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForkerEvents } from './interfaces/ISecurityPoolForker.sol';
import { SecurityPoolForkerStorage } from './SecurityPoolForkerStorage.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolPortfolioAccountingDelegate } from './SecurityPoolPortfolioAccountingDelegate.sol';

/// @notice Fixed delegate for native fee accounting, portfolio credits and verbose checkpoint encoding.
contract SecurityPoolEventEmitter is SecurityPoolPortfolioAccountingDelegate {
	event PoolAccountingCheckpoint(AccountingReason reason, address indexed vault, uint256 settlementCollateralAttoEth, uint256 totalUnderwritingLimitAttoEth, uint256 feeEligibleUnderwritingLimitAttoEth, uint256 totalClaimableVaultFeesAttoEth, uint256 unallocatedAccruedFeesAttoEth, uint256 feeIndex, uint256 feeIndexRemainder, uint256 totalFeesOwedRemainder, uint256 uncheckpointedFeeEligibleUnderwritingLimitAttoEth, uint256 lastUpdatedFeeAccumulator, uint256 currentRetentionRate);
	event VaultAccountingCheckpoint(address indexed vault, uint256 repBackingUnits, uint256 underwritingLimitAttoEth, uint256 claimableFeesAttoEth, uint256 feeIndex, uint256 vaultFeeRemainder, uint256 resultingTotalRepBackingUnits, uint256 resultingFeeEligibleUnderwritingLimitAttoEth);

	function setStartingParams(uint256 initialRetentionRate, uint256 initialCollateral) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(msg.sender == address(pool.securityPoolFactory()), 'Only factory');
		lastUpdatedFeeAccumulator = block.timestamp;
		feeEpochEndTime = pool.questionData().getQuestionEndDate(pool.questionId());
		currentRetentionRate = initialRetentionRate;
		settlementCollateralAttoEth = initialCollateral;
		ISecurityPool parent = pool.parent();
		uint256 price = address(parent) == address(0) ? 0 : parent.openOraclePriceCoordinator().lastPrice();
		pool.openOraclePriceCoordinator().setRepEthPrice(price);
		_emitCheckpoint(AccountingReason.PoolInitialization, address(0));
	}

	function assignFinalizedAuctionFees(address vault, uint256 amountAttoRep, uint256 auctionFeeIndexAtFinalization) external {
		require(auctionFeeIndexAtFinalization <= feeIndex, 'Fee index');
		(uint256 fees, uint256 nextRemainder) = SecurityPoolUtils.calculateVaultFee(amountAttoRep, feeIndex - auctionFeeIndexAtFinalization, vaultFeeRemainders[vault]);
		vaultFeeRemainders[vault] = nextRemainder;
		unallocatedAccruedFeesAttoEth -= fees;
		totalClaimableVaultFeesAttoEth += fees;
		securityVaults[vault].claimableFeesAttoEth += fees;
		if (auctionFeeIndexAtFinalization != feeIndex)
			uncheckpointedFeeEligibleUnderwritingLimitAttoEth -= amountAttoRep;
		_emitVaultCheckpoint(vault);
		_emitCheckpoint(AccountingReason.AuctionClaim, vault);
	}

	function emitPoolAccountingCheckpoint(AccountingReason reason, address vault) external payable {
		_emitCheckpoint(reason, vault);
	}

	function _emitAccountingCheckpoint(AccountingReason reason) internal override {
		_emitCheckpoint(reason, address(0));
	}

	function _emitCheckpoint(AccountingReason reason, address vault) private {
		// Every capacity/collateral checkpoint also reconciles the shared report security budget.
		ISecurityPool(payable(address(this))).openOraclePriceCoordinator().syncExposure();
		_notifyPortfolioAccounting();
		emit PoolAccountingCheckpoint(reason, vault, settlementCollateralAttoEth, totalUnderwritingLimitAttoEth, feeEligibleUnderwritingLimitAttoEth, totalClaimableVaultFeesAttoEth, unallocatedAccruedFeesAttoEth, feeIndex, feeIndexRemainder, totalFeesOwedRemainder, uncheckpointedFeeEligibleUnderwritingLimitAttoEth, lastUpdatedFeeAccumulator, currentRetentionRate);
	}

	/// @notice Settle one vault's earned fees in the native pool storage context.
	function redeemFees(address vault) external {
		ISecurityPool(payable(address(this))).updateVaultFees(vault);
		uint256 fees = securityVaults[vault].claimableFeesAttoEth;
		if (fees == 0) return;
		securityVaults[vault].claimableFeesAttoEth = 0;
		totalClaimableVaultFeesAttoEth -= fees;
		if (vault != address(0) && !isKnownVault[vault]) {
			isKnownVault[vault] = true;
			vaultAddresses.push(vault);
		}
		_emitVaultCheckpoint(vault);
		_emitCheckpoint(AccountingReason.FeeRedemption, vault);
		(bool sent, ) = payable(vault).call{value: fees}('');
		require(sent, 'ETH failed');
	}

	function emitVaultAccountingCheckpoint(address vault) external payable {
		_emitVaultCheckpoint(vault);
	}

	function _emitVaultCheckpoint(address vault) private {
		_notifyPortfolioAccounting();
		emit VaultAccountingCheckpoint(vault, securityVaults[vault].repBackingUnits, securityVaults[vault].underwritingLimitAttoEth, securityVaults[vault].claimableFeesAttoEth, securityVaults[vault].feeIndex, vaultFeeRemainders[vault], totalRepBackingUnits, feeEligibleUnderwritingLimitAttoEth);
	}
}

/// @notice Delegate-called fork event encoder sharing the forker's typed storage base.
contract SecurityPoolForkEventEmitter is SecurityPoolForkerStorage, ISecurityPoolForkerEvents {
	function emitForkSnapshotEvents(ISecurityPool parent, address migrationProxy, address sourceGame, uint256 totalPoolHeldRepAtForkAttoRep, uint256 disputeStakedRepAtForkAttoRep, uint256 resultingLockedAttoRep) external payable {
		SecurityPoolForkerForkData storage data = forkDataByPool[parent];
		if (data.unresolvedEscalationAtFork) {
			emit DisputeStakedRepDrainedAtFork(parent, sourceGame, disputeStakedRepAtForkAttoRep);
		}
		emit ParentRepLocked(parent, migrationProxy, totalPoolHeldRepAtForkAttoRep, disputeStakedRepAtForkAttoRep, resultingLockedAttoRep);
		emit SecurityPoolForkSnapshot(parent, migrationProxy, data.ownFork, data.unresolvedEscalationAtFork, data.settlementCollateralAtForkAttoEth, totalPoolHeldRepAtForkAttoRep, data.auctionableAttoRepAtFork, data.escalationSourceRepAtForkAttoRep, data.escalationChildRepAtForkAttoRep, data.escalationStartBondAtForkAttoRep, data.escalationNonDecisionThresholdAtForkAttoRep, data.escalationElapsedAtFork, data.escalationSnapshotId);
	}
}
