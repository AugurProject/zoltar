// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { SecurityPoolForkerAuctionSettlementBase } from '../../peripherals/SecurityPoolForkerAuctionSettlementBase.sol';
import { ISecurityPool } from '../../peripherals/interfaces/ISecurityPool.sol';
import { SecurityPoolForkerForkData } from '../../peripherals/SecurityPoolForkerTypes.sol';

contract AuctionSettlementPoolHarness {
	struct Vault {
		uint256 repBackingUnits;
		uint256 coverageCommitmentAttoEth;
		uint256 fees;
		uint256 feeIndex;
	}

	mapping(address vault => Vault) public securityVaults;
	uint256 public totalRepBackingUnits = 1e18;
	uint256 public feeEligibleCoverageCommitmentAttoEth;

	function updateVaultFees(address) external {}

	function configureVault(
		address vault,
		uint256 repBackingUnits,
		uint256 coverageCommitmentAttoEth,
		uint256 feeIndex
	) external {
		Vault storage current = securityVaults[vault];
		current.repBackingUnits = repBackingUnits;
		current.coverageCommitmentAttoEth = coverageCommitmentAttoEth;
		current.feeIndex = feeIndex;
	}

	function addFeeEligibleCoverageCommitmentAttoEth(address, uint256 amount) external {
		feeEligibleCoverageCommitmentAttoEth += amount;
	}
}

contract SecurityPoolForkerAuctionSettlementHarness is SecurityPoolForkerAuctionSettlementBase {
	constructor(Zoltar zoltar) SecurityPoolForkerAuctionSettlementBase(zoltar) {}

	function creditAuctionProceeds(
		ISecurityPool securityPool,
		address vault,
		uint256 amount,
		uint256 newCoverageCommitmentAttoEth
	) external {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		data.auctionRepBackingUnitsPerAttoRep = 10;
		data.auctionedCoverageCommitmentAttoEth = 3;
		_creditAuctionProceeds(securityPool, vault, data, amount, newCoverageCommitmentAttoEth, 1);
	}
}
