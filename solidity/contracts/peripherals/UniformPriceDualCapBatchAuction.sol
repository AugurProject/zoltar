// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	IUniformPriceDualCapBatchAuction,
	IUniformPriceDualCapBatchAuctionEvents
} from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

// Gas bound: finalize() descends AVL aggregate paths and never scans bids. The
// tick range admits at most 1,048,577 distinct price levels, so an AVL tree over
// every possible tick has height <= 28. The auction intentionally does not add a
// bid or tick cap because valid price levels must remain open during bidding; see
// the synthetic max-depth gas tests.
contract UniformPriceDualCapBatchAuction is IUniformPriceDualCapBatchAuctionEvents {
	struct Node {
		int256 tick; // ETH/REP price (tick)
		uint256 totalBidAttoEth; // total ETH at this tick
		uint256 subtreeBidAttoEth; // total ETH in subtree
		uint256 left;
		uint256 right;
		uint256 height;
		uint256 subtreeClearingBidAttoEth; // total ETH in subtree that can contribute to clearing
		int256 minClearingTick;
	}

	struct Bid {
		address bidder;
		uint256 bidAmountAttoEth;
		uint256 cumulativeBidAttoEth;
		bool claimed;
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

	mapping(uint256 => Node) private nodes;
	mapping(int256 => Bid[]) private bidsAtTick;
	mapping(int256 => mapping(uint256 => uint256)) private refundedBidPrefixTree;

	uint256 private root;
	uint256 private nextId = 1;

	uint256 public maxRepBeingSoldAttoRep;
	uint256 public ethRaiseCapAttoEth;

	bool public finalized;
	int256 public clearingTick;
	uint256 public ethFilledAtClearingAttoEth;
	uint256 public ethRaisedAttoEth;
	uint256 public totalRepPurchasedAttoRep;

	uint256 public auctionStarted;
	uint256 public minBidSizeAttoEth;
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

	function startAuction(uint256 _ethRaiseCapAttoEth, uint256 _maxRepBeingSoldAttoRep) public {
		require(owner == msg.sender, 'Only the auction owner can start the auction');
		require(auctionStarted == 0, 'Auction has already been started');
		require(
			_ethRaiseCapAttoEth > 0 && _maxRepBeingSoldAttoRep > 0,
			'Auction ETH raise cap and REP sale cap must both be positive'
		);

		maxRepBeingSoldAttoRep = _maxRepBeingSoldAttoRep;
		ethRaiseCapAttoEth = _ethRaiseCapAttoEth;
		underfundedThreshold = Math.mulDiv(
			_ethRaiseCapAttoEth,
			PRICE_PRECISION,
			_maxRepBeingSoldAttoRep,
			Math.Rounding.Ceil
		);
		auctionStarted = block.timestamp;
		minBidSizeAttoEth = _ethRaiseCapAttoEth / MIN_BID_SIZE_DIVISOR;
		if (minBidSizeAttoEth < 1) minBidSizeAttoEth = 1;

		emit AuctionStarted(
			auctionStarted,
			auctionStarted + AUCTION_TIME,
			_ethRaiseCapAttoEth,
			_maxRepBeingSoldAttoRep,
			minBidSizeAttoEth
		);
	}

	function submitBid(int256 tick) external payable isOperational {
		require(msg.value >= minBidSizeAttoEth, 'Auction bid is smaller than the minimum bid size');
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'Auction tick is outside the supported price range');
		require(tickToPrice(tick) > 0, 'Auction tick price rounds down to zero');
		// Same-price rationing is intentionally time-priority, not pro-rata. Bids at
		// one tick append in submission order, and any marginal clearing-tick fill
		// consumes earlier same-tick ETH before later same-tick ETH.
		root = _insert(root, tick, msg.value);
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
		clearingTick = finalClearingTick;
		ethFilledAtClearingAttoEth = bidAtClearingTickAttoEth;
		ethRaisedAttoEth = accumulatedBidAttoEth;
		underfunded = !hitCap;
		underfundedWinningAttoEth = finalUnderfundedWinningAttoEth;
		totalRepPurchasedAttoRep = finalRepPurchasedAttoRep;

		emit AuctionFinalized(
			clearingTick,
			raisedAttoEthToSend,
			totalRepPurchasedAttoRep,
			ethFilledAtClearingAttoEth,
			hitCap
		);
		(bool sent, ) = payable(owner).call{ value: raisedAttoEthToSend }('');
		require(sent, 'Auction failed to send raised ETH to the owner');
	}

	function previewFinalization() external view returns (uint256 raisedAttoEthToSend, uint256 repPurchasedAttoRep) {
		(bool hitCap, int256 foundTick, uint256 accumulatedBidAttoEth, ) = computeClearing();
		(, , repPurchasedAttoRep, raisedAttoEthToSend) = _computeFinalizationOutcome(
			hitCap,
			foundTick,
			accumulatedBidAttoEth
		);
	}

	function _computeFinalizationOutcome(
		bool hitCap,
		int256 foundTick,
		uint256 accumulatedBidAttoEth
	)
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
		if (accumulatedBidAttoEth == 0 || maxRepBeingSoldAttoRep == 0) return (0, 0, 0, 0);
		finalClearingTick = _priceToCeilingTick(underfundedThreshold);
		uint256 clearingPrice = tickToPrice(finalClearingTick);
		if (clearingPrice < underfundedThreshold) return (finalClearingTick, 0, 0, 0);

		finalUnderfundedWinningAttoEth =
			_getActiveBidAttoEthAboveTick(root, finalClearingTick) + _getBidAttoEthAtTick(root, finalClearingTick);
		if (finalUnderfundedWinningAttoEth == 0) return (finalClearingTick, 0, 0, 0);
		finalRepPurchasedAttoRep = maxRepBeingSoldAttoRep;
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
		return _compute(root, 0, 0, 0, 0);
	}

	function withdrawBids(
		address withdrawFor,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices,
		uint256 proRataTotal
	) external returns (uint256 totalFilledRepAttoRep, uint256 totalRefundAttoEth, uint256 totalProRataAllocation) {
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
				_getActiveBidAttoEthAboveTick(root, tick) + activeCumulativeBidBeforeAttoEth;
			uint256 bidUsedAttoEth;
			uint256 repFilledAttoRep;
			uint256 refundAttoEth;
			BidSettlementStatus status;

			if (underfunded) {
				if (underfundedWinningAttoEth > 0 && tick >= clearingTick) {
					bidUsedAttoEth = bid.bidAmountAttoEth;
					repFilledAttoRep = _allocateFromCumulativePosition(
						cumulativeWinningBidBeforeAttoEth,
						bid.bidAmountAttoEth,
						totalRepPurchasedAttoRep,
						underfundedWinningAttoEth
					);
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
					repFilledAttoRep = _allocateFromCumulativePosition(
						cumulativeWinningBidBeforeAttoEth,
						bid.bidAmountAttoEth,
						PRICE_PRECISION,
						clearingPriceLocal
					);
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
					repFilledAttoRep = _allocateFromCumulativePosition(
						cumulativeWinningBidBeforeAttoEth,
						bidUsedAttoEth,
						PRICE_PRECISION,
						clearingPriceLocal
					);
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
			totalFilledRepAttoRep += repFilledAttoRep;
			totalProRataAllocation += _allocateFromCumulativePosition(
				cumulativeWinningBidBeforeAttoEth,
				bidUsedAttoEth,
				proRataTotal,
				ethRaisedAttoEth
			);
			totalRefundAttoEth += refundAttoEth;
			bid.claimed = true;
			emit BidSettled(
				withdrawFor,
				tick,
				index,
				bid.bidAmountAttoEth,
				bidUsedAttoEth,
				repFilledAttoRep,
				refundAttoEth,
				status
			);
		}

		_payOrDeferRefund(withdrawFor, totalRefundAttoEth);
	}

	function refundLosingBids(IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices) external {
		_refundLosingBids(msg.sender, tickIndices);
	}

	function refundLosingBidsFor(
		address bidder,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices
	) external {
		require(msg.sender == owner, 'Only the auction owner can refund losing bids on behalf of bidders');
		_refundLosingBids(bidder, tickIndices);
	}

	function _refundLosingBids(
		address bidder,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices
	) private {
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
			_addRefundedBidPrefixAmount(tick, index + 1, originalBidAmountAttoEth);

			totalRefundAttoEth += originalBidAmountAttoEth;

			// Update tree totals to remove this losing bid
			_decreaseAtPrice(tick, originalBidAmountAttoEth);
			emit BidSettled(
				bidder,
				tick,
				index,
				originalBidAmountAttoEth,
				0,
				0,
				originalBidAmountAttoEth,
				BidSettlementStatus.PreFinalizationRefund
			);
		}

		_payOrDeferRefund(bidder, totalRefundAttoEth);
	}

	function withdrawPendingEthRefund() external {
		uint256 amountAttoEth = pendingEthRefundsAttoEth[msg.sender];
		require(amountAttoEth > 0, 'Auction has no deferred ETH refund');
		pendingEthRefundsAttoEth[msg.sender] = 0;
		emit PendingEthRefundWithdrawn(msg.sender, amountAttoEth);
		(bool sent, ) = payable(msg.sender).call{ value: amountAttoEth }('');
		require(sent, 'Auction failed to withdraw deferred ETH refund');
	}

	function _payOrDeferRefund(address bidder, uint256 amountAttoEth) private {
		if (amountAttoEth == 0) return;
		(bool sent, ) = payable(bidder).call{ value: amountAttoEth, gas: REFUND_PUSH_GAS_LIMIT }('');
		if (sent) return;
		uint256 pendingAmountAttoEth = pendingEthRefundsAttoEth[bidder] + amountAttoEth;
		pendingEthRefundsAttoEth[bidder] = pendingAmountAttoEth;
		emit EthRefundDeferred(bidder, amountAttoEth, pendingAmountAttoEth);
	}

	function tickToPrice(int256 tick) public pure returns (uint256 price) {
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'Auction tick is outside the supported price range');
		uint256 absTick = tick < 0 ? uint256(-tick) : uint256(tick);
		price = PRICE_PRECISION;
		for (uint8 i = 0; i < 20; i++) {
			if ((absTick & (1 << i)) != 0) price = (price * powerOf1Point0001(i)) / PRICE_PRECISION;
		}
		if (tick < 0) price = (PRICE_PRECISION * PRICE_PRECISION) / price;
	}

	function getTickSummary(int256 tick) external view returns (IUniformPriceDualCapBatchAuction.TickSummary memory) {
		return _buildTickSummary(tick);
	}

	function getTickCount() external view returns (uint256) {
		return seenTicks.length;
	}

	function getTickPage(
		uint256 offset,
		uint256 limit
	) external view returns (IUniformPriceDualCapBatchAuction.TickSummary[] memory summaries) {
		uint256 end = _sliceEnd(offset, limit, seenTicks.length);
		if (end <= offset) return new IUniformPriceDualCapBatchAuction.TickSummary[](0);

		summaries = new IUniformPriceDualCapBatchAuction.TickSummary[](end - offset);
		for (uint256 i = offset; i < end; i++) {
			summaries[i - offset] = _buildTickSummary(seenTicks[i]);
		}
	}

	function getActiveTickPage(
		uint256 offset,
		uint256 limit
	) external view returns (IUniformPriceDualCapBatchAuction.TickSummary[] memory summaries) {
		uint256 end = _sliceEnd(offset, limit, activeTickCount);
		if (end <= offset) return new IUniformPriceDualCapBatchAuction.TickSummary[](0);

		summaries = new IUniformPriceDualCapBatchAuction.TickSummary[](end - offset);
		_fillActiveTickPage(root, offset, summaries, 0);
	}

	function getBidCountAtTick(int256 tick) external view returns (uint256) {
		return bidsAtTick[tick].length;
	}

	function getBidPageAtTick(
		int256 tick,
		uint256 offset,
		uint256 limit
	) external view returns (IUniformPriceDualCapBatchAuction.BidView[] memory bidViews) {
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

	function getBidderBidPage(
		address bidder,
		uint256 offset,
		uint256 limit
	) external view returns (IUniformPriceDualCapBatchAuction.BidView[] memory bidViews) {
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

	function _wouldClear(uint256 candidateBidAttoEth, int256 tick) internal view returns (bool) {
		if (candidateBidAttoEth >= ethRaiseCapAttoEth) return true;
		uint256 price = tickToPrice(tick);
		if (price == 0) return false;
		uint256 candidateRepAttoRep = (candidateBidAttoEth * PRICE_PRECISION) / price;
		return candidateRepAttoRep >= maxRepBeingSoldAttoRep;
	}

	function _isClearingTick(int256 tick) private view returns (bool) {
		return tickToPrice(tick) >= underfundedThreshold;
	}

	function _subtreeWouldClear(uint256 nodeId, uint256 accumulatedBidAttoEth) internal view returns (bool) {
		if (nodeId == 0) return false;
		Node storage node = nodes[nodeId];
		if (node.subtreeClearingBidAttoEth == 0) return false;
		return _wouldClear(accumulatedBidAttoEth + node.subtreeClearingBidAttoEth, node.minClearingTick);
	}

	function _getBidAttoEthAtTick(uint256 nodeId, int256 tick) internal view returns (uint256) {
		if (nodeId == 0) return 0;
		Node storage node = nodes[nodeId];
		if (tick == node.tick) return node.totalBidAttoEth;
		if (tick < node.tick) return _getBidAttoEthAtTick(node.left, tick);
		return _getBidAttoEthAtTick(node.right, tick);
	}

	function _isBidRefunded(int256 tick, uint256 bidIndex) internal view returns (bool) {
		uint256 refundedBefore = _getRefundedCumulativeBidBeforeAttoEthIndex(tick, bidIndex);
		uint256 refundedAtOrBefore = _getRefundedCumulativeBidBeforeAttoEthIndex(tick, bidIndex + 1);
		return refundedAtOrBefore > refundedBefore;
	}

	function _buildTickSummary(
		int256 tick
	) internal view returns (IUniformPriceDualCapBatchAuction.TickSummary memory) {
		uint256 currentTotalBidAttoEth = _getBidAttoEthAtTick(root, tick);
		return
			IUniformPriceDualCapBatchAuction.TickSummary({
				tick: tick,
				price: tickToPrice(tick),
				currentTotalBidAttoEth: currentTotalBidAttoEth,
				submissionCount: bidsAtTick[tick].length,
				active: currentTotalBidAttoEth > 0
			});
	}

	function _buildBidView(
		int256 tick,
		uint256 bidIndex
	) internal view returns (IUniformPriceDualCapBatchAuction.BidView memory) {
		Bid storage bid = bidsAtTick[tick][bidIndex];
		uint256 activeCumulativeBidBeforeAttoEth = _getActiveCumulativeBidBeforeAttoEth(tick, bidIndex, bid);
		return
			IUniformPriceDualCapBatchAuction.BidView({
				tick: tick,
				bidIndex: bidIndex,
				bidder: bid.bidder,
				bidAmountAttoEth: bid.bidAmountAttoEth,
				cumulativeBidAttoEth: bid.cumulativeBidAttoEth,
				activeCumulativeBidBeforeAttoEth: activeCumulativeBidBeforeAttoEth,
				claimed: bid.claimed,
				refunded: _isBidRefunded(tick, bidIndex)
			});
	}

	function _allocateFromCumulativePosition(
		uint256 cumulativeAmountBefore,
		uint256 amountUsed,
		uint256 allocationNumerator,
		uint256 denominator
	) private pure returns (uint256 allocation) {
		if (amountUsed == 0 || allocationNumerator == 0 || denominator == 0) return 0;
		uint256 cumulativeAllocationBefore = Math.mulDiv(cumulativeAmountBefore, allocationNumerator, denominator);
		uint256 cumulativeAllocationAfter = Math.mulDiv(
			cumulativeAmountBefore + amountUsed,
			allocationNumerator,
			denominator
		);
		return cumulativeAllocationAfter - cumulativeAllocationBefore;
	}

	function _getActiveBidAttoEthAboveTick(uint256 nodeId, int256 tick) private view returns (uint256 bidAttoEthAbove) {
		if (nodeId == 0) return 0;
		Node storage node = nodes[nodeId];
		if (tick < node.tick) {
			uint256 rightBidAttoEth = node.right == 0 ? 0 : nodes[node.right].subtreeBidAttoEth;
			return rightBidAttoEth + node.totalBidAttoEth + _getActiveBidAttoEthAboveTick(node.left, tick);
		}
		if (tick > node.tick) return _getActiveBidAttoEthAboveTick(node.right, tick);
		return node.right == 0 ? 0 : nodes[node.right].subtreeBidAttoEth;
	}

	function _fillActiveTickPage(
		uint256 nodeId,
		uint256 offset,
		IUniformPriceDualCapBatchAuction.TickSummary[] memory summaries,
		uint256 writeIndex
	) internal view returns (uint256 remainingOffset, uint256 nextWriteIndex) {
		if (nodeId == 0 || writeIndex >= summaries.length) return (offset, writeIndex);

		Node storage node = nodes[nodeId];
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

	function _compute(
		uint256 nodeId,
		uint256 accumulatedBidAttoEth,
		int256 lastValidTick,
		uint256 lastValidBidAttoEth,
		uint256 lastValidBidAtTickAttoEth
	) internal view returns (bool, int256, uint256, uint256) {
		if (nodeId == 0) return (false, lastValidTick, accumulatedBidAttoEth, 0);
		Node storage node = nodes[nodeId];
		if (!_subtreeWouldClear(nodeId, accumulatedBidAttoEth)) {
			uint256 skippedBidAtTickAttoEth = _getBidAttoEthAtTick(nodeId, node.minClearingTick);
			return (
				false,
				node.minClearingTick,
				accumulatedBidAttoEth + node.subtreeClearingBidAttoEth,
				skippedBidAtTickAttoEth
			);
		}

		if (node.right != 0) {
			if (_subtreeWouldClear(node.right, accumulatedBidAttoEth)) {
				return
					_compute(
						node.right,
						accumulatedBidAttoEth,
						lastValidTick,
						lastValidBidAttoEth,
						lastValidBidAtTickAttoEth
					);
			}

			Node storage rightNode = nodes[node.right];
			accumulatedBidAttoEth += rightNode.subtreeClearingBidAttoEth;
			if (rightNode.subtreeClearingBidAttoEth > 0) {
				lastValidTick = rightNode.minClearingTick;
				lastValidBidAttoEth = accumulatedBidAttoEth;
				lastValidBidAtTickAttoEth = _getBidAttoEthAtTick(node.right, rightNode.minClearingTick);
			}
		}

		// This node and its entire left subtree are below the cap-implied reserve.
		// They remain in subtreeBidAttoEth for refunds and pagination but cannot establish
		// a funded clearing price or contribute ETH to a winning prefix.
		if (!_isClearingTick(node.tick))
			return (false, lastValidTick, accumulatedBidAttoEth, lastValidBidAtTickAttoEth);

		uint256 price = tickToPrice(node.tick);
		uint256 bidToTakeAttoEth = price == 0 ? 0 : node.totalBidAttoEth;
		if (accumulatedBidAttoEth > 0) {
			uint256 repIfRepricedAttoRep = price == 0 ? 0 : (accumulatedBidAttoEth * PRICE_PRECISION) / price;
			if (repIfRepricedAttoRep > maxRepBeingSoldAttoRep)
				return (true, lastValidTick, lastValidBidAttoEth, lastValidBidAtTickAttoEth);
		}

		if (accumulatedBidAttoEth >= ethRaiseCapAttoEth)
			return (true, lastValidTick, lastValidBidAttoEth, lastValidBidAtTickAttoEth);
		uint256 remainingCap = ethRaiseCapAttoEth - accumulatedBidAttoEth;
		if (bidToTakeAttoEth > remainingCap) bidToTakeAttoEth = remainingCap;
		uint256 newAccumulatedBidAttoEth = accumulatedBidAttoEth + bidToTakeAttoEth;

		uint256 totalRepAttoRep = price == 0 ? 0 : (newAccumulatedBidAttoEth * PRICE_PRECISION) / price;

		if (totalRepAttoRep >= maxRepBeingSoldAttoRep) {
			// partial fill
			uint256 maximumBidAtThisPriceAttoEth = (maxRepBeingSoldAttoRep * price) / PRICE_PRECISION;
			uint256 bidUsedAtTickAttoEth = 0;
			if (maximumBidAtThisPriceAttoEth > accumulatedBidAttoEth)
				bidUsedAtTickAttoEth = maximumBidAtThisPriceAttoEth - accumulatedBidAttoEth;
			if (bidUsedAtTickAttoEth > bidToTakeAttoEth) bidUsedAtTickAttoEth = bidToTakeAttoEth;
			return (true, node.tick, accumulatedBidAttoEth + bidUsedAtTickAttoEth, bidUsedAtTickAttoEth);
		}

		if (newAccumulatedBidAttoEth >= ethRaiseCapAttoEth)
			return (true, node.tick, newAccumulatedBidAttoEth, bidToTakeAttoEth);

		accumulatedBidAttoEth = newAccumulatedBidAttoEth;

		lastValidTick = node.tick;
		lastValidBidAttoEth = accumulatedBidAttoEth;
		lastValidBidAtTickAttoEth = bidToTakeAttoEth;

		// continue to lower prices
		return
			_compute(node.left, accumulatedBidAttoEth, lastValidTick, lastValidBidAttoEth, lastValidBidAtTickAttoEth);
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

	function _insert(uint256 nodeId, int256 tick, uint256 bidAmountAttoEth) internal returns (uint256) {
		if (nodeId == 0) {
			uint256 newId = nextId++;
			uint256 nodeClearingBidAttoEth = _isClearingTick(tick) ? bidAmountAttoEth : 0;
			nodes[newId] = Node({
				tick: tick,
				totalBidAttoEth: bidAmountAttoEth,
				subtreeBidAttoEth: bidAmountAttoEth,
				left: 0,
				right: 0,
				height: 1,
				subtreeClearingBidAttoEth: nodeClearingBidAttoEth,
				minClearingTick: nodeClearingBidAttoEth == 0 ? int256(0) : tick
			});
			activeTickCount += 1;
			return newId;
		}

		Node storage node = nodes[nodeId];
		if (tick == node.tick) {
			node.totalBidAttoEth += bidAmountAttoEth;
		} else if (tick < node.tick) {
			node.left = _insert(node.left, tick, bidAmountAttoEth);
		} else {
			node.right = _insert(node.right, tick, bidAmountAttoEth);
		}

		_update(nodeId);
		return _balance(nodeId);
	}

	function _appendBid(int256 tick, address bidder, uint256 bidAmountAttoEth) private returns (uint256 bidIndex) {
		bidIndex = bidsAtTick[tick].length;
		uint256 cumulativeBidAttoEth =
			bidIndex == 0 ? bidAmountAttoEth : bidsAtTick[tick][bidIndex - 1].cumulativeBidAttoEth + bidAmountAttoEth;
		uint256 treeIndex = bidIndex + 1;
		uint256 leastSignificantBit = _leastSignificantBit(treeIndex);
		refundedBidPrefixTree[tick][treeIndex] =
			_getRefundedCumulativeBidBeforeAttoEthIndex(tick, bidIndex) -
			_getRefundedCumulativeBidBeforeAttoEthIndex(tick, treeIndex - leastSignificantBit);
		bidsAtTick[tick].push(
			Bid({
				bidder: bidder,
				bidAmountAttoEth: bidAmountAttoEth,
				cumulativeBidAttoEth: cumulativeBidAttoEth,
				claimed: false
			})
		);
		if (!hasSeenTick[tick]) {
			hasSeenTick[tick] = true;
			seenTicks.push(tick);
		}
		bidderBidRefs[bidder].push(BidRef({ tick: tick, bidIndex: bidIndex }));
	}

	function _update(uint256 nodeId) internal {
		Node storage node = nodes[nodeId];
		uint256 leftBidAttoEth;
		uint256 rightBidAttoEth;
		uint256 leftH;
		uint256 rightH;
		uint256 leftClearingBidAttoEth;
		uint256 rightClearingBidAttoEth;
		if (node.left != 0) {
			leftBidAttoEth = nodes[node.left].subtreeBidAttoEth;
			leftH = nodes[node.left].height;
			leftClearingBidAttoEth = nodes[node.left].subtreeClearingBidAttoEth;
		}
		if (node.right != 0) {
			rightBidAttoEth = nodes[node.right].subtreeBidAttoEth;
			rightH = nodes[node.right].height;
			rightClearingBidAttoEth = nodes[node.right].subtreeClearingBidAttoEth;
		}

		uint256 nodeClearingBidAttoEth = _isClearingTick(node.tick) ? node.totalBidAttoEth : 0;
		node.subtreeBidAttoEth = node.totalBidAttoEth + leftBidAttoEth + rightBidAttoEth;
		node.subtreeClearingBidAttoEth = nodeClearingBidAttoEth + leftClearingBidAttoEth + rightClearingBidAttoEth;
		node.height = 1 + (leftH > rightH ? leftH : rightH);
		if (leftClearingBidAttoEth > 0) {
			node.minClearingTick = nodes[node.left].minClearingTick;
		} else if (nodeClearingBidAttoEth > 0) {
			node.minClearingTick = node.tick;
		} else {
			node.minClearingTick = rightClearingBidAttoEth == 0 ? int256(0) : nodes[node.right].minClearingTick;
		}
	}

	function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
		if (numerator == 0) return 0;
		return ((numerator - 1) / denominator) + 1;
	}

	function _height(uint256 nodeId) internal view returns (uint256) {
		return nodeId == 0 ? 0 : nodes[nodeId].height;
	}

	function _balance(uint256 nodeId) internal returns (uint256) {
		int256 balance = int256(_height(nodes[nodeId].left)) - int256(_height(nodes[nodeId].right));
		if (balance > 1) {
			if (_height(nodes[nodes[nodeId].left].left) < _height(nodes[nodes[nodeId].left].right))
				nodes[nodeId].left = _rotateLeft(nodes[nodeId].left);
			return _rotateRight(nodeId);
		}
		if (balance < -1) {
			if (_height(nodes[nodes[nodeId].right].right) < _height(nodes[nodes[nodeId].right].left))
				nodes[nodeId].right = _rotateRight(nodes[nodeId].right);
			return _rotateLeft(nodeId);
		}
		return nodeId;
	}

	function _rotateLeft(uint256 nodeId) internal returns (uint256) {
		uint256 newRoot = nodes[nodeId].right;
		uint256 moved = nodes[newRoot].left;
		nodes[newRoot].left = nodeId;
		nodes[nodeId].right = moved;
		_update(nodeId);
		_update(newRoot);
		return newRoot;
	}

	function _rotateRight(uint256 nodeId) internal returns (uint256) {
		uint256 newRoot = nodes[nodeId].left;
		uint256 moved = nodes[newRoot].right;
		nodes[newRoot].right = nodeId;
		nodes[nodeId].left = moved;
		_update(nodeId);
		_update(newRoot);
		return newRoot;
	}

	function powerOf1Point0001(uint8 index) internal pure returns (uint256) {
		if (index == 0) return 1000100000000000000;
		if (index == 1) return 1000200010000000000;
		if (index == 2) return 1000400060004000100;
		if (index == 3) return 1000800280056007000;
		if (index == 4) return 1001601200560182043;
		if (index == 5) return 1003204964963598014;
		if (index == 6) return 1006420201727613920;
		if (index == 7) return 1012881622445451097;
		if (index == 8) return 1025929181087729343;
		if (index == 9) return 1052530684607338948;
		if (index == 10) return 1107820842039993613;
		if (index == 11) return 1227267018058200482;
		if (index == 12) return 1506184333613467388;
		if (index == 13) return 2268591246822644826;
		if (index == 14) return 5146506245160322222;
		if (index == 15) return 26486526531474198664;
		if (index == 16) return 701536087702486644953;
		if (index == 17) return 492152882348911033633683;
		if (index == 18) return 242214459604341065650571799093;
		if (index == 19) return 58667844441422969901301586347865591163491;
		revert('Auction tick price power index is out of bounds');
	}

	function _decreaseAtPrice(int256 tick, uint256 bidAmountAttoEth) internal {
		root = _decrease(root, tick, bidAmountAttoEth);
	}

	function _getRefundedCumulativeBidBeforeAttoEthIndex(
		int256 tick,
		uint256 index
	) internal view returns (uint256 cumulativeBidAttoEth) {
		uint256 treeIndex = index;
		while (treeIndex > 0) {
			cumulativeBidAttoEth += refundedBidPrefixTree[tick][treeIndex];
			treeIndex -= _leastSignificantBit(treeIndex);
		}
	}

	function _getActiveCumulativeBidBeforeAttoEth(
		int256 tick,
		uint256 bidIndex,
		Bid storage bid
	) private view returns (uint256) {
		uint256 grossCumulativeBidBeforeAttoEth = bid.cumulativeBidAttoEth - bid.bidAmountAttoEth;
		uint256 refundedCumulativeBidBeforeAttoEth = _getRefundedCumulativeBidBeforeAttoEthIndex(tick, bidIndex);
		require(
			refundedCumulativeBidBeforeAttoEth <= grossCumulativeBidBeforeAttoEth,
			'Refund prefix exceeds bid history'
		);
		return grossCumulativeBidBeforeAttoEth - refundedCumulativeBidBeforeAttoEth;
	}

	function _addRefundedBidPrefixAmount(int256 tick, uint256 index, uint256 amountAttoEth) internal {
		uint256 bidCount = bidsAtTick[tick].length;
		uint256 treeIndex = index;
		while (treeIndex <= bidCount) {
			refundedBidPrefixTree[tick][treeIndex] += amountAttoEth;
			treeIndex += _leastSignificantBit(treeIndex);
		}
	}

	function _leastSignificantBit(uint256 value) internal pure returns (uint256) {
		return value & (~value + 1);
	}

	function _decrease(uint256 nodeId, int256 tick, uint256 bidAmountAttoEth) internal returns (uint256) {
		require(nodeId != 0, 'Auction tree node must exist before decreasing its ETH total');
		Node storage node = nodes[nodeId];

		if (tick < node.tick) {
			node.left = _decrease(node.left, tick, bidAmountAttoEth);
		} else if (tick > node.tick) {
			node.right = _decrease(node.right, tick, bidAmountAttoEth);
		} else {
			// Found node
			require(node.totalBidAttoEth >= bidAmountAttoEth, 'Auction tree node ETH total would underflow');
			node.totalBidAttoEth -= bidAmountAttoEth;

			// If node still has ETH, just update
			if (node.totalBidAttoEth > 0) {
				_update(nodeId);
				return _balance(nodeId);
			}

			// Node empty → delete
			activeTickCount -= 1;
			return _delete(nodeId, tick);
		}

		_update(nodeId);
		return _balance(nodeId);
	}

	function _delete(uint256 nodeId, int256 tick) internal returns (uint256) {
		require(nodeId != 0, 'Auction tree node must exist before deletion');
		Node storage node = nodes[nodeId];

		if (tick < node.tick) {
			node.left = _delete(node.left, tick);
		} else if (tick > node.tick) {
			node.right = _delete(node.right, tick);
		} else {
			// Case 1: no children
			if (node.left == 0 && node.right == 0) {
				delete nodes[nodeId];
				return 0;
			}

			// Case 2: only right child
			if (node.left == 0) {
				uint256 rightChild = node.right;
				delete nodes[nodeId];
				return rightChild;
			}

			// Case 3: only left child
			if (node.right == 0) {
				uint256 leftChild = node.left;
				delete nodes[nodeId];
				return leftChild;
			}

			// Case 4: two children
			uint256 successorId = _minNode(node.right); // smallest in right subtree
			Node storage successor = nodes[successorId];

			// Copy successor data
			node.tick = successor.tick;
			node.totalBidAttoEth = successor.totalBidAttoEth;

			// Delete successor recursively
			node.right = _delete(node.right, successor.tick);
		}

		_update(nodeId);
		return _balance(nodeId);
	}

	function _minNode(uint256 nodeId) internal view returns (uint256) {
		uint256 current = nodeId;
		while (nodes[current].left != 0) {
			current = nodes[current].left;
		}
		return current;
	}

	function _maxNode(uint256 nodeId) internal view returns (uint256) {
		uint256 current = nodeId;
		while (nodes[current].right != 0) {
			current = nodes[current].right;
		}
		return current;
	}
}
