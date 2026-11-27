// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CapitalLedgerHarness, CapitalLedgerTestComponents } from './CapitalLedgerHarness.sol';
import { SecurityPoolCapitalLedger } from '../../statoblast/SecurityPoolCapitalLedger.sol';
import { ISecurityPoolRepairAuctionCapital } from '../../statoblast/interfaces/ISecurityPoolRepairAuctionCapital.sol';

/// @dev Controlled adapter isolates the capital boundary. The actual auction's
/// tree, fills and exact fee distribution have separate engine tests.
contract CapitalRepairAuctionAdapterMock is ISecurityPoolRepairAuctionCapital {
	SecurityPoolCapitalLedger public immutable capital;
	mapping(uint256 => BidPosition) private bids;
	mapping(address => uint256[]) private bidderIds;
	mapping(uint256 => bool) public removed;
	uint256 public remainingLots;
	uint256 public ethFees;
	uint256 public repFees;

	constructor(SecurityPoolCapitalLedger ledger) {
		capital = ledger;
	}
	function setBid(uint256 id, address bidder, uint256 lots) external {
		require(bids[id].bidder == address(0) && bidder != address(0), 'Duplicate test bid');
		bids[id] = BidPosition(bidder, lots);
		bidderIds[bidder].push(id);
		remainingLots += lots;
		capital.registerRepairAuctionBidder(bidder);
	}
	function bidPosition(uint256 id) external view returns (BidPosition memory) {
		return bids[id];
	}
	function bidderBidCount(address bidder) external view returns (uint256) {
		return bidderIds[bidder].length;
	}
	function bidderBidId(address bidder, uint256 index) external view returns (uint256) {
		return bidderIds[bidder][index];
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

contract CapitalRepairAuctionHarness is CapitalLedgerHarness {
	address public repairAuction;
	constructor(CapitalLedgerTestComponents components) CapitalLedgerHarness(components) {}
	function _coordinator() internal view override returns (address) {
		return address(this);
	}
	/// @dev Plays the fork coordinator's registry so the adapter may record bidders.
	function repairAuctions(uint248) external view returns (address) {
		return repairAuction;
	}
	function setRepairAuction(address adapter) external {
		repairAuction = adapter;
	}
	function installRepairAuction(address adapter, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot) external {
		ledger.installRepairAuctionCohort(adapter, lots, repPerLot, commitmentPerLot);
	}
	function creditFees() external payable {
		collateralToken.deposit{value: msg.value}();
		assignedCapitalCash += msg.value;
		ledger.creditDeferredTimedFees(msg.value);
	}
}

/// @dev Controlled fresh quote isolates lot selection from report funding economics.
contract RepairAuctionLotSizingHarness is CapitalLedgerHarness {
	uint256 public minimumCommitmentAttoEth = 1;
	uint256 public conservativePrice = 1e18;
	uint256 public lastSettlementTimestamp;
	uint256 public priceValidUntil;
	uint256 public constant acceptedExposureLimitAttoEth = type(uint256).max;
	constructor(CapitalLedgerTestComponents components) CapitalLedgerHarness(components) {
		lastSettlementTimestamp = block.timestamp;
		priceValidUntil = block.timestamp + 7 days;
	}
	function capitalLedger(uint248) external view returns (SecurityPoolCapitalLedger) {
		return ledger;
	}
	function oracleExposure(uint248) external pure returns (uint256) {
		return 0;
	}
	function setMinimum(uint256 minimum) external {
		minimumCommitmentAttoEth = minimum;
	}
}
