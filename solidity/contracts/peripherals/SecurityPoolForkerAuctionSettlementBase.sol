// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolForkerBase } from './SecurityPoolForkerBase.sol';
import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

abstract contract SecurityPoolForkerAuctionSettlementBase is SecurityPoolForkerBase {
	event ClaimAuctionProceeds(
		ISecurityPool indexed securityPool,
		address indexed vault,
		uint256 amountAttoRep,
		uint256 repBackingUnits,
		uint256 totalRepBackingUnits,
		uint256 claimedAuctionRepPurchasedAttoRep,
		uint256 claimedAuctionedCoverageCommitmentAttoEth
	);

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function _creditAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		SecurityPoolForkerForkData storage data,
		uint256 amountAttoRep,
		uint256 newCoverageCommitmentAttoEth,
		uint256 totalAttoRepPurchased
	) internal {
		if (amountAttoRep == 0 && newCoverageCommitmentAttoEth == 0) return;
		uint256 auctionRepBackingUnitsPerAttoRep = data.auctionRepBackingUnitsPerAttoRep;
		if (amountAttoRep > 0) require(auctionRepBackingUnitsPerAttoRep > 0, 'Rate');
		uint256 auctionRepBackingUnits = amountAttoRep * auctionRepBackingUnitsPerAttoRep;
		uint256 nextClaimedAuctionRepBackingUnits = data.claimedAuctionRepBackingUnits + auctionRepBackingUnits;
		require(
			nextClaimedAuctionRepBackingUnits <= totalAttoRepPurchased * auctionRepBackingUnitsPerAttoRep,
			'REP'
		);
		uint256 nextClaimedAuctionedCoverageCommitmentAttoEth =
			data.claimedAuctionedCoverageCommitmentAttoEth + newCoverageCommitmentAttoEth;
		require(nextClaimedAuctionedCoverageCommitmentAttoEth <= data.auctionedCoverageCommitmentAttoEth, 'Commitment');
		data.claimedAuctionRepPurchasedAttoRep += amountAttoRep;
		data.claimedAuctionedCoverageCommitmentAttoEth = nextClaimedAuctionedCoverageCommitmentAttoEth;
		data.claimedAuctionRepBackingUnits = nextClaimedAuctionRepBackingUnits;
		securityPool.updateVaultFees(vault);
		(
			uint256 currentVaultRepBackingUnits,
			uint256 currentCoverageCommitmentAttoEth,
			,
			uint256 currentFeeIndex
		) = securityPool.securityVaults(vault);
		securityPool.configureVault(
			vault,
			currentVaultRepBackingUnits + auctionRepBackingUnits,
			currentCoverageCommitmentAttoEth + newCoverageCommitmentAttoEth,
			currentFeeIndex
		);
		securityPool.addFeeEligibleCoverageCommitmentAttoEth(vault, newCoverageCommitmentAttoEth);
		emit ClaimAuctionProceeds(
			securityPool,
			vault,
			amountAttoRep,
			auctionRepBackingUnits,
			securityPool.totalRepBackingUnits(),
			data.claimedAuctionRepPurchasedAttoRep,
			data.claimedAuctionedCoverageCommitmentAttoEth
		);
	}
}
