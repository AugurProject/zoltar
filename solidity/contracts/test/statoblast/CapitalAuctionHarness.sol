// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CapitalLedgerHarness, CapitalLedgerTestComponents } from './CapitalLedgerHarness.sol';
import { SecurityPoolCapitalLedger } from '../../statoblast/SecurityPoolCapitalLedger.sol';
import { ISecurityPoolAuctionCapital } from '../../statoblast/interfaces/ISecurityPoolAuctionCapital.sol';

/// @dev Controlled adapter isolates the capital boundary. The actual auction's
/// tree, fills and exact fee distribution have separate engine tests.
contract CapitalAuctionAdapterMock is ISecurityPoolAuctionCapital {
	SecurityPoolCapitalLedger public immutable capital;
	mapping(uint256 => BidPosition) private bids;
	mapping(address => uint256) public bidIdForVault;
	mapping(uint256 => bool) public removed;
	uint256 public remainingLots;
	uint256 public ethFees;
	uint256 public repFees;

	constructor(SecurityPoolCapitalLedger ledger) {
		capital = ledger;
	}
	function setBid(uint256 id, address vault, uint256 health, uint256 lots) external {
		require(bids[id].vault == address(0) && bidIdForVault[vault] == 0, 'Duplicate test bid');
		bids[id] = BidPosition(vault, health, lots);
		bidIdForVault[vault] = id;
		remainingLots += lots;
	}
	function bidPosition(uint256 id) external view returns (BidPosition memory) {
		return bids[id];
	}
	function previewBidFees(uint256 id, uint256 ethAmount, uint256 repAmount) external view returns (uint256 ownedEth, uint256 ownedRep) {
		if (removed[id] || bids[id].filledLots == 0) return (0, 0);
		return (
			((ethFees + ethAmount) * bids[id].filledLots) / remainingLots,
			((repFees + repAmount) * bids[id].filledLots) / remainingLots
		);
	}
	function claimAndRemoveFees(uint256 id, uint256 ethAmount, uint256 repAmount) external returns (uint256 ownedEth, uint256 ownedRep) {
		require(msg.sender == address(capital) && !removed[id], 'Test bid unavailable');
		ethFees += ethAmount;
		repFees += repAmount;
		uint256 lots = bids[id].filledLots;
		ownedEth = (ethFees * lots) / remainingLots;
		ownedRep = (repFees * lots) / remainingLots;
		ethFees -= ownedEth;
		repFees -= ownedRep;
		remainingLots -= lots;
		removed[id] = true;
	}
}

contract CapitalAuctionHarness is CapitalLedgerHarness {
	constructor(CapitalLedgerTestComponents components) CapitalLedgerHarness(components) {}
	function installAuction(address adapter, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot) external {
		ledger.installAuctionCohort(adapter, lots, repPerLot, commitmentPerLot);
	}
	function creditFees() external payable {
		ledger.creditTimedFees{value: msg.value}();
	}
}
