// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

interface IUniformPriceDualCapBatchAuction {
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

	event AuctionStarted(uint256 ethRaiseCap, uint256 maxRepBeingSold, uint256 minBidSize);
	event SubmitBid(address bidder, int256 tick, uint256 amount);
	event Finalized(uint256 ethToSend, bool hitCap, int256 foundTick, uint256 repFilled, uint256 ethFilled);
	event WithdrawBids(address withdrawFor, TickIndex[] tickIndices, uint256 totalFilledRep, uint256 totalEthRefund);
	event RefundLosingBids(address bidder, TickIndex[] tickIndices, uint256 ethAmount);

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

	function computeClearing()
		external
		view
		returns (
			bool hitCap,
			int256 clearingTickOut,
			uint256 accumulatedEth,
			uint256 ethAtClearingTick
		);

	function withdrawBids(address withdrawFor, TickIndex[] calldata tickIndices)
		external
		returns (uint256 totalFilledRep, uint256 totalEthRefund);

	function refundLosingBids(TickIndex[] calldata tickIndices) external;

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
