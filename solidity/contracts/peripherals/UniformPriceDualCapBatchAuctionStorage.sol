// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

library UniformPriceDualCapBatchAuctionStorage {
	struct Node {
		int256 tick;
		uint256 totalBidAttoEth;
		uint256 subtreeBidAttoEth;
		uint256 left;
		uint256 right;
		uint256 height;
		uint256 subtreeClearingBidAttoEth;
		int256 minClearingTick;
	}

	struct ClearingConfig {
		uint256 attoEthRaiseCap;
		uint256 maxAttoRepBeingSold;
		uint256 underfundedThreshold;
	}

	struct ClearingCursor {
		uint256 accumulatedBidAttoEth;
		int256 lastValidTick;
		uint256 lastValidBidAttoEth;
		uint256 lastValidBidAtTickAttoEth;
	}

	int256 internal constant MIN_TICK = -524288;
	int256 internal constant MAX_TICK = 524288;
	uint256 internal constant PRICE_PRECISION = 1e18;

	function allocateFromCumulativePosition(uint256 cumulativeAmountBefore, uint256 amountUsed, uint256 allocationNumerator, uint256 denominator) internal pure returns (uint256 allocation) {
		if (amountUsed == 0 || allocationNumerator == 0 || denominator == 0) return 0;
		uint256 cumulativeAllocationBefore = Math.mulDiv(cumulativeAmountBefore, allocationNumerator, denominator);
		uint256 cumulativeAllocationAfter = Math.mulDiv(cumulativeAmountBefore + amountUsed, allocationNumerator, denominator);
		return cumulativeAllocationAfter - cumulativeAllocationBefore;
	}

	function tickToPrice(int256 tick) internal pure returns (uint256 price) {
		require(tick >= MIN_TICK && tick <= MAX_TICK, 'Auction tick is outside the supported price range');
		uint256 absTick = tick < 0 ? uint256(-tick) : uint256(tick);
		price = PRICE_PRECISION;
		for (uint8 i = 0; i < 20; i++) {
			if ((absTick & (1 << i)) != 0) price = (price * _powerOf1Point0001(i)) / PRICE_PRECISION;
		}
		if (tick < 0) price = (PRICE_PRECISION * PRICE_PRECISION) / price;
	}

	function getBidAttoEthAtTick(mapping(uint256 => Node) storage nodes, uint256 nodeId, int256 tick) internal view returns (uint256) {
		if (nodeId == 0) return 0;
		Node storage node = nodes[nodeId];
		if (tick == node.tick) return node.totalBidAttoEth;
		if (tick < node.tick) return getBidAttoEthAtTick(nodes, node.left, tick);
		return getBidAttoEthAtTick(nodes, node.right, tick);
	}

	function getActiveBidAttoEthAboveTick(mapping(uint256 => Node) storage nodes, uint256 nodeId, int256 tick) internal view returns (uint256 bidAttoEthAbove) {
		if (nodeId == 0) return 0;
		Node storage node = nodes[nodeId];
		if (tick < node.tick) {
			uint256 rightBidAttoEth = node.right == 0 ? 0 : nodes[node.right].subtreeBidAttoEth;
			return rightBidAttoEth + node.totalBidAttoEth + getActiveBidAttoEthAboveTick(nodes, node.left, tick);
		}
		if (tick > node.tick) return getActiveBidAttoEthAboveTick(nodes, node.right, tick);
		return node.right == 0 ? 0 : nodes[node.right].subtreeBidAttoEth;
	}

	function computeClearing(mapping(uint256 => Node) storage nodes, uint256 root, ClearingConfig memory config) internal view returns (bool, int256, uint256, uint256) {
		return
			_compute(nodes, root, config, ClearingCursor({accumulatedBidAttoEth: 0, lastValidTick: 0, lastValidBidAttoEth: 0, lastValidBidAtTickAttoEth: 0}));
	}

	function insert(mapping(uint256 => Node) storage nodes, uint256 nodeId, int256 tick, uint256 bidAmountAttoEth, uint256 underfundedThreshold, uint256 nextId) internal returns (uint256 newRoot, uint256 newNextId, bool insertedNewTick) {
		if (nodeId == 0) {
			uint256 nodeClearingBidAttoEth = _isClearingTick(tick, underfundedThreshold) ? bidAmountAttoEth : 0;
			nodes[nextId] = Node({tick: tick, totalBidAttoEth: bidAmountAttoEth, subtreeBidAttoEth: bidAmountAttoEth, left: 0, right: 0, height: 1, subtreeClearingBidAttoEth: nodeClearingBidAttoEth, minClearingTick: nodeClearingBidAttoEth == 0 ? int256(0) : tick});
			return (nextId, nextId + 1, true);
		}

		Node storage node = nodes[nodeId];
		newNextId = nextId;
		if (tick == node.tick) {
			node.totalBidAttoEth += bidAmountAttoEth;
		} else if (tick < node.tick) {
			(node.left, newNextId, insertedNewTick) = insert(nodes, node.left, tick, bidAmountAttoEth, underfundedThreshold, nextId);
		} else {
			(node.right, newNextId, insertedNewTick) = insert(nodes, node.right, tick, bidAmountAttoEth, underfundedThreshold, nextId);
		}
		_update(nodes, nodeId, underfundedThreshold);
		return (_balance(nodes, nodeId, underfundedThreshold), newNextId, insertedNewTick);
	}

	function decrease(mapping(uint256 => Node) storage nodes, uint256 root, int256 tick, uint256 bidAmountAttoEth, uint256 underfundedThreshold) internal returns (uint256 newRoot, bool removedTick) {
		return _decrease(nodes, root, tick, bidAmountAttoEth, underfundedThreshold);
	}

	function refundedCumulativeBefore(mapping(int256 => mapping(uint256 => uint256)) storage refundedBidPrefixTree, int256 tick, uint256 index) internal view returns (uint256 cumulativeBidAttoEth) {
		uint256 treeIndex = index;
		while (treeIndex > 0) {
			cumulativeBidAttoEth += refundedBidPrefixTree[tick][treeIndex];
			treeIndex -= _leastSignificantBit(treeIndex);
		}
	}

	function addRefundedPrefixAmount(mapping(int256 => mapping(uint256 => uint256)) storage refundedBidPrefixTree, int256 tick, uint256 bidCount, uint256 index, uint256 amountAttoEth) internal {
		uint256 treeIndex = index;
		while (treeIndex <= bidCount) {
			refundedBidPrefixTree[tick][treeIndex] += amountAttoEth;
			treeIndex += _leastSignificantBit(treeIndex);
		}
	}

	function initializeRefundPrefixEntry(mapping(int256 => mapping(uint256 => uint256)) storage refundedBidPrefixTree, int256 tick, uint256 bidIndex) internal {
		uint256 treeIndex = bidIndex + 1;
		uint256 leastSignificantBit = _leastSignificantBit(treeIndex);
		refundedBidPrefixTree[tick][treeIndex] =
			refundedCumulativeBefore(refundedBidPrefixTree, tick, bidIndex) -
			refundedCumulativeBefore(refundedBidPrefixTree, tick, treeIndex - leastSignificantBit);
	}

	function _compute(mapping(uint256 => Node) storage nodes, uint256 nodeId, ClearingConfig memory config, ClearingCursor memory cursor) private view returns (bool, int256, uint256, uint256) {
		if (nodeId == 0) return (false, cursor.lastValidTick, cursor.accumulatedBidAttoEth, 0);
		Node storage node = nodes[nodeId];
		if (!_subtreeWouldClear(nodes, nodeId, cursor.accumulatedBidAttoEth, config)) {
			return (
				false,
				node.minClearingTick,
				cursor.accumulatedBidAttoEth + node.subtreeClearingBidAttoEth,
				getBidAttoEthAtTick(nodes, nodeId, node.minClearingTick)
			);
		}

		if (node.right != 0) {
			if (_subtreeWouldClear(nodes, node.right, cursor.accumulatedBidAttoEth, config))
				return _compute(nodes, node.right, config, cursor);
			Node storage rightNode = nodes[node.right];
			cursor.accumulatedBidAttoEth += rightNode.subtreeClearingBidAttoEth;
			if (rightNode.subtreeClearingBidAttoEth > 0) {
				cursor.lastValidTick = rightNode.minClearingTick;
				cursor.lastValidBidAttoEth = cursor.accumulatedBidAttoEth;
				cursor.lastValidBidAtTickAttoEth = getBidAttoEthAtTick(nodes, node.right, rightNode.minClearingTick);
			}
		}

		if (!_isClearingTick(node.tick, config.underfundedThreshold))
			return (false, cursor.lastValidTick, cursor.accumulatedBidAttoEth, cursor.lastValidBidAtTickAttoEth);
		uint256 price = tickToPrice(node.tick);
		uint256 bidToTakeAttoEth = price == 0 ? 0 : node.totalBidAttoEth;
		if (
			cursor.accumulatedBidAttoEth > 0 &&
			(cursor.accumulatedBidAttoEth * PRICE_PRECISION) / price > config.maxAttoRepBeingSold
		) return (true, cursor.lastValidTick, cursor.lastValidBidAttoEth, cursor.lastValidBidAtTickAttoEth);
		if (cursor.accumulatedBidAttoEth >= config.attoEthRaiseCap)
			return (true, cursor.lastValidTick, cursor.lastValidBidAttoEth, cursor.lastValidBidAtTickAttoEth);
		uint256 remainingCap = config.attoEthRaiseCap - cursor.accumulatedBidAttoEth;
		if (bidToTakeAttoEth > remainingCap) bidToTakeAttoEth = remainingCap;
		uint256 newAccumulatedBidAttoEth = cursor.accumulatedBidAttoEth + bidToTakeAttoEth;
		if ((newAccumulatedBidAttoEth * PRICE_PRECISION) / price >= config.maxAttoRepBeingSold) {
			uint256 maximumBidAtThisPriceAttoEth = (config.maxAttoRepBeingSold * price) / PRICE_PRECISION;
			uint256 bidUsedAtTickAttoEth =
				maximumBidAtThisPriceAttoEth > cursor.accumulatedBidAttoEth
					? maximumBidAtThisPriceAttoEth - cursor.accumulatedBidAttoEth
					: 0;
			if (bidUsedAtTickAttoEth > bidToTakeAttoEth) bidUsedAtTickAttoEth = bidToTakeAttoEth;
			return (true, node.tick, cursor.accumulatedBidAttoEth + bidUsedAtTickAttoEth, bidUsedAtTickAttoEth);
		}
		if (newAccumulatedBidAttoEth >= config.attoEthRaiseCap)
			return (true, node.tick, newAccumulatedBidAttoEth, bidToTakeAttoEth);
		cursor.accumulatedBidAttoEth = newAccumulatedBidAttoEth;
		cursor.lastValidTick = node.tick;
		cursor.lastValidBidAttoEth = newAccumulatedBidAttoEth;
		cursor.lastValidBidAtTickAttoEth = bidToTakeAttoEth;
		return _compute(nodes, node.left, config, cursor);
	}

	function _subtreeWouldClear(mapping(uint256 => Node) storage nodes, uint256 nodeId, uint256 accumulatedBidAttoEth, ClearingConfig memory config) private view returns (bool) {
		if (nodeId == 0 || nodes[nodeId].subtreeClearingBidAttoEth == 0) return false;
		Node storage node = nodes[nodeId];
		uint256 candidateBidAttoEth = accumulatedBidAttoEth + node.subtreeClearingBidAttoEth;
		if (candidateBidAttoEth >= config.attoEthRaiseCap) return true;
		return
			(candidateBidAttoEth * PRICE_PRECISION) / tickToPrice(node.minClearingTick) >= config.maxAttoRepBeingSold;
	}

	function _isClearingTick(int256 tick, uint256 underfundedThreshold) private pure returns (bool) {
		return tickToPrice(tick) >= underfundedThreshold;
	}

	function _update(mapping(uint256 => Node) storage nodes, uint256 nodeId, uint256 underfundedThreshold) private {
		Node storage node = nodes[nodeId];
		uint256 leftBidAttoEth = node.left == 0 ? 0 : nodes[node.left].subtreeBidAttoEth;
		uint256 rightBidAttoEth = node.right == 0 ? 0 : nodes[node.right].subtreeBidAttoEth;
		uint256 leftHeight = node.left == 0 ? 0 : nodes[node.left].height;
		uint256 rightHeight = node.right == 0 ? 0 : nodes[node.right].height;
		uint256 leftClearingBidAttoEth = node.left == 0 ? 0 : nodes[node.left].subtreeClearingBidAttoEth;
		uint256 rightClearingBidAttoEth = node.right == 0 ? 0 : nodes[node.right].subtreeClearingBidAttoEth;
		uint256 nodeClearingBidAttoEth = _isClearingTick(node.tick, underfundedThreshold) ? node.totalBidAttoEth : 0;
		node.subtreeBidAttoEth = node.totalBidAttoEth + leftBidAttoEth + rightBidAttoEth;
		node.subtreeClearingBidAttoEth = nodeClearingBidAttoEth + leftClearingBidAttoEth + rightClearingBidAttoEth;
		node.height = 1 + (leftHeight > rightHeight ? leftHeight : rightHeight);
		if (leftClearingBidAttoEth > 0) node.minClearingTick = nodes[node.left].minClearingTick;
		else if (nodeClearingBidAttoEth > 0) node.minClearingTick = node.tick;
		else node.minClearingTick = rightClearingBidAttoEth == 0 ? int256(0) : nodes[node.right].minClearingTick;
	}

	function _height(mapping(uint256 => Node) storage nodes, uint256 nodeId) private view returns (uint256) {
		return nodeId == 0 ? 0 : nodes[nodeId].height;
	}

	function _balance(mapping(uint256 => Node) storage nodes, uint256 nodeId, uint256 underfundedThreshold) private returns (uint256) {
		int256 balance = int256(_height(nodes, nodes[nodeId].left)) - int256(_height(nodes, nodes[nodeId].right));
		if (balance > 1) {
			if (_height(nodes, nodes[nodes[nodeId].left].left) < _height(nodes, nodes[nodes[nodeId].left].right))
				nodes[nodeId].left = _rotateLeft(nodes, nodes[nodeId].left, underfundedThreshold);
			return _rotateRight(nodes, nodeId, underfundedThreshold);
		}
		if (balance < -1) {
			if (_height(nodes, nodes[nodes[nodeId].right].right) < _height(nodes, nodes[nodes[nodeId].right].left))
				nodes[nodeId].right = _rotateRight(nodes, nodes[nodeId].right, underfundedThreshold);
			return _rotateLeft(nodes, nodeId, underfundedThreshold);
		}
		return nodeId;
	}

	function _rotateLeft(mapping(uint256 => Node) storage nodes, uint256 nodeId, uint256 underfundedThreshold) private returns (uint256) {
		uint256 newRoot = nodes[nodeId].right;
		uint256 moved = nodes[newRoot].left;
		nodes[newRoot].left = nodeId;
		nodes[nodeId].right = moved;
		_update(nodes, nodeId, underfundedThreshold);
		_update(nodes, newRoot, underfundedThreshold);
		return newRoot;
	}

	function _rotateRight(mapping(uint256 => Node) storage nodes, uint256 nodeId, uint256 underfundedThreshold) private returns (uint256) {
		uint256 newRoot = nodes[nodeId].left;
		uint256 moved = nodes[newRoot].right;
		nodes[newRoot].right = nodeId;
		nodes[nodeId].left = moved;
		_update(nodes, nodeId, underfundedThreshold);
		_update(nodes, newRoot, underfundedThreshold);
		return newRoot;
	}

	function _decrease(mapping(uint256 => Node) storage nodes, uint256 nodeId, int256 tick, uint256 bidAmountAttoEth, uint256 underfundedThreshold) private returns (uint256, bool) {
		require(nodeId != 0, 'Auction tree node must exist before decreasing its ETH total');
		Node storage node = nodes[nodeId];
		bool removedTick;
		if (tick < node.tick)
			(node.left, removedTick) = _decrease(nodes, node.left, tick, bidAmountAttoEth, underfundedThreshold);
		else if (tick > node.tick)
			(node.right, removedTick) = _decrease(nodes, node.right, tick, bidAmountAttoEth, underfundedThreshold);
		else {
			require(node.totalBidAttoEth >= bidAmountAttoEth, 'Auction tree node ETH total would underflow');
			node.totalBidAttoEth -= bidAmountAttoEth;
			if (node.totalBidAttoEth == 0) return (_delete(nodes, nodeId, tick, underfundedThreshold), true);
		}
		_update(nodes, nodeId, underfundedThreshold);
		return (_balance(nodes, nodeId, underfundedThreshold), removedTick);
	}

	function _delete(mapping(uint256 => Node) storage nodes, uint256 nodeId, int256 tick, uint256 underfundedThreshold) private returns (uint256) {
		require(nodeId != 0, 'Auction tree node must exist before deletion');
		Node storage node = nodes[nodeId];
		if (tick < node.tick) node.left = _delete(nodes, node.left, tick, underfundedThreshold);
		else if (tick > node.tick) node.right = _delete(nodes, node.right, tick, underfundedThreshold);
		else {
			if (node.left == 0 && node.right == 0) {
				delete nodes[nodeId];
				return 0;
			}
			if (node.left == 0) {
				uint256 rightChild = node.right;
				delete nodes[nodeId];
				return rightChild;
			}
			if (node.right == 0) {
				uint256 leftChild = node.left;
				delete nodes[nodeId];
				return leftChild;
			}
			uint256 successorId = _minNode(nodes, node.right);
			Node storage successor = nodes[successorId];
			node.tick = successor.tick;
			node.totalBidAttoEth = successor.totalBidAttoEth;
			node.right = _delete(nodes, node.right, successor.tick, underfundedThreshold);
		}
		_update(nodes, nodeId, underfundedThreshold);
		return _balance(nodes, nodeId, underfundedThreshold);
	}

	function _minNode(mapping(uint256 => Node) storage nodes, uint256 nodeId) private view returns (uint256) {
		uint256 current = nodeId;
		while (nodes[current].left != 0) current = nodes[current].left;
		return current;
	}

	function _leastSignificantBit(uint256 value) private pure returns (uint256) {
		return value & (~value + 1);
	}

	function _powerOf1Point0001(uint8 index) private pure returns (uint256) {
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
}
