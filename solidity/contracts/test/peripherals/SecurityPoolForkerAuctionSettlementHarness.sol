// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { SecurityPoolForkerAuctionSettlementBase } from '../../peripherals/SecurityPoolForkerAuctionSettlementBase.sol';
import { ISecurityPool } from '../../peripherals/interfaces/ISecurityPool.sol';
import { SecurityPoolForkerForkData } from '../../peripherals/SecurityPoolForkerTypes.sol';
import { SecurityPoolUtils } from '../../peripherals/SecurityPoolUtils.sol';

contract AuctionSettlementPoolHarness {
	struct Vault {
		uint256 repBackingUnits;
		uint256 capacityOwnershipAttoRep;
		uint256 fees;
		uint256 feeIndex;
	}

	mapping(address vault => Vault) public securityVaults;
	mapping(address vault => uint256 targetHealthFactorBps) public vaultTargetHealthFactorBps;
	mapping(address vault => uint256 badDebtAttoEth) public vaultBadDebtAttoEth;
	uint256 public totalRepBackingUnits = 1e18;
	uint256 public feeEligibleCapacityOwnershipAttoRep;
	uint256 public totalBadDebtAttoEth;

	function setTotalBadDebtAttoEth(uint256 amountAttoEth) external {
		totalBadDebtAttoEth = amountAttoEth;
	}

	function updateVaultFees(address) external {}

	function configureVault(address vault, uint256 repBackingUnits, uint256 capacityOwnershipAttoRep, uint256 feeIndex, uint256, uint256 newVaultBadDebtAttoEth, uint256 newTotalBadDebtAttoEth) external {
		Vault storage current = securityVaults[vault];
		current.repBackingUnits = repBackingUnits;
		current.capacityOwnershipAttoRep = capacityOwnershipAttoRep;
		current.feeIndex = feeIndex;
		vaultBadDebtAttoEth[vault] = newVaultBadDebtAttoEth;
		totalBadDebtAttoEth = newTotalBadDebtAttoEth;
	}

	function addFeeEligibleCapacityOwnershipAttoRep(address, uint256 amount) external {
		feeEligibleCapacityOwnershipAttoRep += amount;
	}
}

contract SecurityPoolForkerAuctionSettlementHarness is SecurityPoolForkerAuctionSettlementBase {
	constructor(Zoltar zoltar) SecurityPoolForkerAuctionSettlementBase(zoltar) {}

	function _assignAuctionBadDebt(ISecurityPool securityPool, uint256 nextClaimedCapacityOwnershipAttoRep, uint256 auctionedCapacityOwnershipAttoRep) internal override returns (uint256 badDebtToAssignAttoEth) {
		uint256 nextClaimedBadDebtAttoEth;
		(badDebtToAssignAttoEth, nextClaimedBadDebtAttoEth) = SecurityPoolUtils.calculateCumulativeAuctionBadDebt(auctionedBadDebtByPool[securityPool], nextClaimedCapacityOwnershipAttoRep, auctionedCapacityOwnershipAttoRep, claimedAuctionedBadDebtByPool[securityPool]);
		claimedAuctionedBadDebtByPool[securityPool] = nextClaimedBadDebtAttoEth;
	}

	function configureAuctionBadDebt(ISecurityPool securityPool, uint256 badDebtAttoEth) external {
		auctionedBadDebtByPool[securityPool] = badDebtAttoEth;
	}

	function creditAuctionProceeds(ISecurityPool securityPool, address vault, uint256 amount, uint256 newCapacityOwnershipAttoRep) external {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		data.auctionRepBackingUnitsPerAttoRep = 10;
		data.auctionedCapacityOwnershipAttoRep = 3;
		_creditAuctionProceeds(securityPool, vault, data, amount, newCapacityOwnershipAttoRep, 1);
	}
}
