// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { CoverageObligationMath } from './CoverageObligationMath.sol';
import { SecurityPoolCoverageDelegate, ICoveragePoolContext } from './SecurityPoolCoverageDelegate.sol';
import { SecurityPoolEventEmitter } from './SecurityPoolEventEmitter.sol';
import { DelegateCallForwarder } from './DelegateCallForwarder.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, CoverageAllocation } from './interfaces/ISecurityPool.sol';

abstract contract SecurityPoolSettlementDelegate is SecurityPoolCoverageDelegate {
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	event CoverageAllocated(address indexed vault, uint256 addedUnits, uint256 resultingVaultUnits, uint256 resultingTotalUnits, uint256 epoch);

	function createCompleteSet(CoverageAllocation[] calldata allocations) external payable returns (uint256 completeSetsToMintAttoShares) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(!awaitingForkContinuation, 'Fork await');
		// Retain the escalation mint closure until the replacement lifecycle is validated.
		require(address(escalationGame) == address(0), 'Escalation mint closed');
		if (msg.value == 0 || pool.isEscalationResolved()) revert('Settlement unavailable');
		require(pool.priceOracleManagerAndOperatorQueuer().isPriceValid(), 'Stale price');
		require(allocations.length > 0 && allocations.length <= 64, 'Allocation count');
		pool.updateSettlementCollateral();
		completeSetsToMintAttoShares = pool.attoEthToAttoShares(msg.value);
		require(completeSetsToMintAttoShares > 0, 'Exchange rate undefined');
		uint256 newUnits = CoverageObligationMath.mintUnits(settlementCollateralAttoEth, totalObligationUnits, msg.value);
		uint256 nextTotalUnits = totalObligationUnits + newUnits;
		uint256 nextCollateral = settlementCollateralAttoEth + msg.value;
		uint256 cumulativeCollateral;
		uint256 assignedUnits;
		address previousVault;
		for (uint256 i; i < allocations.length; i++) {
			CoverageAllocation calldata allocation = allocations[i];
			require(allocation.vault > previousVault, 'Vaults must be sorted and unique');
			require(allocation.collateralAttoEth > 0, 'Zero allocation');
			previousVault = allocation.vault;
			cumulativeCollateral += allocation.collateralAttoEth;
			require(cumulativeCollateral <= msg.value, 'Allocation exceeds collateral');
			uint256 cumulativeUnits = Math.mulDiv(newUnits, cumulativeCollateral, msg.value);
			uint256 units = cumulativeUnits - assignedUnits;
			require(units > 0, 'Zero obligation units');
			assignedUnits = cumulativeUnits;
			_assignCoverage(pool, allocation.vault, units, nextCollateral, nextTotalUnits);
		}
		require(cumulativeCollateral == msg.value && assignedUnits == newUnits, 'Allocation total mismatch');
		totalObligationUnits = nextTotalUnits;
		activeObligationUnits += newUnits;
		feeIndexRemainder = 0;
		shareTokenSupplyAttoShares += completeSetsToMintAttoShares;
		settlementCollateralAttoEth = nextCollateral;
		emit CompleteSetCreated(msg.sender, msg.value, completeSetsToMintAttoShares, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
	}

	function _assignCoverage(ISecurityPool pool, address vault, uint256 units, uint256 nextCollateral, uint256 nextTotalUnits) private {
		pool.updateVaultFees(vault);
		CoverageOffer storage offer = coverageOffers[vault];
		require(offer.enabled, 'Coverage offer disabled');
		uint256 resultingUnits = getVaultObligationUnits(vault) + units;
		uint256 resultingObligation = CoverageObligationMath.obligation(nextCollateral, resultingUnits, nextTotalUnits);
		require(resultingObligation <= offer.maximumObligationAttoEth, 'Coverage offer limit');
		uint256 disputeStake =
			address(escalationGame) == address(0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(vault);
		require(SecurityPoolUtils.isVaultHealthyAtFactor(pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits), disputeStake, resultingObligation, pool.priceOracleManagerAndOperatorQueuer().lastPrice(), statoblastSecurityMultiplierBps, offer.minimumHealthFactorBps), 'Vault backing insufficient');
		coveragePositions[vault] = CoveragePosition(resultingUnits, badDebtGeneration);
		emit CoverageAllocated(vault, units, resultingUnits, nextTotalUnits, badDebtGeneration);
		DelegateCallForwarder.invoke(address(ICoveragePoolContext(address(this)).eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
	}

	function setFundedSettlementCollateral(uint256 inheritedCollateralAttoEth) external {
		// Inherited share liabilities need funded ETH, even when current REP
		// solvency prevents new minting. Activation opens redemption and recovery.
		uint256 feeLiabilitiesAttoEth = totalClaimableVaultFeesAttoEth + unallocatedAccruedFeesAttoEth;
		require(feeLiabilitiesAttoEth <= address(this).balance && inheritedCollateralAttoEth <= address(this).balance - feeLiabilitiesAttoEth, 'Collateral unfunded');
		settlementCollateralAttoEth = inheritedCollateralAttoEth;
	}
}
