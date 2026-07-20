// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { SecurityPoolForker } from '../../peripherals/SecurityPoolForker.sol';
import { ISecurityPool } from '../../peripherals/interfaces/ISecurityPool.sol';
import { SecurityPoolForkerForkData } from '../../peripherals/SecurityPoolForkerTypes.sol';

contract AuctionSettlementPoolHarness {
	struct Vault {
		uint256 poolOwnership;
		uint256 securityBondAllowance;
		uint256 fees;
		uint256 feeIndex;
	}

	mapping(address vault => Vault) public securityVaults;
	uint256 public poolOwnershipDenominator = 1e18;
	uint256 public feeEligibleSecurityBondAllowance;

	function updateVaultFees(address) external {}

	function configureVault(
		address vault,
		uint256 poolOwnership,
		uint256 securityBondAllowance,
		uint256 feeIndex
	) external {
		Vault storage current = securityVaults[vault];
		current.poolOwnership = poolOwnership;
		current.securityBondAllowance = securityBondAllowance;
		current.feeIndex = feeIndex;
	}

	function addFeeEligibleSecurityBondAllowance(address, uint256 amount) external {
		feeEligibleSecurityBondAllowance += amount;
	}
}

contract SecurityPoolForkerAuctionSettlementHarness is SecurityPoolForker {
	constructor(Zoltar zoltar) SecurityPoolForker(zoltar) {}

	function creditAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		uint256 amount,
		uint256 newSecurityBondAllowance,
		uint256 auctionPoolOwnershipPerRep,
		uint256 totalRepPurchased,
		uint256 auctionedSecurityBondAllowance
	) external {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		data.auctionPoolOwnershipPerRep = auctionPoolOwnershipPerRep;
		data.auctionedSecurityBondAllowance = auctionedSecurityBondAllowance;
		_creditAuctionProceeds(securityPool, vault, data, amount, newSecurityBondAllowance, totalRepPurchased);
	}
}
