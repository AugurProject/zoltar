// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	IUniformPriceDualCapBatchAuction,
	IUniformPriceDualCapBatchAuctionEvents
} from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { Constants } from '../Constants.sol';
import { UniformPriceDualCapBatchAuctionStorage } from './UniformPriceDualCapBatchAuctionStorage.sol';

// Gas bound: finalize() descends AVL aggregate paths and never scans bids. The
// tick range admits at most 1,048,577 distinct price levels, so an AVL tree over
// every possible tick has height <= 28. The auction intentionally does not add a
// bid or tick cap because valid price levels must remain open during bidding; see
// the synthetic max-depth gas tests.
contract UniformPriceDualCapBatchAuction is IUniformPriceDualCapBatchAuctionEvents {
	struct Bid {
		address bidder;
		bool claimed;
		uint128 bidAmountAttoEth;
		uint128 cumulativeBidAttoEth;
	}

	struct BidRef {
		int256 tick;
		uint256 bidIndex;
	}

	int256 constant MIN_TICK = -524288;
	int256 constant MAX_TICK = 524288;
	uint256 constant AUCTION_TIME = 1 weeks;
	uint256 constant PRICE_PRECISION = 1e18;
	uint256 constant MIN_BID_SIZE_DIVISOR = 100_000;
	// Push refunds are best effort. Bounding the callback prevents a recipient from
	// consuming settlement gas; contracts that need more gas can use the pull path.
	uint256 constant REFUND_PUSH_GAS_LIMIT = 30_000;

	mapping(uint256 => UniformPriceDualCapBatchAuctionStorage.Node) private nodes;
	mapping(int256 => Bid[]) private bidsAtTick;
	mapping(int256 => mapping(uint256 => uint256)) private refundedBidPrefixTree;

	uint256 private root;
	uint256 private nextId = 1;

	uint88 public maxAttoRepBeingSold;
	uint128 public attoEthRaiseCap;

	bool public finalized;
	int24 public clearingTick;
	uint128 public ethFilledAtClearingAttoEth;
	uint88 public totalAttoRepPurchased;
	uint256 public attoEthRaised;

	uint48 public auctionStarted;
	uint128 public minBidSizeAttoEth;
	address public immutable owner;

	bool public underfunded;
	uint256 public underfundedThreshold;
	uint256 public underfundedWinningAttoEth;
	uint256 public activeTickCount;

	int256[] private seenTicks;
	mapping(int256 => bool) private hasSeenTick;
	mapping(address => BidRef[]) private bidderBidRefs;
	mapping(address => uint256) public pendingEthRefundsAttoEth;

	constructor(address _owner) {
		// Child-pool truth auctions are intentionally owned by the SecurityPoolForker
		// contract. The forker starts/finalizes the auction and later withdraws bids on
		// behalf of vaults so the purchased REP can be credited back into REP backing units.
		owner = _owner;
	}

	modifier isOperational() {
		require(auctionStarted != 0, 'Auction must be started before accepting bids');
		require(!finalized, 'Auction has already been finalized');
		require(block.timestamp < auctionStarted + AUCTION_TIME, 'Auction bidding period has ended');
		_;
	}

	function startAuction(uint256 _attoEthRaiseCap, uint256 _maxAttoRepBeingSold) public {
		require(owner == msg.sender, 'Only the auction owner can start the auction');
		require(auctionStarted == 0, 'Auction has already been started');
		require(_attoEthRaiseCap > 0 && _maxAttoRepBeingSold > 0, 'Auction ETH raise cap and REP sale cap must both be positive');
		require(_attoEthRaiseCap <= type(uint128).max, 'Auction ETH raise cap too high');
		require(_maxAttoRepBeingSold <= Constants.MAX_ATTO_REP, 'Auction REP sale cap too high');

		maxAttoRepBeingSold = uint88(_maxAttoRepBeingSold);
		attoEthRaiseCap = uint128(_attoEthRaiseCap);
		underfundedThreshold = Math.mulDiv(_attoEthRaiseCap, PRICE_PRECISION, _maxAttoRepBeingSold, Math.Rounding.Ceil);
		require(block.timestamp <= type(uint48).max, 'Auction timestamp too high');
		auctionStarted = uint48(block.timestamp);
		minBidSizeAttoEth = uint128(_attoEthRaiseCap / MIN_BID_SIZE_DIVISOR);
		if (minBidSizeAttoEth < 1) minBidSizeAttoEth = 1;

		emit AuctionStarted(auctionStarted, auctionStarted + AUCTION_TIME, _attoEthRaiseCap, _maxAttoRepBeingSold, minBidSizeAttoEth);
	}

	function submitBid(int256 tick) external payable isOperational {
		require(msg.value >= minBidSizeAttoEth, 'Auction bid is smaller than the minimum bid size');
		require(msg.value <= type(uint128).max, 'Auction bid too high');
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'Auction tick is outside the supported price range');
		require(tickToPrice(tick) > 0, 'Auction tick price rounds down to zero');
		// Same-price rationing is intentionally time-priority, not pro-rata. Bids at
		// one tick append in submission order, and any marginal clearing-tick fill
		// consumes earlier same-tick ETH before later same-tick ETH.
		bool insertedNewTick;
		(root, nextId, insertedNewTick) = UniformPriceDualCapBatchAuctionStorage.insert(nodes, root, tick, msg.value, underfundedThreshold, nextId);
		if (insertedNewTick) activeTickCount += 1;
		uint256 bidIndex = _appendBid(tick, msg.sender, msg.value);
		emit BidSubmitted(msg.sender, tick, bidIndex, msg.value, bidsAtTick[tick][bidIndex].cumulativeBidAttoEth);
	}

	function finalize() external {
		require(!finalized, 'Auction has already been finalized');
		require(msg.sender == owner, 'Only the auction owner can finalize');
		require(auctionStarted != 0, 'Auction must be started before finalization');
		require(block.timestamp >= auctionStarted + AUCTION_TIME, 'Auction bidding period is still active');

		(
			bool hitCap,
			int256 foundTick,
			uint256 accumulatedBidAttoEth,
			uint256 bidAtClearingTickAttoEth
		) = computeClearing();
		(
			int256 finalClearingTick,
			uint256 finalUnderfundedWinningAttoEth,
			uint256 finalRepPurchasedAttoRep,
			uint256 raisedAttoEthToSend
		) = _computeFinalizationOutcome(hitCap, foundTick, accumulatedBidAttoEth);
		finalized = true;
		clearingTick = int24(finalClearingTick);
		ethFilledAtClearingAttoEth = uint128(bidAtClearingTickAttoEth);
		attoEthRaised = accumulatedBidAttoEth;
		underfunded = !hitCap;
		underfundedWinningAttoEth = finalUnderfundedWinningAttoEth;
		totalAttoRepPurchased = uint88(finalRepPurchasedAttoRep);

		emit AuctionFinalized(clearingTick, raisedAttoEthToSend, totalAttoRepPurchased, ethFilledAtClearingAttoEth, hitCap);
		(bool sent, ) = payable(owner).call{value: raisedAttoEthToSend}('');
		require(sent, 'Auction failed to send raised ETH to the owner');
	}

	function previewFinalization() external view returns (uint256 raisedAttoEthToSend, uint256 repPurchasedAttoRep) {
		(bool hitCap, int256 foundTick, uint256 accumulatedBidAttoEth, ) = computeClearing();
		(, , repPurchasedAttoRep, raisedAttoEthToSend) = _computeFinalizationOutcome(hitCap, foundTick, accumulatedBidAttoEth);
	}

	function _computeFinalizationOutcome(bool hitCap, int256 foundTick, uint256 accumulatedBidAttoEth)
		private
		view
		returns (
			int256 finalClearingTick,
			uint256 finalUnderfundedWinningAttoEth,
			uint256 finalRepPurchasedAttoRep,
			uint256 raisedAttoEthToSend
		)
	{
		if (hitCap) {
			uint256 fundedClearingPrice = tickToPrice(foundTick);
			finalRepPurchasedAttoRep =
				fundedClearingPrice > 0 ? (accumulatedBidAttoEth * PRICE_PRECISION) / fundedClearingPrice : 0;
			return (foundTick, 0, finalRepPurchasedAttoRep, accumulatedBidAttoEth);
		}

		// Underfunded bids qualify only at or above the reserve implied by both caps.
		// Qualifying bidders collectively buy the complete REP sale cap for the ETH
		// they submitted, so every winner receives the same effective ETH/REP price.
		// Bids below the reserve remain refundable.
		if (accumulatedBidAttoEth == 0 || maxAttoRepBeingSold == 0) return (0, 0, 0, 0);
		finalClearingTick = _priceToCeilingTick(underfundedThreshold);
		uint256 clearingPrice = tickToPrice(finalClearingTick);
		if (clearingPrice < underfundedThreshold) return (finalClearingTick, 0, 0, 0);

		finalUnderfundedWinningAttoEth =
			UniformPriceDualCapBatchAuctionStorage.getActiveBidAttoEthAboveTick(nodes, root, finalClearingTick) +
			UniformPriceDualCapBatchAuctionStorage.getBidAttoEthAtTick(nodes, root, finalClearingTick);
		if (finalUnderfundedWinningAttoEth == 0) return (finalClearingTick, 0, 0, 0);
		finalRepPurchasedAttoRep = maxAttoRepBeingSold;
		return (
			finalClearingTick,
			finalUnderfundedWinningAttoEth,
			finalRepPurchasedAttoRep,
			finalUnderfundedWinningAttoEth
		);
	}

	function computeClearing()
		public
		view
		returns (bool hitCap, int256 clearingTickOut, uint256 accumulatedBidAttoEth, uint256 bidAtClearingTickAttoEth)
	{
		return
			UniformPriceDualCapBatchAuctionStorage.computeClearing(nodes, root, UniformPriceDualCapBatchAuctionStorage.ClearingConfig({attoEthRaiseCap: attoEthRaiseCap, maxAttoRepBeingSold: maxAttoRepBeingSold, underfundedThreshold: underfundedThreshold}));
	}

	function withdrawBids(address withdrawFor, IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices, uint256 proRataTotal) external returns (uint256 totalFilledAttoRep, uint256 totalRefundAttoEth, uint256 totalProRataAllocation) {
		require(finalized, 'Auction must be finalized before withdrawing bids');
		// The owner is expected to be the coordinating forker contract for truth auctions,
		// not the bidder directly. That contract calls this and then accounts the returned
		// REP into the bidder's child-pool vault state.
		require(msg.sender == owner, 'Only the auction owner can withdraw bids on behalf of bidders');

		uint256 clearingPriceLocal = tickToPrice(clearingTick);

		for (uint256 i = 0; i < tickIndices.length; i++) {
			int256 tick = tickIndices[i].tick;
			uint256 index = tickIndices[i].bidIndex;

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == withdrawFor, 'Bid does not belong to the requested withdrawal address');
			require(bid.bidAmountAttoEth > 0 && !bid.claimed, 'Bid has already been claimed or does not exist');

			uint256 activeCumulativeBidBeforeAttoEth = _getActiveCumulativeBidBeforeAttoEth(tick, index, bid);
			uint256 cumulativeWinningBidBeforeAttoEth =
				UniformPriceDualCapBatchAuctionStorage.getActiveBidAttoEthAboveTick(nodes, root, tick) +
					activeCumulativeBidBeforeAttoEth;
			uint256 bidUsedAttoEth;
			uint256 attoRepFilled;
			uint256 refundAttoEth;
			BidSettlementStatus status;

			if (underfunded) {
				if (underfundedWinningAttoEth > 0 && tick >= clearingTick) {
					bidUsedAttoEth = bid.bidAmountAttoEth;
					attoRepFilled = UniformPriceDualCapBatchAuctionStorage.allocateFromCumulativePosition(cumulativeWinningBidBeforeAttoEth, bid.bidAmountAttoEth, totalAttoRepPurchased, underfundedWinningAttoEth);
					status = BidSettlementStatus.Winning;
				} else {
					refundAttoEth = bid.bidAmountAttoEth;
					status = BidSettlementStatus.Losing;
				}
			} else {
				if (tick < clearingTick) {
					refundAttoEth = bid.bidAmountAttoEth;
					status = BidSettlementStatus.Losing;
				} else if (tick > clearingTick) {
					bidUsedAttoEth = bid.bidAmountAttoEth;
					attoRepFilled = UniformPriceDualCapBatchAuctionStorage.allocateFromCumulativePosition(cumulativeWinningBidBeforeAttoEth, bid.bidAmountAttoEth, PRICE_PRECISION, clearingPriceLocal);
					status = BidSettlementStatus.Winning;
				} else {
					uint256 previousCumulativeBidAttoEth = activeCumulativeBidBeforeAttoEth;
					uint256 cumulativeBidAttoEth = previousCumulativeBidAttoEth + bid.bidAmountAttoEth;
					if (ethFilledAtClearingAttoEth <= previousCumulativeBidAttoEth) {
						bidUsedAttoEth = 0;
					} else if (ethFilledAtClearingAttoEth >= cumulativeBidAttoEth) {
						bidUsedAttoEth = bid.bidAmountAttoEth;
					} else {
						bidUsedAttoEth = ethFilledAtClearingAttoEth - previousCumulativeBidAttoEth;
					}
					if (bidUsedAttoEth > bid.bidAmountAttoEth) bidUsedAttoEth = bid.bidAmountAttoEth;
					attoRepFilled = UniformPriceDualCapBatchAuctionStorage.allocateFromCumulativePosition(cumulativeWinningBidBeforeAttoEth, bidUsedAttoEth, PRICE_PRECISION, clearingPriceLocal);
					refundAttoEth = bid.bidAmountAttoEth - bidUsedAttoEth;
					if (bidUsedAttoEth == 0) {
						status = BidSettlementStatus.Losing;
					} else if (bidUsedAttoEth == bid.bidAmountAttoEth) {
						status = BidSettlementStatus.Winning;
					} else {
						status = BidSettlementStatus.PartiallyFilled;
					}
				}
			}
			totalFilledAttoRep += attoRepFilled;
			totalProRataAllocation += UniformPriceDualCapBatchAuctionStorage.allocateFromCumulativePosition(cumulativeWinningBidBeforeAttoEth, bidUsedAttoEth, proRataTotal, attoEthRaised);
			totalRefundAttoEth += refundAttoEth;
			bid.claimed = true;
			emit BidSettled(withdrawFor, tick, index, bid.bidAmountAttoEth, bidUsedAttoEth, attoRepFilled, refundAttoEth, status);
		}

		_payOrDeferRefund(withdrawFor, totalRefundAttoEth);
	}

	function refundLosingBids(IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) external {
		_refundLosingBids(msg.sender, tickIndices);
	}

	function refundLosingBidsFor(address bidder, IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) external {
		require(msg.sender == owner, 'Only the auction owner can refund losing bids on behalf of bidders');
		_refundLosingBids(bidder, tickIndices);
	}

	function _refundLosingBids(address bidder, IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) private {
		require(!finalized, 'Auction has already been finalized');
		require(auctionStarted != 0, 'Auction must be started before refunding losing bids');
		require(bidder != address(0x0), 'Auction bidder address must not be the zero address');

		(bool hitCap, int256 foundTick, , ) = computeClearing();
		require(hitCap, 'Auction has not reached a clearing price yet');

		uint256 totalRefundAttoEth = 0;

		for (uint256 i = 0; i < tickIndices.length; i++) {
			int256 tick = tickIndices[i].tick;
			uint256 index = tickIndices[i].bidIndex;

			require(tick < foundTick, 'Binding or winning bid cannot be refunded before finalization');

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == bidder, 'Bid does not belong to the requested refund bidder');
			require(bid.bidAmountAttoEth > 0 && !bid.claimed, 'Bid has already been withdrawn or does not exist');

			uint256 originalBidAmountAttoEth = bid.bidAmountAttoEth;

			bid.claimed = true;
			UniformPriceDualCapBatchAuctionStorage.addRefundedPrefixAmount(refundedBidPrefixTree, tick, bidsAtTick[tick].length, index + 1, originalBidAmountAttoEth);

			totalRefundAttoEth += originalBidAmountAttoEth;

			// Update tree totals to remove this losing bid
			bool removedTick;
			(root, removedTick) = UniformPriceDualCapBatchAuctionStorage.decrease(nodes, root, tick, originalBidAmountAttoEth, underfundedThreshold);
			if (removedTick) activeTickCount -= 1;
			emit BidSettled(bidder, tick, index, originalBidAmountAttoEth, 0, 0, originalBidAmountAttoEth, BidSettlementStatus.PreFinalizationRefund);
		}

		_payOrDeferRefund(bidder, totalRefundAttoEth);
	}

	function withdrawPendingEthRefund() external {
		uint256 amountAttoEth = pendingEthRefundsAttoEth[msg.sender];
		require(amountAttoEth > 0, 'Auction has no deferred ETH refund');
		pendingEthRefundsAttoEth[msg.sender] = 0;
		emit PendingEthRefundWithdrawn(msg.sender, amountAttoEth);
		(bool sent, ) = payable(msg.sender).call{value: amountAttoEth}('');
		require(sent, 'Auction failed to withdraw deferred ETH refund');
	}

	function _payOrDeferRefund(address bidder, uint256 amountAttoEth) private {
		if (amountAttoEth == 0) return;
		(bool sent, ) = payable(bidder).call{value: amountAttoEth, gas: REFUND_PUSH_GAS_LIMIT}('');
		if (sent) return;
		uint256 pendingAmountAttoEth = pendingEthRefundsAttoEth[bidder] + amountAttoEth;
		pendingEthRefundsAttoEth[bidder] = pendingAmountAttoEth;
		emit EthRefundDeferred(bidder, amountAttoEth, pendingAmountAttoEth);
	}

	function tickToPrice(int256 tick) public pure returns (uint256 price) {
		return UniformPriceDualCapBatchAuctionStorage.tickToPrice(tick);
	}

	function getTickSummary(int256 tick) external view returns (IUniformPriceDualCapBatchAuction.TickSummary memory) {
		return _buildTickSummary(tick);
	}

	function getTickCount() external view returns (uint256) {
		return seenTicks.length;
	}

	function getTickPage(uint256 offset, uint256 limit) external view returns (IUniformPriceDualCapBatchAuction.TickSummary[] memory summaries) {
		uint256 end = _sliceEnd(offset, limit, seenTicks.length);
		if (end <= offset) return new IUniformPriceDualCapBatchAuction.TickSummary[](0);

		summaries = new IUniformPriceDualCapBatchAuction.TickSummary[](end - offset);
		for (uint256 i = offset; i < end; i++) {
			summaries[i - offset] = _buildTickSummary(seenTicks[i]);
		}
	}

	function getActiveTickPage(uint256 offset, uint256 limit) external view returns (IUniformPriceDualCapBatchAuction.TickSummary[] memory summaries) {
		uint256 end = _sliceEnd(offset, limit, activeTickCount);
		if (end <= offset) return new IUniformPriceDualCapBatchAuction.TickSummary[](0);

		summaries = new IUniformPriceDualCapBatchAuction.TickSummary[](end - offset);
		_fillActiveTickPage(root, offset, summaries, 0);
	}

	function getBidCountAtTick(int256 tick) external view returns (uint256) {
		return bidsAtTick[tick].length;
	}

	function getBidPageAtTick(int256 tick, uint256 offset, uint256 limit) external view returns (IUniformPriceDualCapBatchAuction.BidView[] memory bidViews) {
		uint256 total = bidsAtTick[tick].length;
		uint256 end = _sliceEnd(offset, limit, total);
		if (end <= offset) return new IUniformPriceDualCapBatchAuction.BidView[](0);

		bidViews = new IUniformPriceDualCapBatchAuction.BidView[](end - offset);
		for (uint256 i = offset; i < end; i++) {
			bidViews[i - offset] = _buildBidView(tick, i);
		}
	}

	function getBidderBidCount(address bidder) external view returns (uint256) {
		return bidderBidRefs[bidder].length;
	}

	function getBidderBidPage(address bidder, uint256 offset, uint256 limit) external view returns (IUniformPriceDualCapBatchAuction.BidView[] memory bidViews) {
		uint256 total = bidderBidRefs[bidder].length;
		uint256 end = _sliceEnd(offset, limit, total);
		if (end <= offset) return new IUniformPriceDualCapBatchAuction.BidView[](0);

		bidViews = new IUniformPriceDualCapBatchAuction.BidView[](end - offset);
		for (uint256 i = offset; i < end; i++) {
			BidRef storage bidRef = bidderBidRefs[bidder][i];
			bidViews[i - offset] = _buildBidView(bidRef.tick, bidRef.bidIndex);
		}
	}

	// Internal/private functions below

	function _isBidRefunded(int256 tick, uint256 bidIndex) internal view returns (bool) {
		uint256 refundedBefore = UniformPriceDualCapBatchAuctionStorage.refundedCumulativeBefore(refundedBidPrefixTree, tick, bidIndex);
		uint256 refundedAtOrBefore = UniformPriceDualCapBatchAuctionStorage.refundedCumulativeBefore(refundedBidPrefixTree, tick, bidIndex + 1);
		return refundedAtOrBefore > refundedBefore;
	}

	function _buildTickSummary(int256 tick) internal view returns (IUniformPriceDualCapBatchAuction.TickSummary memory) {
		uint256 currentTotalBidAttoEth = UniformPriceDualCapBatchAuctionStorage.getBidAttoEthAtTick(nodes, root, tick);
		return
			IUniformPriceDualCapBatchAuction.TickSummary({tick: tick, price: tickToPrice(tick), currentTotalBidAttoEth: currentTotalBidAttoEth, submissionCount: bidsAtTick[tick].length, active: currentTotalBidAttoEth > 0});
	}

	function _buildBidView(int256 tick, uint256 bidIndex) internal view returns (IUniformPriceDualCapBatchAuction.BidView memory) {
		Bid storage bid = bidsAtTick[tick][bidIndex];
		uint256 activeCumulativeBidBeforeAttoEth = _getActiveCumulativeBidBeforeAttoEth(tick, bidIndex, bid);
		return
			IUniformPriceDualCapBatchAuction.BidView({tick: tick, bidIndex: bidIndex, bidder: bid.bidder, bidAmountAttoEth: bid.bidAmountAttoEth, cumulativeBidAttoEth: bid.cumulativeBidAttoEth, activeCumulativeBidBeforeAttoEth: activeCumulativeBidBeforeAttoEth, claimed: bid.claimed, refunded: _isBidRefunded(tick, bidIndex)});
	}

	function _fillActiveTickPage(uint256 nodeId, uint256 offset, IUniformPriceDualCapBatchAuction.TickSummary[] memory summaries, uint256 writeIndex) internal view returns (uint256 remainingOffset, uint256 nextWriteIndex) {
		if (nodeId == 0 || writeIndex >= summaries.length) return (offset, writeIndex);

		UniformPriceDualCapBatchAuctionStorage.Node storage node = nodes[nodeId];
		(offset, writeIndex) = _fillActiveTickPage(node.right, offset, summaries, writeIndex);
		if (writeIndex >= summaries.length) return (offset, writeIndex);

		if (offset > 0) {
			offset -= 1;
		} else {
			summaries[writeIndex] = _buildTickSummary(node.tick);
			writeIndex += 1;
			if (writeIndex >= summaries.length) return (offset, writeIndex);
		}

		return _fillActiveTickPage(node.left, offset, summaries, writeIndex);
	}

	function _sliceEnd(uint256 offset, uint256 limit, uint256 total) internal pure returns (uint256) {
		if (limit == 0 || offset >= total) return offset;
		uint256 availableCount = total - offset;
		if (limit >= availableCount) return total;
		return offset + limit;
	}

	function _priceToCeilingTick(uint256 price) private pure returns (int256) {
		int256 low = MIN_TICK;
		int256 high = MAX_TICK;
		while (low < high) {
			int256 middle = low + (high - low) / 2;
			if (tickToPrice(middle) >= price) high = middle;
			else low = middle + 1;
		}
		return low;
	}

	function _appendBid(int256 tick, address bidder, uint256 bidAmountAttoEth) private returns (uint256 bidIndex) {
		bidIndex = bidsAtTick[tick].length;
		uint256 cumulativeBidAttoEth =
			bidIndex == 0 ? bidAmountAttoEth : bidsAtTick[tick][bidIndex - 1].cumulativeBidAttoEth + bidAmountAttoEth;
		require(cumulativeBidAttoEth <= type(uint128).max, 'Auction tick ETH total too high');
		UniformPriceDualCapBatchAuctionStorage.initializeRefundPrefixEntry(refundedBidPrefixTree, tick, bidIndex);
		bidsAtTick[tick].push(Bid({bidder: bidder, claimed: false, bidAmountAttoEth: uint128(bidAmountAttoEth), cumulativeBidAttoEth: uint128(cumulativeBidAttoEth)}));
		if (!hasSeenTick[tick]) {
			hasSeenTick[tick] = true;
			seenTicks.push(tick);
		}
		bidderBidRefs[bidder].push(BidRef({tick: tick, bidIndex: bidIndex}));
	}

	function _getActiveCumulativeBidBeforeAttoEth(int256 tick, uint256 bidIndex, Bid storage bid) private view returns (uint256) {
		uint256 grossCumulativeBidBeforeAttoEth = bid.cumulativeBidAttoEth - bid.bidAmountAttoEth;
		uint256 refundedCumulativeBidBeforeAttoEth = UniformPriceDualCapBatchAuctionStorage.refundedCumulativeBefore(refundedBidPrefixTree, tick, bidIndex);
		require(refundedCumulativeBidBeforeAttoEth <= grossCumulativeBidBeforeAttoEth, 'Refund prefix exceeds bid history');
		return grossCumulativeBidBeforeAttoEth - refundedCumulativeBidBeforeAttoEth;
	}
}
