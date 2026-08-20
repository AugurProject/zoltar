// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

abstract contract SecurityPoolForkerAuctionSettlementBase is SecurityPoolForkerBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function _creditAuctionProceeds(ISecurityPool securityPool, address vault, SecurityPoolForkerForkData storage data, uint256 amountAttoRep, uint256 newCapacityOwnershipAttoRep, uint256 badDebtToAssignAttoEth, uint256 totalAttoRepPurchased) internal {
		if (amountAttoRep == 0 && newCapacityOwnershipAttoRep == 0) return;
		uint256 auctionRepBackingUnitsPerAttoRep = data.auctionRepBackingUnitsPerAttoRep;
		if (amountAttoRep > 0) require(auctionRepBackingUnitsPerAttoRep > 0, 'Rate');
		uint256 auctionRepBackingUnits = Math.mulDiv(amountAttoRep, auctionRepBackingUnitsPerAttoRep, 1);
		uint256 nextClaimedAuctionRepBackingUnits = data.claimedAuctionRepBackingUnits + auctionRepBackingUnits;
		require(nextClaimedAuctionRepBackingUnits <= Math.mulDiv(totalAttoRepPurchased, auctionRepBackingUnitsPerAttoRep, 1), 'REP');
		uint256 nextClaimedAuctionedCapacityOwnershipAttoRep =
			data.claimedAuctionedCapacityOwnershipAttoRep + newCapacityOwnershipAttoRep;
		require(nextClaimedAuctionedCapacityOwnershipAttoRep <= data.auctionedCapacityOwnershipAttoRep, 'Commitment');
		data.claimedAuctionRepPurchasedAttoRep += amountAttoRep;
		data.claimedAuctionedCapacityOwnershipAttoRep = nextClaimedAuctionedCapacityOwnershipAttoRep;
		data.claimedAuctionRepBackingUnits = nextClaimedAuctionRepBackingUnits;
		uint256 nextClaimedAuctionedBadDebtAttoEth =
			claimedAuctionedBadDebtByPool[securityPool] + badDebtToAssignAttoEth;
		require(nextClaimedAuctionedBadDebtAttoEth <= auctionedBadDebtByPool[securityPool], 'Bad debt');
		claimedAuctionedBadDebtByPool[securityPool] = nextClaimedAuctionedBadDebtAttoEth;
		uint256 resultingTotalRepBackingUnits = SecurityPoolUtils.creditForkAuctionVault(securityPool, vault, auctionRepBackingUnits, newCapacityOwnershipAttoRep, badDebtToAssignAttoEth, data.auctionFeeIndexAtFinalization);
		emit ClaimAuctionProceeds(securityPool, vault, amountAttoRep, auctionRepBackingUnits, resultingTotalRepBackingUnits, data.claimedAuctionRepPurchasedAttoRep, data.claimedAuctionedCapacityOwnershipAttoRep, claimedAuctionedBadDebtByPool[securityPool], auctionedBadDebtByPool[securityPool]);
	}
}
