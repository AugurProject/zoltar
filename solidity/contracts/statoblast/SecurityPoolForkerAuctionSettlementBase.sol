// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';

abstract contract SecurityPoolForkerAuctionSettlementBase is SecurityPoolForkerBase {
	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function _creditAuctionProceeds(ISecurityPool securityPool, address vault, SecurityPoolForkerForkData storage data, uint256 amountAttoRep, uint256 newCapacityOwnershipAttoRep, uint256 badDebtToAssignAttoEth, uint256 totalAttoRepPurchased, uint256 auctionRepBackingUnits) internal {
		if (
			amountAttoRep == 0 &&
			newCapacityOwnershipAttoRep == 0 &&
			badDebtToAssignAttoEth == 0 &&
			auctionRepBackingUnits == 0
		) return;
		// The auction assigns this fixed budget by cumulative bid position, never claim order.
		uint256 nextClaimedAuctionRepPurchasedAttoRep = data.claimedAuctionRepPurchasedAttoRep + amountAttoRep;
		require(nextClaimedAuctionRepPurchasedAttoRep <= totalAttoRepPurchased, 'REP');
		uint256 nextClaimedAuctionRepBackingUnits = data.claimedAuctionRepBackingUnits + auctionRepBackingUnits;
		require(nextClaimedAuctionRepBackingUnits <= data.auctionRepBackingUnits, 'Backing units');
		uint256 nextClaimedAuctionObligationUnits = data.claimedAuctionObligationUnits + newCapacityOwnershipAttoRep;
		require(nextClaimedAuctionObligationUnits <= data.auctionObligationUnits, 'Commitment');
		data.claimedAuctionRepPurchasedAttoRep = nextClaimedAuctionRepPurchasedAttoRep;
		data.claimedAuctionObligationUnits = nextClaimedAuctionObligationUnits;
		data.claimedAuctionRepBackingUnits = nextClaimedAuctionRepBackingUnits;
		uint256 nextClaimedAuctionedBadDebtAttoEth =
			claimedAuctionedBadDebtByPool[securityPool] + badDebtToAssignAttoEth;
		require(nextClaimedAuctionedBadDebtAttoEth <= auctionedBadDebtByPool[securityPool], 'Bad debt');
		claimedAuctionedBadDebtByPool[securityPool] = nextClaimedAuctionedBadDebtAttoEth;
		uint256 resultingTotalRepBackingUnits = SecurityPoolUtils.creditForkAuctionVault(securityPool, vault, auctionRepBackingUnits, newCapacityOwnershipAttoRep, badDebtToAssignAttoEth, data.auctionBadDebtGeneration, data.auctionFeeIndexAtFinalization);
		emit ClaimAuctionProceeds(securityPool, vault, amountAttoRep, auctionRepBackingUnits, resultingTotalRepBackingUnits, data.claimedAuctionRepPurchasedAttoRep, data.claimedAuctionObligationUnits, claimedAuctionedBadDebtByPool[securityPool], auctionedBadDebtByPool[securityPool]);
	}
}
