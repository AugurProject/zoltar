// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
uint256 constant AUCTION_TIME = 1 weeks;

contract DualCapBatchAuction {
	struct Node {
		int256 tick; // ETH per REP
		uint256 totalRepAtPrice; // sum(msg.value / price)
		uint256 totalEthAtPrice; // sum(msg.value)

		uint256 subtreeTotalRep;
		uint256 subtreeTotalEth;

		uint256 left;
		uint256 right;
		uint256 height;
	}
	uint256 constant PRICE_PRECISION = 1e18;
	uint256 constant MAX_NUMBER_BINDING_BIDS = 100_000; // todo, check with gas for worst cases
	uint256 public minBidSize;

	mapping(uint256 => Node) private nodes;

	struct Bid {
		address bidder;
		uint256 ethAmount;
		uint256 repAmount; // ethAmount * PRICE_PRECISION / price
		uint256 cumulativeRep; // running total at this price
	}

	struct TickIndex {
		int256 tick;
		uint256 bidIndex;
	}

	uint256 private root;
	uint256 private nextId = 1;

	uint256 public maxRepBeingSold;
	uint256 public ethRaiseCap;

	bool public finalized;
	int256 public clearingTick;

	uint256 public repFilledAtClearing;

	uint256 public auctionStarted;
	address public owner;

	uint256 public totalRepAtClearingTick;

	mapping(int256 => Bid[]) private bidsAtTick;
	mapping(int256 => uint256) private nodeIdByTick;

	event AuctionStarted(uint256 ethRaiseCap, uint256 maxRepBeingSold, uint256 minBidSize);
	event SubmitBid(address bidder, int256 tick, uint256 amount);
	event Finalized(uint256 ethToSend, bool priceFound, int256 foundTick, uint256 repAbove, uint256 ethAbove);
	event WithdrawBids(address withdrawFor, TickIndex[] tickIndice, uint256 totalFilledRep, uint256 totalEthRefund);
	event RefundLosingBids(address bidder, TickIndex[] tickIndice, uint256 ethAmount);

	uint256 internal constant FIXED_POINT_SCALING_FACTOR = 1e18;

	function powerOf1_0001(uint8 index) internal pure returns (uint256) {
		if (index == 0) return 1000100000000000000; // 1.0001^1
		if (index == 1) return 1000200010000000000; // 1.0001^2
		if (index == 2) return 1000400060004000100; // 1.0001^4
		if (index == 3) return 1000800280056007000; // 1.0001^8
		if (index == 4) return 1001601200560182043; // 1.0001^16
		if (index == 5) return 1003204964963598014; // 1.0001^32
		if (index == 6) return 1006420201727613920; // 1.0001^64
		if (index == 7) return 1012881622445451097; // 1.0001^128
		if (index == 8) return 1025929181087729343; // 1.0001^256
		if (index == 9) return 1052530684607338948; // 1.0001^512
		if (index == 10) return 1107820842039993613; // 1.0001^1024
		if (index == 11) return 1227267018058200482; // 1.0001^2048
		if (index == 12) return 1506184333613467388; // 1.0001^4096
		if (index == 13) return 2268591246822644826; // 1.0001^8192
		if (index == 14) return 5146506245160322222; // 1.0001^16384
		if (index == 15) return 26486526531474198664; // 1.0001^32768
		if (index == 16) return 701536087702486644953; // 1.0001^65536
		if (index == 17) return 492152882348911033633683; // 1.0001^131072
		if (index == 18) return 242214459604341065650571799093; // 1.0001^262144
		if (index == 19) return 58667844441422969901301586347865591163491; // 1.0001^524288
		revert('Index out of bounds');
	}

	// Computes 1.0001 ^ tick in 18-decimal fixed point
	function tickToPrice(int256 tick) internal pure returns (uint256 price) {
		require(tick >= -524288 && tick <= 524288, 'tick out of bounds');
		uint256 absTick = tick < 0 ? uint256(-tick) : uint256(tick);
		price = FIXED_POINT_SCALING_FACTOR;

		for (uint8 i = 0; i < 20; i++) {
			if ((absTick & (1 << i)) != 0) price = price * powerOf1_0001(i) / FIXED_POINT_SCALING_FACTOR;
		}

		if (tick < 0) price = FIXED_POINT_SCALING_FACTOR * FIXED_POINT_SCALING_FACTOR / price;
	}

	modifier isOperational {
		require(!finalized, 'finalized');
		require(block.timestamp < auctionStarted + AUCTION_TIME, 'Auction ended');
		_;
	}

	constructor(address _owner) {
		owner = _owner;
	}

	function startAuction(uint256 _ethRaiseCap, uint256 _maxRepBeingSold) public {
		require(_ethRaiseCap > 0, 'invalid ethRaiseCap');
		require(_maxRepBeingSold > 0, 'invalid maxRepBeingSold');
		require(owner == msg.sender, 'only owner can start');
		require(auctionStarted == 0, 'already started');
		maxRepBeingSold = _maxRepBeingSold;
		ethRaiseCap = _ethRaiseCap;
		auctionStarted = block.timestamp;
		minBidSize = _ethRaiseCap / MAX_NUMBER_BINDING_BIDS;
		if (minBidSize < 1) minBidSize = 1;
		emit AuctionStarted(_ethRaiseCap, _maxRepBeingSold, minBidSize);
	}

	function submitBid(int256 tick) external payable isOperational {
		require(!finalized, 'finalized');
		require(msg.value >= minBidSize, 'invalid');
		require(tick >= -524288 && tick <= 524288, 'tick out of bounds');
		root = _insert(root, tick, msg.sender, msg.value);
		emit SubmitBid(msg.sender, tick, msg.value);
	}

	function finalize() external {
		require(!finalized, 'already finalized');
		require(msg.sender == owner, 'Only owner can finalize');

		// Compute clearing normally
		(bool priceFound, int256 foundTick, uint256 repAbove, uint256 ethAbove) = computeClearing();

		finalized = true;

		uint256 ethToSend;
		uint256 clearingPriceLocal;

		if (!priceFound) {
			// Underfunded: uniform price = lowest tick
			uint256 lowestNodeId = _minNode(root);
			int256 lowestTick = nodes[lowestNodeId].tick;

			clearingTick = lowestTick;
			clearingPriceLocal = tickToPrice(clearingTick);

			// Total REP in the entire tree
			uint256 totalRep = nodes[root].subtreeTotalRep;

			repFilledAtClearing = totalRep;
			totalRepAtClearingTick = nodes[lowestNodeId].totalRepAtPrice;

			ethToSend = totalRep * clearingPriceLocal / PRICE_PRECISION;

		} else {
			// Caps bind -> normal clearing
			clearingTick = foundTick;
			clearingPriceLocal = tickToPrice(clearingTick);

			uint256 repNeeded = maxRepBeingSold - repAbove;

			uint256 nodeId = nodeIdByTick[clearingTick];
			Node storage clearingNode = nodes[nodeId];

			uint256 nodeRep = clearingNode.totalRepAtPrice;
			totalRepAtClearingTick = nodeRep;

			uint256 repFilled = repNeeded;
			if (repFilled > nodeRep) repFilled = nodeRep;

			repFilledAtClearing = repFilled;

			uint256 ethFromClearing = repFilled * clearingPriceLocal / PRICE_PRECISION;
			ethToSend = ethAbove + ethFromClearing;
			if (ethToSend > ethRaiseCap) ethToSend = ethRaiseCap;
		}

		// Send ETH to owner
		(bool sent,) = payable(owner).call{ value: ethToSend }('');
		require(sent, 'Failed to send Ether');

		emit Finalized(ethToSend, priceFound, clearingTick, repAbove, ethAbove);
	}

	function computeClearing() public view returns (bool priceFound, int256 foundTick, uint256 repAbove, uint256 ethAbove) {
		uint256 current = root;
		uint256 accumulatedRep;
		uint256 accumulatedEth;

		while (current != 0) {
			Node storage node = nodes[current];
			uint256 rightRep = node.right == 0 ? 0 : nodes[node.right].subtreeTotalRep;
			uint256 rightEth = node.right == 0 ? 0 : nodes[node.right].subtreeTotalEth;
			if (accumulatedRep + rightRep <= maxRepBeingSold && accumulatedEth + rightEth <= ethRaiseCap) {
				accumulatedRep += rightRep;
				accumulatedEth += rightEth;
				uint256 nodeRep = node.totalRepAtPrice;
				uint256 nodeEth = node.totalEthAtPrice;
				if (accumulatedRep + nodeRep >= maxRepBeingSold || accumulatedEth + nodeEth >= ethRaiseCap) return (true, node.tick, accumulatedRep, accumulatedEth);
				accumulatedRep += nodeRep;
				accumulatedEth += nodeEth;
				current = node.left;
			} else {
				current = node.right;
			}
		}
		return (false, 0, accumulatedRep, accumulatedEth);
	}

	// doesn't actually withdraw rep, the rep is held in custody of owner. This is why only owner can call so it can do the accounting
	function withdrawBids(address withdrawFor, TickIndex[] memory tickIndice) external returns (uint256 totalFilledRep, uint256 totalEthRefund) {
		require(finalized, 'not finalized');
		require(msg.sender == owner, 'Only owner can call');

		uint256 clearingPriceLocal = tickToPrice(clearingTick);

		for (uint256 i = 0; i < tickIndice.length; i++) {
			int256 tick = tickIndice[i].tick;
			uint256 index = tickIndice[i].bidIndex;

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == withdrawFor, 'not their bid');
			require(bid.ethAmount > 0, 'already claimed');

			uint256 originalEth = bid.ethAmount;
			uint256 originalRep = bid.repAmount;

			// Zero out the bid to prevent double withdrawals
			bid.ethAmount = 0;
			bid.repAmount = 0;

			if (tick < clearingTick) {
				// Losing bid: refund full ETH
				totalEthRefund += originalEth;
			} else if (tick == clearingTick) {
				// Bid at clearing tick: partially filled based on cumulativeRep
				uint256 previousCumulative = bid.cumulativeRep - originalRep;

				uint256 filledRep;
				uint256 usedEth;
				if (previousCumulative >= repFilledAtClearing) {
					filledRep = 0;
				} else if (bid.cumulativeRep <= repFilledAtClearing) {
					filledRep = originalRep;
				} else {
					filledRep = repFilledAtClearing - previousCumulative;
				}

				usedEth = filledRep * clearingPriceLocal / PRICE_PRECISION;
				totalFilledRep += filledRep;
				if (originalEth > usedEth) {
					totalEthRefund += originalEth - usedEth;
				}
			} else {
				// Tick above clearing tick: fully winning, convert ETH to REP at clearing price
				totalFilledRep += originalEth * PRICE_PRECISION / clearingPriceLocal;
			}
		}

		if (totalEthRefund > 0) {
			(bool sent,) = payable(withdrawFor).call{ value: totalEthRefund }('');
			require(sent, 'eth transfer failed');
		}

		emit WithdrawBids(withdrawFor, tickIndice, totalFilledRep, totalEthRefund);
	}

	function _decrease(uint256 nodeId, int256 tick, uint256 repAmount, uint256 ethAmount) internal returns (uint256) {
		require(nodeId != 0, 'invalid node');
		Node storage node = nodes[nodeId];
		if (tick < node.tick) {
			node.left = _decrease(node.left, tick, repAmount, ethAmount);
		} else if (tick > node.tick) {
			node.right = _decrease(node.right, tick, repAmount, ethAmount);
		} else {
			// Found node

			require(node.totalRepAtPrice >= repAmount, 'rep underflow');
			require(node.totalEthAtPrice >= ethAmount, 'eth underflow');

			node.totalRepAtPrice -= repAmount;
			node.totalEthAtPrice -= ethAmount;

			// If still non-empty, just update
			if (node.totalRepAtPrice > 0) {
				_update(nodeId);
				return _balance(nodeId);
			}

			// Node empty -> delete
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
			// Found node to delete

			// Case 1: no child
			if (node.left == 0 && node.right == 0) {
				delete nodeIdByTick[node.tick];
				delete nodes[nodeId];
				return 0;
			}

			// Case 2: one child
			if (node.left == 0) {
				uint256 rightChild = node.right;
				delete nodeIdByTick[node.tick];
				delete nodes[nodeId];
				return rightChild;
			}

			if (node.right == 0) {
				uint256 leftChild = node.left;
				delete nodeIdByTick[node.tick];
				delete nodes[nodeId];
				return leftChild;
			}

			// Case 3: two children
			uint256 successorId = _minNode(node.right);
			Node storage successor = nodes[successorId];

			// Remove old price mapping
			delete nodeIdByTick[node.tick];

			// Copy successor data into current node
			node.tick = successor.tick;
			node.totalRepAtPrice = successor.totalRepAtPrice;
			node.totalEthAtPrice = successor.totalEthAtPrice;

			// Update mapping
			nodeIdByTick[node.tick] = nodeId;

			// Delete successor from right subtree
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

	function _decreaseAtPrice(int256 tick, uint256 repAmount, uint256 ethAmount) internal {
		uint256 nodeId = nodeIdByTick[tick];
		require(nodeId != 0, 'tick missing');
		root = _decrease(root, tick, repAmount, ethAmount);
	}

	// user can withdraw bid only if the auction is fully funded and they are below clearing
	function refundLosingBids(TickIndex[] memory tickIndice) external {
		require(!finalized, 'already finalized');

		(bool priceFound, int256 foundTick,,) = computeClearing();
		require(priceFound, 'no clearing yet');

		uint256 totalEthToRefund = 0;

		for (uint256 i = 0; i < tickIndice.length; i++) {
			int256 tick = tickIndice[i].tick;
			uint256 index = tickIndice[i].bidIndex;

			require(tick < foundTick, 'cannot withdraw binding bid');

			Bid storage bid = bidsAtTick[tick][index];
			require(bid.bidder == msg.sender, 'not bidder');
			require(bid.ethAmount > 0, 'already withdrawn');

			uint256 originalEth = bid.ethAmount;
			uint256 repAmount = bid.repAmount;

			// Zero out bid to prevent double withdrawal
			bid.ethAmount = 0;
			bid.repAmount = 0;

			totalEthToRefund += originalEth;

			// Update tree totals to remove this losing bid
			_decreaseAtPrice(tick, repAmount, originalEth);
		}

		// Send ETH back to user
		(bool sent,) = payable(msg.sender).call{ value: totalEthToRefund }('');
		require(sent, 'transfer failed');

		emit RefundLosingBids(msg.sender, tickIndice, totalEthToRefund);
	}

	function _insert(uint256 nodeId, int256 tick, address bidder, uint256 ethAmount) internal returns (uint256) {
		uint256 repDemand = ethAmount * PRICE_PRECISION / tickToPrice(tick);
		require(repDemand > 0, 'bid too small');

		// If tree node does not exist, create it
		if (nodeId == 0) {
			uint256 newId = nextId++;
			nodes[newId] = Node({ tick: tick, totalRepAtPrice: repDemand, totalEthAtPrice: ethAmount, subtreeTotalRep: repDemand, subtreeTotalEth: ethAmount, left: 0, right: 0, height: 1 });
			nodeIdByTick[tick] = newId;
			// Initialize the ordered bid list for this price
			Bid[] storage priceBids = bidsAtTick[tick];
			priceBids.push(Bid({ bidder: bidder, ethAmount: ethAmount, repAmount: repDemand, cumulativeRep: repDemand }));
			return newId;
		}

		Node storage node = nodes[nodeId];

		if (tick == node.tick) {
			// Same price node → update totals
			node.totalRepAtPrice += repDemand;
			node.totalEthAtPrice += ethAmount;
			Bid[] storage priceBids = bidsAtTick[tick];
			uint256 cumulative = priceBids.length == 0 ? repDemand : priceBids[priceBids.length - 1].cumulativeRep + repDemand;
			priceBids.push(Bid({ bidder: bidder, ethAmount: ethAmount, repAmount: repDemand, cumulativeRep: cumulative }));
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
		uint256 leftSubtreeRep;
		uint256 leftSubtreeEth;
		uint256 leftHeight;
		if (node.left != 0) {
			Node storage leftNode = nodes[node.left];
			leftSubtreeRep = leftNode.subtreeTotalRep;
			leftSubtreeEth = leftNode.subtreeTotalEth;
			leftHeight = leftNode.height;
		}
		uint256 rightSubtreeRep;
		uint256 rightSubtreeEth;
		uint256 rightHeight;
		if (node.right != 0) {
			Node storage rightNode = nodes[node.right];
			rightSubtreeRep = rightNode.subtreeTotalRep;
			rightSubtreeEth = rightNode.subtreeTotalEth;
			rightHeight = rightNode.height;
		}

		node.subtreeTotalRep = leftSubtreeRep + rightSubtreeRep + node.totalRepAtPrice;
		node.subtreeTotalEth = leftSubtreeEth + rightSubtreeEth + node.totalEthAtPrice;
		node.height = 1 + (leftHeight > rightHeight ? leftHeight : rightHeight);
	}

	function _height(uint256 nodeId) internal view returns (uint256) {
		return nodeId == 0 ? 0 : nodes[nodeId].height;
	}

	function _balance(uint256 nodeId) internal returns (uint256) {
		uint256 leftChild = nodes[nodeId].left;
		uint256 rightChild = nodes[nodeId].right;

		int256 balanceFactor = int256(_height(leftChild)) - int256(_height(rightChild));
		if (balanceFactor > 1) {
			if (leftChild != 0 && _height(nodes[leftChild].left) < _height(nodes[leftChild].right)) {
				nodes[nodeId].left = _rotateLeft(leftChild);
			}
			return _rotateRight(nodeId);
		}

		if (balanceFactor < -1) {
			if (rightChild != 0 && _height(nodes[rightChild].right) < _height(nodes[rightChild].left)) {
				nodes[nodeId].right = _rotateRight(rightChild);
			}
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
}
