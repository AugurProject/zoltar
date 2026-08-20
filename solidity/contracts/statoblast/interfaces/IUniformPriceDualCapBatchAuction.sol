// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface IUniformPriceDualCapBatchAuctionEvents {
	enum BidSettlementStatus {
		Winning,
		PartiallyFilled,
		Losing,
		PreFinalizationRefund
	}

	/// @notice Lifecycle anchor. Timestamps use Unix seconds; ETH values use attoETH and REP values use attoREP.
	event AuctionStarted(uint256 startTimestamp, uint256 endTimestamp, uint256 attoEthRaiseCap, uint256 maxAttoRepBeingSold, uint256 minBidSizeAttoEth);
	/// @notice Stable per-tick bid identity and the resulting FIFO cumulative ETH position. ETH values use attoETH.
	event BidSubmitted(address indexed bidder, int256 indexed tick, uint256 indexed bidIndex, uint256 bidAmountAttoEth, uint256 cumulativeBidAtTickAttoEth);
	/// @notice Final aggregate clearing state; ETH fields use attoETH and REP fields use attoREP,
	/// `grossAcceptedAttoEth` is the accepted ETH transferred to the owner, and `funded` distinguishes
	/// cap-clearing from underfunded mode.
	event AuctionFinalized(int256 indexed clearingTick, uint256 grossAcceptedAttoEth, uint256 attoRepSold, uint256 bidAtClearingTickAttoEth, bool funded);
	/// @notice One bid's complete settlement or pre-finalization refund. ETH fields use attoETH, REP fields use
	/// attoREP, and `bidUsedAttoEth + refundAttoEth` equals `originalBidAmountAttoEth`.
	event BidSettled(address indexed bidder, int256 indexed tick, uint256 indexed bidIndex, uint256 originalBidAmountAttoEth, uint256 bidUsedAttoEth, uint256 attoRepFilled, uint256 refundAttoEth, BidSettlementStatus status);
	/// @notice A bounded-gas push refund that fails remains escrowed for later pull withdrawal.
	event EthRefundDeferred(address indexed bidder, uint256 amountAttoEth, uint256 pendingAmountAttoEth);
	/// @notice A bidder's complete deferred ETH refund balance was cleared before its successful pull callback.
	event PendingEthRefundWithdrawn(address indexed bidder, uint256 amountAttoEth);
}

interface IUniformPriceDualCapBatchAuction is IUniformPriceDualCapBatchAuctionEvents {
	struct Bid {
		address bidder;
		uint256 bidAmountAttoEth;
		uint256 cumulativeBidAttoEth;
	}

	struct TickSummary {
		int256 tick;
		uint256 price;
		uint256 currentTotalBidAttoEth;
		uint256 submissionCount;
		bool active;
	}

	struct BidView {
		int256 tick;
		uint256 bidIndex;
		address bidder;
		uint256 bidAmountAttoEth;
		uint256 cumulativeBidAttoEth;
		uint256 activeCumulativeBidBeforeAttoEth;
		bool claimed;
		bool refunded;
	}

	struct TickIndex {
		int256 tick;
		uint256 bidIndex;
	}

	function owner() external view returns (address);

	function maxAttoRepBeingSold() external view returns (uint256);
	function attoEthRaiseCap() external view returns (uint256);
	function pendingEthRefundsAttoEth(address bidder) external view returns (uint256);

	function finalized() external view returns (bool);
	function clearingTick() external view returns (int256);
	function ethFilledAtClearingAttoEth() external view returns (uint256);
	function attoEthRaised() external view returns (uint256);
	function totalAttoRepPurchased() external view returns (uint256);

	function auctionStarted() external view returns (uint256);
	function minBidSizeAttoEth() external view returns (uint256);

	function startAuction(uint256 attoEthRaiseCap, uint256 maxAttoRepBeingSold) external;

	function submitBid(int256 tick) external payable;

	function finalize() external;
	function previewFinalization() external view returns (uint256 raisedAttoEthToSend, uint256 repPurchasedAttoRep);

	function computeClearing()
		external
		view
		returns (bool hitCap, int256 clearingTickOut, uint256 accumulatedBidAttoEth, uint256 bidAtClearingTickAttoEth);

	function withdrawBids(address withdrawFor, TickIndex[] calldata tickIndices, uint256 proRataTotal, uint256 secondaryProRataTotal)
		external
		returns (
			uint256 totalFilledAttoRep,
			uint256 totalRefundAttoEth,
			uint256 totalProRataAllocation,
			uint256 totalSecondaryProRataAllocation
		);

	function refundLosingBids(TickIndex[] calldata tickIndices) external;

	function refundLosingBidsFor(address bidder, TickIndex[] calldata tickIndices) external;
	function withdrawPendingEthRefund() external;

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
