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
		uint256 amount,
		uint256 poolOwnershipAmount,
		uint256 poolOwnershipDenominator,
		uint256 claimedAuctionRepPurchased,
		uint256 claimedAuctionedSecurityBondAllowance
	);

	constructor(Zoltar _zoltar) SecurityPoolForkerBase(_zoltar) {}

	function _creditAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		SecurityPoolForkerForkData storage data,
		uint256 amount,
		uint256 newSecurityBondAllowance,
		uint256 totalRepPurchased
	) internal {
		if (amount == 0 && newSecurityBondAllowance == 0) return;
		uint256 auctionPoolOwnershipPerRep = data.auctionPoolOwnershipPerRep;
		if (amount > 0) require(auctionPoolOwnershipPerRep > 0, 'Rate');
		uint256 poolOwnershipAmount = amount * auctionPoolOwnershipPerRep;
		uint256 nextClaimedAuctionPoolOwnership = data.claimedAuctionPoolOwnership + poolOwnershipAmount;
		require(nextClaimedAuctionPoolOwnership <= totalRepPurchased * auctionPoolOwnershipPerRep, 'REP');
		uint256 nextClaimedAuctionedSecurityBondAllowance =
			data.claimedAuctionedSecurityBondAllowance + newSecurityBondAllowance;
		require(nextClaimedAuctionedSecurityBondAllowance <= data.auctionedSecurityBondAllowance, 'Allowance');
		data.claimedAuctionRepPurchased += amount;
		data.claimedAuctionedSecurityBondAllowance = nextClaimedAuctionedSecurityBondAllowance;
		data.claimedAuctionPoolOwnership = nextClaimedAuctionPoolOwnership;
		securityPool.updateVaultFees(vault);
		(uint256 poolOwnership, uint256 currentSecurityBondAllowance, , uint256 currentFeeIndex) = securityPool
			.securityVaults(vault);
		securityPool.configureVault(
			vault,
			poolOwnership + poolOwnershipAmount,
			currentSecurityBondAllowance + newSecurityBondAllowance,
			currentFeeIndex
		);
		securityPool.addFeeEligibleSecurityBondAllowance(vault, newSecurityBondAllowance);
		emit ClaimAuctionProceeds(
			securityPool,
			vault,
			amount,
			poolOwnershipAmount,
			securityPool.poolOwnershipDenominator(),
			data.claimedAuctionRepPurchased,
			data.claimedAuctionedSecurityBondAllowance
		);
	}
}
