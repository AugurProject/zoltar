// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

// Gas bound: finalize() descends AVL aggregate paths and never scans bids. The
// tick range admits at most 1,048,577 distinct price levels, so an AVL tree over
// every possible tick has height <= 28. The auction intentionally does not add a
// bid or tick cap because valid price levels must remain open during bidding; see
// the synthetic max-depth gas tests.
contract UniformPriceDualCapBatchAuction {
	struct Node {
		int256 tick; // ETH/REP price (tick)
		uint256 totalEth; // total ETH at this tick
		uint256 subtreeEth; // total ETH in subtree
		uint256 left;
		uint256 right;
		uint256 height;
		uint256 subtreeClearingEth; // total ETH in subtree that can contribute to clearing
		int256 minClearingTick;
	}

	struct Bid {
		address bidder;
		uint256 ethAmount;
		uint256 cumulativeEth;
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

	mapping(uint256 => Node) private nodes;
	mapping(int256 => Bid[]) private bidsAtTick;
	mapping(int256 => mapping(uint256 => uint256)) private refundedBidPrefixTree;

	uint256 private root;
	uint256 private nextId = 1;

	uint256 public maxRepBeingSold;
	uint256 public ethRaiseCap;

	bool public finalized;
	int256 public clearingTick;
	uint256 public ethFilledAtClearing;
	uint256 public ethRaised;
	uint256 public totalRepPurchased;

	uint256 public auctionStarted;
	uint256 public minBidSize;
	address public immutable owner;

	bool public underfunded;
	uint256 public underfundedThreshold;
	uint256 public underfundedWinningEth;
	uint256 public activeTickCount;

	int256[] private seenTicks;
	mapping(int256 => bool) private hasSeenTick;
	mapping(address => BidRef[]) private bidderBidRefs;

	event AuctionStarted(uint256 ethRaiseCap, uint256 maxRepBeingSold, uint256 minBidSize);
	event SubmitBid(address bidder, int256 tick, uint256 amount);
	event Finalized(uint256 ethToSend, bool hitCap, int256 foundTick, uint256 repFilled, uint256 ethFilled);
	event WithdrawBids(
		address withdrawFor,
		IUniformPriceDualCapBatchAuction.TickIndex[] tickIndices,
		uint256 totalFilledRep,
		uint256 totalEthRefund
	);
	event RefundLosingBids(address bidder, IUniformPriceDualCapBatchAuction.TickIndex[] tickIndices, uint256 ethAmount);

	constructor(address _owner) {
		// Child-pool truth auctions are intentionally owned by the SecurityPoolForker
		// contract. The forker starts/finalizes the auction and later withdraws bids on
		// behalf of vaults so the purchased REP can be credited back into pool ownership.
		owner = _owner;
	}

	modifier isOperational() {
		require(auctionStarted != 0, 'Auction must be started before accepting bids');
		require(!finalized, 'Auction has already been finalized');
		require(block.timestamp < auctionStarted + AUCTION_TIME, 'Auction bidding period has ended');
		_;
	}

	function startAuction(uint256 _ethRaiseCap, uint256 _maxRepBeingSold) public {
		require(owner == msg.sender, 'Only the auction owner can start the auction');
		require(auctionStarted == 0, 'Auction has already been started');
		require(
			_ethRaiseCap > 0 && _maxRepBeingSold > 0,
			'Auction ETH raise cap and REP sale cap must both be positive'
		);

		maxRepBeingSold = _maxRepBeingSold;
		ethRaiseCap = _ethRaiseCap;
		underfundedThreshold = Math.mulDiv(_ethRaiseCap, PRICE_PRECISION, _maxRepBeingSold, Math.Rounding.Ceil);
		auctionStarted = block.timestamp;
		minBidSize = _ethRaiseCap / MIN_BID_SIZE_DIVISOR;
		if (minBidSize < 1) minBidSize = 1;

		emit AuctionStarted(_ethRaiseCap, _maxRepBeingSold, minBidSize);
	}

	function submitBid(int256 tick) external payable isOperational {
		require(msg.value >= minBidSize, 'Auction bid is smaller than the minimum bid size');
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'Auction tick is outside the supported price range');
		require(tickToPrice(tick) > 0, 'Auction tick price rounds down to zero');
		// Same-price rationing is intentionally time-priority, not pro-rata. Bids at
		// one tick append in submission order, and any marginal clearing-tick fill
		// consumes earlier same-tick ETH before later same-tick ETH.
		root = _insert(root, tick, msg.sender, msg.value);
		emit SubmitBid(msg.sender, tick, msg.value);
	}

	function finalize() external {
		require(!finalized, 'Auction has already been finalized');
		require(msg.sender == owner, 'Only the auction owner can finalize');
		require(auctionStarted != 0, 'Auction must be started before finalization');
		require(block.timestamp >= auctionStarted + AUCTION_TIME, 'Auction bidding period is still active');

		(bool hitCap, int256 foundTick, uint256 accumulatedEth, uint256 ethAtClearingTick) = computeClearing();
		finalized = true;
		clearingTick = foundTick;
		ethFilledAtClearing = ethAtClearingTick;
		ethRaised = accumulatedEth;

		uint256 ethToSend;
		if (hitCap) {
			uint256 clearingPrice = tickToPrice(clearingTick);
			totalRepPurchased = clearingPrice > 0 ? (accumulatedEth * PRICE_PRECISION) / clearingPrice : 0;
			ethToSend = accumulatedEth;
		} else {
			// Underfunded bids buy REP only at or above the auction reserve implied by
			// both caps. This keeps REP issued proportional to ETH actually raised.
			underfunded = true;
			if (ethRaised == 0 || maxRepBeingSold == 0) {
				clearingTick = 0;
				underfundedWinningEth = 0;
				totalRepPurchased = 0;
				ethToSend = 0;
			} else {
				clearingTick = _priceToCeilingTick(underfundedThreshold);
				uint256 clearingPrice = tickToPrice(clearingTick);
				if (clearingPrice < underfundedThreshold) {
					totalRepPurchased = 0;
					ethToSend = 0;
				} else {
					underfundedWinningEth =
						_getActiveEthAboveTick(root, clearingTick) + _getEthAtTick(root, clearingTick);
					totalRepPurchased = Math.mulDiv(maxRepBeingSold, underfundedWinningEth, ethRaiseCap);
					if (totalRepPurchased == 0) {
						underfundedWinningEth = 0;
						ethToSend = 0;
					} else {
						ethToSend = underfundedWinningEth;
					}
				}
			}
		}

		(bool sent, ) = payable(owner).call{ value: ethToSend }('');
		require(sent, 'Auction failed to send raised ETH to the owner');
		emit Finalized(ethToSend, hitCap, clearingTick, totalRepPurchased, accumulatedEth);
	}

	function computeClearing()
		public
		view
		returns (bool hitCap, int256 clearingTickOut, uint256 accumulatedEth, uint256 ethAtClearingTick)
	{
		return _compute(root, 0, 0, 0, 0);
	}

	function withdrawBids(
		address withdrawFor,
		IUniformPriceDualCapBatchAuction.TickIndex[] calldata tickIndices
	) external returns (uint256 totalFilledRep, uint256 totalEthRefund) {
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
			require(bid.ethAmount > 0 && !bid.claimed, 'Bid has already been claimed or does not exist');

			uint256 activeCumulativeEthBeforeBid =
				bid.cumulativeEth - bid.ethAmount - _getRefundedCumulativeEthBeforeIndex(tick, index);
			uint256 cumulativeWinningEthBeforeBid = _getActiveEthAboveTick(root, tick) + activeCumulativeEthBeforeBid;

			if (underfunded) {
				if (underfundedWinningEth > 0 && tick >= clearingTick) {
					totalFilledRep += _allocateRepFromCumulativePosition(
						cumulativeWinningEthBeforeBid,
						bid.ethAmount,
						totalRepPurchased,
						underfundedWinningEth
					);
					// no ETH refund
				} else {
					// Loser: full ETH refund
					totalEthRefund += bid.ethAmount;
				}
			} else {
				if (tick < clearingTick) {
					// Losing bid: refund full ETH
					totalEthRefund += bid.ethAmount;
				} else if (tick > clearingTick) {
					// Fully winning: convert all ETH to REP
					totalFilledRep += _allocateRepFromCumulativePosition(
						cumulativeWinningEthBeforeBid,
						bid.ethAmount,
						PRICE_PRECISION,
						clearingPriceLocal
					);
				} else {
					// Tick == clearingTick: partial fill using FIFO within this price level.
					uint256 previousCumulativeEth = activeCumulativeEthBeforeBid;
					uint256 ethUsed;
					uint256 cumulativeEth = previousCumulativeEth + bid.ethAmount;
					if (ethFilledAtClearing <= previousCumulativeEth) {
						ethUsed = 0;
					} else if (ethFilledAtClearing >= cumulativeEth) {
						ethUsed = bid.ethAmount;
					} else {
						ethUsed = ethFilledAtClearing - previousCumulativeEth;
					}
					if (ethUsed > bid.ethAmount) ethUsed = bid.ethAmount;
					totalFilledRep += _allocateRepFromCumulativePosition(
						cumulativeWinningEthBeforeBid,
						ethUsed,
						PRICE_PRECISION,
						clearingPriceLocal
					);
					totalEthRefund += bid.ethAmount - ethUsed;
				}
			}
			bid.claimed = true;
		}

		emit WithdrawBids(withdrawFor, tickIndices, totalFilledRep, totalEthRefund);
		if (totalEthRefund > 0) {
			(bool sent, ) = payable(withdrawFor).call{ value: totalEthRefund }('');
			require(sent, 'Auction failed to refund ETH while withdrawing bids');
		}
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

		uint256 totalEthToRefund = 0;

		for (uint256 i = 0; i < tickIndices.length; i++) {
			int256 tick = tickIndices[i].tick;
			uint256 index = tickIndices[i].bidIndex;

			require(tick < foundTick, 'Binding or winning bid cannot be refunded before finalization');

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == bidder, 'Bid does not belong to the requested refund bidder');
			require(bid.ethAmount > 0 && !bid.claimed, 'Bid has already been withdrawn or does not exist');

			uint256 originalEth = bid.ethAmount;

			bid.claimed = true;
			_addRefundedBidPrefixAmount(tick, index + 1, originalEth);

			totalEthToRefund += originalEth;

			// Update tree totals to remove this losing bid
			_decreaseAtPrice(tick, originalEth);
		}

		// Send ETH back to user
		(bool sent, ) = payable(bidder).call{ value: totalEthToRefund }('');
		require(sent, 'Auction failed to refund ETH for losing bids');

		emit RefundLosingBids(bidder, tickIndices, totalEthToRefund);
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

	function _wouldClear(uint256 candidateEth, int256 tick) internal view returns (bool) {
		if (candidateEth >= ethRaiseCap) return true;
		uint256 price = tickToPrice(tick);
		if (price == 0) return false;
		uint256 rep = (candidateEth * PRICE_PRECISION) / price;
		return rep >= maxRepBeingSold;
	}

	function _isClearingTick(int256 tick) private view returns (bool) {
		return tickToPrice(tick) >= underfundedThreshold;
	}

	function _subtreeWouldClear(uint256 nodeId, uint256 accEth) internal view returns (bool) {
		if (nodeId == 0) return false;
		Node storage node = nodes[nodeId];
		if (node.subtreeClearingEth == 0) return false;
		return _wouldClear(accEth + node.subtreeClearingEth, node.minClearingTick);
	}

	function _getEthAtTick(uint256 nodeId, int256 tick) internal view returns (uint256) {
		if (nodeId == 0) return 0;
		Node storage node = nodes[nodeId];
		if (tick == node.tick) return node.totalEth;
		if (tick < node.tick) return _getEthAtTick(node.left, tick);
		return _getEthAtTick(node.right, tick);
	}

	function _isBidRefunded(int256 tick, uint256 bidIndex) internal view returns (bool) {
		uint256 refundedBefore = _getRefundedCumulativeEthBeforeIndex(tick, bidIndex);
		uint256 refundedAtOrBefore = _getRefundedCumulativeEthBeforeIndex(tick, bidIndex + 1);
		return refundedAtOrBefore > refundedBefore;
	}

	function _buildTickSummary(
		int256 tick
	) internal view returns (IUniformPriceDualCapBatchAuction.TickSummary memory) {
		uint256 currentTotalEth = _getEthAtTick(root, tick);
		return
			IUniformPriceDualCapBatchAuction.TickSummary({
				tick: tick,
				price: tickToPrice(tick),
				currentTotalEth: currentTotalEth,
				submissionCount: bidsAtTick[tick].length,
				active: currentTotalEth > 0
			});
	}

	function _buildBidView(
		int256 tick,
		uint256 bidIndex
	) internal view returns (IUniformPriceDualCapBatchAuction.BidView memory) {
		Bid storage bid = bidsAtTick[tick][bidIndex];
		uint256 activeCumulativeEthBeforeBid =
			bid.cumulativeEth - bid.ethAmount - _getRefundedCumulativeEthBeforeIndex(tick, bidIndex);
		return
			IUniformPriceDualCapBatchAuction.BidView({
				tick: tick,
				bidIndex: bidIndex,
				bidder: bid.bidder,
				ethAmount: bid.ethAmount,
				cumulativeEth: bid.cumulativeEth,
				activeCumulativeEthBeforeBid: activeCumulativeEthBeforeBid,
				claimed: bid.claimed,
				refunded: _isBidRefunded(tick, bidIndex)
			});
	}

	function _allocateRepFromCumulativePosition(
		uint256 cumulativeEthBefore,
		uint256 ethUsed,
		uint256 repNumerator,
		uint256 denominator
	) private pure returns (uint256 repShare) {
		if (ethUsed == 0 || repNumerator == 0 || denominator == 0) return 0;
		uint256 cumulativeRepBefore = Math.mulDiv(cumulativeEthBefore, repNumerator, denominator);
		uint256 cumulativeRepAfter = Math.mulDiv(cumulativeEthBefore + ethUsed, repNumerator, denominator);
		return cumulativeRepAfter - cumulativeRepBefore;
	}

	function _getActiveEthAboveTick(uint256 nodeId, int256 tick) private view returns (uint256 ethAbove) {
		if (nodeId == 0) return 0;
		Node storage node = nodes[nodeId];
		if (tick < node.tick) {
			uint256 rightEth = node.right == 0 ? 0 : nodes[node.right].subtreeEth;
			return rightEth + node.totalEth + _getActiveEthAboveTick(node.left, tick);
		}
		if (tick > node.tick) return _getActiveEthAboveTick(node.right, tick);
		return node.right == 0 ? 0 : nodes[node.right].subtreeEth;
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
		uint256 accEth,
		int256 lastValidTick,
		uint256 lastValidEth,
		uint256 lastValidEthAtTick
	) internal view returns (bool, int256, uint256, uint256) {
		if (nodeId == 0) return (false, lastValidTick, accEth, 0);
		Node storage node = nodes[nodeId];
		if (!_subtreeWouldClear(nodeId, accEth)) {
			uint256 skippedEthAtTick = _getEthAtTick(nodeId, node.minClearingTick);
			return (false, node.minClearingTick, accEth + node.subtreeClearingEth, skippedEthAtTick);
		}

		if (node.right != 0) {
			if (_subtreeWouldClear(node.right, accEth)) {
				return _compute(node.right, accEth, lastValidTick, lastValidEth, lastValidEthAtTick);
			}

			Node storage rightNode = nodes[node.right];
			accEth += rightNode.subtreeClearingEth;
			if (rightNode.subtreeClearingEth > 0) {
				lastValidTick = rightNode.minClearingTick;
				lastValidEth = accEth;
				lastValidEthAtTick = _getEthAtTick(node.right, rightNode.minClearingTick);
			}
		}

		// This node and its entire left subtree are below the cap-implied reserve.
		// They remain in subtreeEth for refunds and pagination but cannot establish
		// a funded clearing price or contribute ETH to a winning prefix.
		if (!_isClearingTick(node.tick)) return (false, lastValidTick, accEth, lastValidEthAtTick);

		uint256 price = tickToPrice(node.tick);
		uint256 ethToTake = price == 0 ? 0 : node.totalEth;
		if (accEth > 0) {
			uint256 repIfRepriced = price == 0 ? 0 : (accEth * PRICE_PRECISION) / price;
			if (repIfRepriced > maxRepBeingSold) return (true, lastValidTick, lastValidEth, lastValidEthAtTick);
		}

		if (accEth >= ethRaiseCap) return (true, lastValidTick, lastValidEth, lastValidEthAtTick);
		uint256 remainingCap = ethRaiseCap - accEth;
		if (ethToTake > remainingCap) ethToTake = remainingCap;
		uint256 newAccEth = accEth + ethToTake;

		uint256 totalRep = price == 0 ? 0 : (newAccEth * PRICE_PRECISION) / price;

		if (totalRep >= maxRepBeingSold) {
			// partial fill
			uint256 maxEthAtThisPrice = (maxRepBeingSold * price) / PRICE_PRECISION;
			uint256 ethUsedAtTick = 0;
			if (maxEthAtThisPrice > accEth) ethUsedAtTick = maxEthAtThisPrice - accEth;
			if (ethUsedAtTick > ethToTake) ethUsedAtTick = ethToTake;
			return (true, node.tick, accEth + ethUsedAtTick, ethUsedAtTick);
		}

		if (newAccEth >= ethRaiseCap) return (true, node.tick, newAccEth, ethToTake);

		accEth = newAccEth;

		lastValidTick = node.tick;
		lastValidEth = accEth;
		lastValidEthAtTick = ethToTake;

		// continue to lower prices
		return _compute(node.left, accEth, lastValidTick, lastValidEth, lastValidEthAtTick);
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

	function _insert(uint256 nodeId, int256 tick, address bidder, uint256 ethAmount) internal returns (uint256) {
		if (nodeId == 0) {
			uint256 newId = nextId++;
			uint256 nodeClearingEth = _isClearingTick(tick) ? ethAmount : 0;
			nodes[newId] = Node({
				tick: tick,
				totalEth: ethAmount,
				subtreeEth: ethAmount,
				left: 0,
				right: 0,
				height: 1,
				subtreeClearingEth: nodeClearingEth,
				minClearingTick: nodeClearingEth == 0 ? int256(0) : tick
			});
			activeTickCount += 1;

			bidsAtTick[tick].push(
				Bid({ bidder: bidder, ethAmount: ethAmount, cumulativeEth: ethAmount, claimed: false })
			);
			if (!hasSeenTick[tick]) {
				hasSeenTick[tick] = true;
				seenTicks.push(tick);
			}
			bidderBidRefs[bidder].push(BidRef({ tick: tick, bidIndex: bidsAtTick[tick].length - 1 }));

			return newId;
		}

		Node storage node = nodes[nodeId];
		if (tick == node.tick) {
			node.totalEth += ethAmount;
			uint256 cumulativeEth =
				bidsAtTick[tick].length == 0
					? ethAmount
					: bidsAtTick[tick][bidsAtTick[tick].length - 1].cumulativeEth + ethAmount;
			bidsAtTick[tick].push(
				Bid({ bidder: bidder, ethAmount: ethAmount, cumulativeEth: cumulativeEth, claimed: false })
			);
			bidderBidRefs[bidder].push(BidRef({ tick: tick, bidIndex: bidsAtTick[tick].length - 1 }));
		} else if (tick < node.tick) {
			node.left = _insert(node.left, tick, bidder, ethAmount);
		} else {
			node.right = _insert(node.right, tick, bidder, ethAmount);
		}

		_update(nodeId);
		return _balance(nodeId);
	}

	function _update(uint256 nodeId) internal {
		Node storage node = nodes[nodeId];
		uint256 leftEth;
		uint256 rightEth;
		uint256 leftH;
		uint256 rightH;
		uint256 leftClearingEth;
		uint256 rightClearingEth;
		if (node.left != 0) {
			leftEth = nodes[node.left].subtreeEth;
			leftH = nodes[node.left].height;
			leftClearingEth = nodes[node.left].subtreeClearingEth;
		}
		if (node.right != 0) {
			rightEth = nodes[node.right].subtreeEth;
			rightH = nodes[node.right].height;
			rightClearingEth = nodes[node.right].subtreeClearingEth;
		}

		uint256 nodeClearingEth = _isClearingTick(node.tick) ? node.totalEth : 0;
		node.subtreeEth = node.totalEth + leftEth + rightEth;
		node.subtreeClearingEth = nodeClearingEth + leftClearingEth + rightClearingEth;
		node.height = 1 + (leftH > rightH ? leftH : rightH);
		if (leftClearingEth > 0) {
			node.minClearingTick = nodes[node.left].minClearingTick;
		} else if (nodeClearingEth > 0) {
			node.minClearingTick = node.tick;
		} else {
			node.minClearingTick = rightClearingEth == 0 ? int256(0) : nodes[node.right].minClearingTick;
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

	function _decreaseAtPrice(int256 tick, uint256 ethAmount) internal {
		root = _decrease(root, tick, ethAmount);
	}

	function _getRefundedCumulativeEthBeforeIndex(
		int256 tick,
		uint256 index
	) internal view returns (uint256 cumulativeEth) {
		uint256 treeIndex = index;
		while (treeIndex > 0) {
			cumulativeEth += refundedBidPrefixTree[tick][treeIndex];
			treeIndex -= _leastSignificantBit(treeIndex);
		}
	}

	function _addRefundedBidPrefixAmount(int256 tick, uint256 index, uint256 amount) internal {
		uint256 bidCount = bidsAtTick[tick].length;
		uint256 treeIndex = index;
		while (treeIndex <= bidCount) {
			refundedBidPrefixTree[tick][treeIndex] += amount;
			treeIndex += _leastSignificantBit(treeIndex);
		}
	}

	function _leastSignificantBit(uint256 value) internal pure returns (uint256) {
		return value & (~value + 1);
	}

	function _decrease(uint256 nodeId, int256 tick, uint256 ethAmount) internal returns (uint256) {
		require(nodeId != 0, 'Auction tree node must exist before decreasing its ETH total');
		Node storage node = nodes[nodeId];

		if (tick < node.tick) {
			node.left = _decrease(node.left, tick, ethAmount);
		} else if (tick > node.tick) {
			node.right = _decrease(node.right, tick, ethAmount);
		} else {
			// Found node
			require(node.totalEth >= ethAmount, 'Auction tree node ETH total would underflow');
			node.totalEth -= ethAmount;

			// If node still has ETH, just update
			if (node.totalEth > 0) {
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
			node.totalEth = successor.totalEth;

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
