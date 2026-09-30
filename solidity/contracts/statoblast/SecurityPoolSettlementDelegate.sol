// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';

abstract contract SecurityPoolSettlementDelegate is SecurityPoolStorage {
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	function createCompleteSet() external payable returns (uint256 completeSetsToMintAttoShares) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(!awaitingForkContinuation, 'Fork await');
		require(address(escalationGame) == address(0), 'Escalation mint closed');
		if (msg.value == 0 || pool.isEscalationResolved()) revert('Settlement unavailable');
		pool.updateSettlementCollateral();
		completeSetsToMintAttoShares = pool.attoEthToAttoShares(msg.value);
		require(completeSetsToMintAttoShares > 0, 'Exchange rate undefined');
		// Vaults already answer for their full standing commitments, so minting
		// within them adds no REP exposure and needs no oracle price.
		uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth + msg.value;
		require(nextSettlementCollateralAttoEth <= totalUnderwritingLimitAttoEth, 'Over capacity');
		shareTokenSupplyAttoShares += completeSetsToMintAttoShares;
		settlementCollateralAttoEth = nextSettlementCollateralAttoEth;
		emit CompleteSetCreated(msg.sender, msg.value, completeSetsToMintAttoShares, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
	}

	function setFundedSettlementCollateral(uint256 inheritedCollateralAttoEth) external {
		// Inherited share liabilities need funded ETH, even when they exceed the
		// child's standing commitments. Activation opens redemption and recovery.
		uint256 feeLiabilitiesAttoEth = totalClaimableVaultFeesAttoEth + unallocatedAccruedFeesAttoEth;
		require(feeLiabilitiesAttoEth <= address(this).balance && inheritedCollateralAttoEth <= address(this).balance - feeLiabilitiesAttoEth, 'Collateral unfunded');
		settlementCollateralAttoEth = inheritedCollateralAttoEth;
	}
}
