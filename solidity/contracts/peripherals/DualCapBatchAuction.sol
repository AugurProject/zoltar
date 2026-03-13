// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

// TODO: figure out if this can run up issues with gas and figure out how to avoid them
contract DualCapBatchAuction {
	struct Node {
		int256 tick; // ETH/REP price (tick)
		uint256 totalEth; // total ETH at this tick
		uint256 subtreeEth; // total ETH in subtree
		uint256 left;
		uint256 right;
		uint256 height;
	}

	struct Bid {
		address bidder;
		uint256 ethAmount;
		uint256 cumulativeEth;
	}

	struct TickIndex {
		int256 tick;
		uint256 bidIndex;
	}

	int256 constant MIN_TICK = -524288;
	int256 constant MAX_TICK = 524288;
	uint256 constant AUCTION_TIME = 1 weeks;
	uint256 constant PRICE_PRECISION = 1e18;
	uint256 constant MAX_NUMBER_BINDING_BIDS = 100_000;

	mapping(uint256 => Node) private nodes;
	mapping(int256 => Bid[]) private bidsAtTick;

	uint256 private root;
	uint256 private nextId = 1;

	uint256 public maxRepBeingSold;
	uint256 public ethRaiseCap;

	bool public finalized;
	int256 public clearingTick;
	uint256 public ethFilledAtClearing;
	uint256 public ethRaised; //TODO, if ethRaised is less than ethRaiseCap (underfunded), we should give all the rep we have to bidders

	uint256 public auctionStarted;
	uint256 public minBidSize;
	address public immutable owner;

	event AuctionStarted(uint256 ethRaiseCap, uint256 maxRepBeingSold, uint256 minBidSize);
	event SubmitBid(address bidder, int256 tick, uint256 amount);
	event Finalized(uint256 ethToSend, bool priceFound, int256 foundTick, uint256 repFilled, uint256 ethFilled);
	event WithdrawBids(address withdrawFor, TickIndex[] tickIndices, uint256 totalFilledRep, uint256 totalEthRefund);
	event RefundLosingBids(address bidder, TickIndex[] tickIndices, uint256 ethAmount);

	constructor(address _owner) {
		owner = _owner;
	}

	modifier isOperational {
		require(!finalized, 'finalized');
		require(block.timestamp < auctionStarted + AUCTION_TIME, 'auction ended');
		_;
	}

	function startAuction(uint256 _ethRaiseCap, uint256 _maxRepBeingSold) public {
		require(owner == msg.sender, 'only owner can start');
		require(auctionStarted == 0, 'already started');
		require(_ethRaiseCap > 0 && _maxRepBeingSold > 0, 'invalid caps');

		maxRepBeingSold = _maxRepBeingSold;
		ethRaiseCap = _ethRaiseCap;
		auctionStarted = block.timestamp;
		minBidSize = _ethRaiseCap / MAX_NUMBER_BINDING_BIDS;
		if (minBidSize < 1) minBidSize = 1;

		emit AuctionStarted(_ethRaiseCap, _maxRepBeingSold, minBidSize);
	}

	function submitBid(int256 tick) external payable isOperational {
		require(msg.value >= minBidSize, 'bid too small');
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'tick out of bounds');
		root = _insert(root, tick, msg.sender, msg.value);
		emit SubmitBid(msg.sender, tick, msg.value);
	}

	function finalize() external {
		require(!finalized, 'already finalized');
		require(msg.sender == owner, 'Only owner can finalize');

		(bool priceFound, int256 foundTick, uint256 accumulatedEth, uint256 ethAtClearingTick) = computeClearing();
		finalized = true;
		clearingTick = foundTick;
		ethFilledAtClearing = ethAtClearingTick;
		ethRaised = accumulatedEth;

		uint256 clearingPrice = tickToPrice(clearingTick);
		uint256 totalRepSold = accumulatedEth * clearingPrice / PRICE_PRECISION;
		uint256 ethToSend = accumulatedEth;
		(bool sent,) = payable(owner).call{ value: ethToSend }('');
		require(sent, 'Failed to send Ether');
		emit Finalized(ethToSend, priceFound, clearingTick, totalRepSold, accumulatedEth);
	}

	function computeClearing() public view returns (bool priceFound, int256 clearingTickOut, uint256 accumulatedEth, uint256 ethAtClearingTick) {
		return _compute(root, 0,0,0,0);
	}

	function _wouldClear(uint256 candidateEth, int256 tick) internal view returns (bool) {
		if (candidateEth >= ethRaiseCap) return true;
		uint256 price = tickToPrice(tick);
		uint256 rep = candidateEth * price / PRICE_PRECISION;
		return rep >= maxRepBeingSold;
	}

	function _compute(uint256 nodeId, uint256 accEth, int256 lastValidTick, uint256 lastValidEth, uint256 lastValidEthAtTick) internal view returns (bool, int256, uint256, uint256) {
		if (nodeId == 0) return (false, lastValidTick, accEth, 0);
		Node storage node = nodes[nodeId];
		uint256 rightEth = node.right != 0 ? nodes[node.right].subtreeEth : 0;

		if (rightEth > 0) {
			(bool found, int256 tickOut, uint256 ethOut, uint256 ethAtTickOut) = _compute(node.right, accEth, lastValidTick, lastValidEth, lastValidEthAtTick);
			if (found) return (found, tickOut, ethOut, ethAtTickOut);
			accEth = ethOut;
			lastValidTick = tickOut;
			lastValidEth = ethOut;
		}

		uint256 price = tickToPrice(node.tick);
		if (accEth > 0) {
			uint256 repIfRepriced = accEth * price / PRICE_PRECISION;
			if (repIfRepriced > maxRepBeingSold) return (true, lastValidTick, lastValidEth, lastValidEthAtTick);
		}

		if (accEth >= ethRaiseCap) return (true, lastValidTick, lastValidEth, lastValidEthAtTick);
		uint256 remainingCap = ethRaiseCap - accEth;
		uint256 ethToTake = node.totalEth;
		if (ethToTake > remainingCap) ethToTake = remainingCap;
		uint256 newAccEth = accEth + ethToTake;

		uint256 totalRep = newAccEth * price / PRICE_PRECISION;

		if (totalRep >= maxRepBeingSold) {
			// partial fill
			uint256 maxEthAtThisPrice = maxRepBeingSold * PRICE_PRECISION / price;
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

	function withdrawBids(address withdrawFor, TickIndex[] memory tickIndices) external returns (uint256 totalFilledRep, uint256 totalEthRefund) {
		require(finalized, 'not finalized');
		require(msg.sender == owner, 'Only owner can call');
		uint256 clearingPriceLocal = tickToPrice(clearingTick);

		for (uint256 i = 0; i < tickIndices.length; i++) {
			int256 tick = tickIndices[i].tick;
			uint256 index = tickIndices[i].bidIndex;

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == withdrawFor, 'not their bid');
			require(bid.ethAmount > 0, 'already claimed');
			if (tick < clearingTick) {
				// Losing bid: refund full ETH
				totalEthRefund += bid.ethAmount;
			} else if (tick > clearingTick) {
				// Fully winning: convert all ETH to REP
				totalFilledRep += bid.ethAmount * PRICE_PRECISION / clearingPriceLocal;
			} else {
				// Tick == clearingTick: partial fill
				// Determine previous cumulative ETH at this tick
				uint256 previousCumulativeEth = bid.cumulativeEth - bid.ethAmount;
				uint256 ethUsed;

				if (ethFilledAtClearing <= previousCumulativeEth) {
					ethUsed = 0; // this bid did not get filled
				} else if (ethFilledAtClearing >= bid.cumulativeEth) {
					ethUsed = bid.ethAmount; // fully filled
				} else {
					ethUsed = ethFilledAtClearing - previousCumulativeEth; // partially filled
				}

				if (ethUsed > bid.ethAmount) ethUsed = bid.ethAmount; // safety clamp
				uint256 filledRep = ethUsed * PRICE_PRECISION / clearingPriceLocal;

				totalFilledRep += filledRep;
				totalEthRefund += bid.ethAmount - ethUsed;
			}
			bid.ethAmount = 0; // prevent double withdrawals
		}
		if (totalEthRefund > 0) {
			(bool sent,) = payable(withdrawFor).call{ value: totalEthRefund }('');
			require(sent, 'eth transfer failed');
		}
		emit WithdrawBids(withdrawFor, tickIndices, totalFilledRep, totalEthRefund);
	}

	function _insert(uint256 nodeId, int256 tick, address bidder, uint256 ethAmount) internal returns (uint256) {
		if (nodeId == 0) {
			uint256 newId = nextId++;
			nodes[newId] = Node({ tick: tick, totalEth: ethAmount, subtreeEth: ethAmount, left: 0, right: 0, height: 1 });

			bidsAtTick[tick].push(Bid({ bidder: bidder, ethAmount: ethAmount, cumulativeEth: ethAmount }));

			return newId;
		}

		Node storage node = nodes[nodeId];
		if (tick == node.tick) {
			node.totalEth += ethAmount;
			uint256 cumulativeEth = bidsAtTick[tick].length == 0 ? ethAmount : bidsAtTick[tick][bidsAtTick[tick].length - 1].cumulativeEth + ethAmount;
			bidsAtTick[tick].push(Bid({ bidder: bidder, ethAmount: ethAmount, cumulativeEth: cumulativeEth }));
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
		uint256 leftEth; uint256 rightEth; uint256 leftH; uint256 rightH;
		if (node.left != 0) {
			leftEth = nodes[node.left].subtreeEth;
			leftH = nodes[node.left].height;
		}
		if (node.right != 0) {
			rightEth = nodes[node.right].subtreeEth;
			rightH = nodes[node.right].height;
		}

		node.subtreeEth = node.totalEth + leftEth + rightEth;
		node.height = 1 + (leftH > rightH ? leftH : rightH);
	}

	function _height(uint256 nodeId) internal view returns (uint256) { return nodeId == 0 ? 0 : nodes[nodeId].height; }

	function _balance(uint256 nodeId) internal returns (uint256) {
		int256 balance = int256(_height(nodes[nodeId].left)) - int256(_height(nodes[nodeId].right));
		if (balance > 1) {
			if (_height(nodes[nodes[nodeId].left].left) < _height(nodes[nodes[nodeId].left].right)) nodes[nodeId].left = _rotateLeft(nodes[nodeId].left);
			return _rotateRight(nodeId);
		}
		if (balance < -1) {
			if (_height(nodes[nodes[nodeId].right].right) < _height(nodes[nodes[nodeId].right].left)) nodes[nodeId].right = _rotateRight(nodes[nodeId].right);
			return _rotateLeft(nodeId);
		}
		return nodeId;
	}

	function _rotateLeft(uint256 nodeId) internal returns (uint256) {
		uint256 newRoot = nodes[nodeId].right;
		uint256 moved = nodes[newRoot].left;
		nodes[newRoot].left = nodeId;
		nodes[nodeId].right = moved;
		_update(nodeId); _update(newRoot);
		return newRoot;
	}

	function _rotateRight(uint256 nodeId) internal returns (uint256) {
		uint256 newRoot = nodes[nodeId].left;
		uint256 moved = nodes[newRoot].right;
		nodes[newRoot].right = nodeId;
		nodes[nodeId].left = moved;
		_update(nodeId); _update(newRoot);
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
		revert('Index out of bounds');
	}

	function tickToPrice(int256 tick) public pure returns (uint256 price) {
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'tick out of bounds');
		uint256 absTick = tick < 0 ? uint256(-tick) : uint256(tick);
		price = PRICE_PRECISION;
		for (uint8 i = 0; i < 20; i++) {
			if ((absTick & (1 << i)) != 0) price = price * powerOf1Point0001(i) / PRICE_PRECISION;
		}
		if (tick < 0) price = PRICE_PRECISION * PRICE_PRECISION / price;
	}

	function refundLosingBids(TickIndex[] memory tickIndices) external {
		require(!finalized, 'already finalized');

		(bool priceFound, int256 foundTick,, ) = computeClearing();
		require(priceFound, 'no clearing yet');

		uint256 totalEthToRefund = 0;

		for (uint256 i = 0; i < tickIndices.length; i++) {
			int256 tick = tickIndices[i].tick;
			uint256 index = tickIndices[i].bidIndex;

			require(tick < foundTick, 'cannot withdraw binding bid');

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == msg.sender, 'not bidder');
			require(bid.ethAmount > 0, 'already withdrawn');

			uint256 originalEth = bid.ethAmount;

			// Zero out bid to prevent double withdrawal
			bid.ethAmount = 0;

			totalEthToRefund += originalEth;

			// Update tree totals to remove this losing bid
			_decreaseAtPrice(tick, originalEth);
		}

		// Send ETH back to user
		(bool sent,) = payable(msg.sender).call{ value: totalEthToRefund }('');
		require(sent, 'transfer failed');

		emit RefundLosingBids(msg.sender, tickIndices, totalEthToRefund);
	}

	function _decreaseAtPrice(int256 tick, uint256 ethAmount) internal {
		root = _decrease(root, tick, ethAmount);
	}

	function _decrease(uint256 nodeId, int256 tick, uint256 ethAmount) internal returns (uint256) {
		require(nodeId != 0, 'invalid node');
		Node storage node = nodes[nodeId];

		if (tick < node.tick) {
			node.left = _decrease(node.left, tick, ethAmount);
		} else if (tick > node.tick) {
			node.right = _decrease(node.right, tick, ethAmount);
		} else {
			// Found node
			require(node.totalEth >= ethAmount, 'eth underflow');
			node.totalEth -= ethAmount;

			// If node still has ETH, just update
			if (node.totalEth > 0) {
				_update(nodeId);
				return _balance(nodeId);
			}

			// Node empty → delete
			return _delete(nodeId, tick);
		}

		_update(nodeId);
		return _balance(nodeId);
	}

	function _delete(uint256 nodeId, int256 tick) internal returns (uint256) {
		require(nodeId != 0, 'delete missing');
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
}
