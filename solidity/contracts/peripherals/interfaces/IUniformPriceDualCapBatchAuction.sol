// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface IUniformPriceDualCapBatchAuctionEvents {
	enum BidSettlementStatus {
		Winning,
		PartiallyFilled,
		Losing,
		PreFinalizationRefund
	}

	/// @notice Lifecycle anchor. Timestamps use Unix seconds; ETH values use wei and REP uses token base units.
	event AuctionStarted(
		uint256 startTimestamp,
		uint256 endTimestamp,
		uint256 ethRaiseCap,
		uint256 maxRepBeingSold,
		uint256 minBidSize
	);
	/// @notice Stable per-tick bid identity and the resulting FIFO cumulative ETH position. ETH values use wei.
	event BidSubmitted(
		address indexed bidder,
		int256 indexed tick,
		uint256 indexed bidIndex,
		uint256 ethAmount,
		uint256 cumulativeEthAtTick
	);
	/// @notice Final aggregate clearing state; ETH fields use wei, REP uses token base units,
	/// `grossEthAccepted` is the accepted ETH transferred to the owner, and `funded` distinguishes
	/// cap-clearing from underfunded mode.
	event AuctionFinalized(
		int256 indexed clearingTick,
		uint256 grossEthAccepted,
		uint256 repSold,
		uint256 ethFilledAtClearingTick,
		bool funded
	);
	/// @notice One bid's complete settlement or pre-finalization refund. ETH fields use wei, REP uses token base
	/// units, and `ethUsed + ethRefund` equals `originalEthAmount`.
	event BidSettled(
		address indexed bidder,
		int256 indexed tick,
		uint256 indexed bidIndex,
		uint256 originalEthAmount,
		uint256 ethUsed,
		uint256 repFilled,
		uint256 ethRefund,
		BidSettlementStatus status
	);
}

interface IUniformPriceDualCapBatchAuction is IUniformPriceDualCapBatchAuctionEvents {
	struct Bid {
		address bidder;
		uint256 ethAmount;
		uint256 cumulativeEth;
	}

	struct TickSummary {
		int256 tick;
		uint256 price;
		uint256 currentTotalEth;
		uint256 submissionCount;
		bool active;
	}

	struct BidView {
		int256 tick;
		uint256 bidIndex;
		address bidder;
		uint256 ethAmount;
		uint256 cumulativeEth;
		uint256 activeCumulativeEthBeforeBid;
		bool claimed;
		bool refunded;
	}

	struct TickIndex {
		int256 tick;
		uint256 bidIndex;
	}

	function owner() external view returns (address);

	function maxRepBeingSold() external view returns (uint256);
	function ethRaiseCap() external view returns (uint256);

	function finalized() external view returns (bool);
	function clearingTick() external view returns (int256);
	function ethFilledAtClearing() external view returns (uint256);
	function ethRaised() external view returns (uint256);
	function totalRepPurchased() external view returns (uint256);

	function auctionStarted() external view returns (uint256);
	function minBidSize() external view returns (uint256);

	function startAuction(uint256 ethRaiseCap, uint256 maxRepBeingSold) external;

	function submitBid(int256 tick) external payable;

	function finalize() external;
	function previewFinalization() external view returns (uint256 ethToSend, uint256 repPurchased);

	function computeClearing()
		external
		view
		returns (bool hitCap, int256 clearingTickOut, uint256 accumulatedEth, uint256 ethAtClearingTick);

	function withdrawBids(
		address withdrawFor,
		TickIndex[] calldata tickIndices,
		uint256 proRataTotal
	) external returns (uint256 totalFilledRep, uint256 totalEthRefund, uint256 totalProRataAllocation);

	function refundLosingBids(TickIndex[] calldata tickIndices) external;

	function refundLosingBidsFor(address bidder, TickIndex[] calldata tickIndices) external;

	function tickToPrice(int256 tick) external pure returns (uint256 price);
	function activeTickCount() external view returns (uint256);
	function getTickSummary(int256 tick) external view returns (TickSummary memory);
	function getTickCount() external view returns (uint256);
	function getTickPage(uint256 offset, uint256 limit) external view returns (TickSummary[] memory);
	function getActiveTickPage(uint256 offset, uint256 limit) external view returns (TickSummary[] memory);
	function getBidCountAtTick(int256 tick) external view returns (uint256);
	function getBidPageAtTick(int256 tick, uint256 offset, uint256 limit) external view returns (BidView[] memory);
	function getBidderBidCount(address bidder) external view returns (uint256);
	function getBidderBidPage(address bidder, uint256 offset, uint256 limit) external view returns (BidView[] memory);
}
