// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';

abstract contract SecurityPoolSettlementDelegate is SecurityPoolStorage {
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	function createCompleteSet() external payable returns (uint256 completeSetsToMintAttoShares) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(!awaitingForkContinuation, 'Fork await');
		if (msg.value == 0 || pool.isEscalationResolved()) revert();
		require(pool.priceOracleManagerAndOperatorQueuer().isPriceValid(), 'Stale price');
		pool.updateSettlementCollateral();
		completeSetsToMintAttoShares = pool.attoEthToAttoShares(msg.value);
		require(completeSetsToMintAttoShares > 0, 'Exchange rate undefined');
		uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth + msg.value;
		_validateSettlementCollateral(pool, nextSettlementCollateralAttoEth);
		SecurityPoolUtils.requireUnassignedPositionHealthy(pool, pool.securityPoolForker(), nextSettlementCollateralAttoEth);
		shareTokenSupplyAttoShares += completeSetsToMintAttoShares;
		settlementCollateralAttoEth = nextSettlementCollateralAttoEth;
		emit CompleteSetCreated(msg.sender, msg.value, completeSetsToMintAttoShares, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
	}

	function setValidatedSettlementCollateral(uint256 nextSettlementCollateralAttoEth) external payable {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		_validateSettlementCollateral(pool, nextSettlementCollateralAttoEth);
		settlementCollateralAttoEth = nextSettlementCollateralAttoEth;
	}

	function _validateSettlementCollateral(ISecurityPool pool, uint256 nextSettlementCollateralAttoEth) private view {
		uint256 repEthPrice = pool.priceOracleManagerAndOperatorQueuer().lastPrice();
		require(SecurityPoolUtils.calculateMintingCapacityAttoEth(totalCapacityOwnershipAttoRep, repEthPrice, statoblastSecurityMultiplierBps) >= nextSettlementCollateralAttoEth, 'Over capacity');
		uint256 activeOpenInterestAttoEth =
			nextSettlementCollateralAttoEth > totalBadDebtAttoEth
				? nextSettlementCollateralAttoEth - totalBadDebtAttoEth
				: 0;
		uint256 disputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.totalDisputeStakedAttoRep();
		require(SecurityPoolUtils.isVaultHealthy(pool.getTotalPoolHeldAttoRep(), disputeStakedAttoRep, activeOpenInterestAttoEth, repEthPrice, statoblastSecurityMultiplierBps), 'Pool backing insufficient');
	}
}
