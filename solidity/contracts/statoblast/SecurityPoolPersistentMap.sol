// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Immutable Patricia roots supporting point changes and aggregate prefix extraction.
/// @dev A path contains at most 256 branch bits. Copying a root never copies its leaves.
library SecurityPoolPersistentMap {
	struct Node {
		uint256 key;
		uint256 value;
		uint256 total;
		uint64 left;
		uint64 right;
		uint16 bit;
	}

	struct Store {
		uint64 lastId;
		mapping(uint64 => Node) nodes;
	}

	function total(Store storage self, uint64 root) internal view returns (uint256) {
		return self.nodes[root].total;
	}

	function get(Store storage self, uint64 root, uint256 key) internal view returns (uint256 value) {
		while (root != 0) {
			Node storage node = self.nodes[root];
			if (node.bit == 0) return node.key == key ? node.value : 0;
			root = (key & (uint256(1) << (node.bit - 1))) == 0 ? node.left : node.right;
		}
	}

	/// @notice The first stored value with a key greater than or equal to the requested key.
	function ceiling(Store storage self, uint64 root, uint256 key) internal view returns (uint256 value) {
		if (root == 0) return 0;
		Node storage node = self.nodes[root];
		if (node.bit == 0) return node.key >= key ? node.value : 0;
		uint256 different = node.key ^ key;
		if (different != 0 && Math.log2(different) >= node.bit) {
			if (node.key < key) return 0;
			return _first(self, root);
		}
		if ((key & (uint256(1) << (node.bit - 1))) != 0) return ceiling(self, node.right, key);
		value = ceiling(self, node.left, key);
		return value == 0 ? _first(self, node.right) : value;
	}

	function floor(Store storage self, uint64 root, uint256 key) internal view returns (uint256 value) {
		if (root == 0) return 0;
		Node storage node = self.nodes[root];
		if (node.bit == 0) return node.key <= key ? node.value : 0;
		uint256 different = node.key ^ key;
		if (different != 0 && Math.log2(different) >= node.bit) {
			if (node.key > key) return 0;
			return _last(self, root);
		}
		if ((key & (uint256(1) << (node.bit - 1))) == 0) return floor(self, node.left, key);
		value = floor(self, node.right, key);
		return value == 0 ? _last(self, node.left) : value;
	}

	function prefixTotal(Store storage self, uint64 root, uint256 cutoff) internal view returns (uint256) {
		if (root == 0) return 0;
		Node storage node = self.nodes[root];
		if (node.bit == 0) return node.key <= cutoff ? node.total : 0;
		uint256 different = node.key ^ cutoff;
		if (different != 0 && Math.log2(different) >= node.bit) return node.key < cutoff ? node.total : 0;
		if ((cutoff & (uint256(1) << (node.bit - 1))) == 0) return prefixTotal(self, node.left, cutoff);
		return self.nodes[node.left].total + prefixTotal(self, node.right, cutoff);
	}

	/// @dev A zero value deletes the leaf. Value and aggregate weight are deliberately distinct.
	function set(Store storage self, uint64 root, uint256 key, uint256 value, uint256 weight) internal returns (uint64) {
		if (root == 0) return value == 0 ? 0 : _leaf(self, key, value, weight);
		Node memory node = self.nodes[root];
		if (node.key == key && node.bit == 0) return value == 0 ? 0 : _leaf(self, key, value, weight);
		uint256 different = node.key ^ key;
		if (different != 0 && Math.log2(different) >= node.bit) {
			if (value == 0) return root;
			uint64 inserted = _leaf(self, key, value, weight);
			return key < node.key ? _join(self, inserted, root) : _join(self, root, inserted);
		}
		if ((key & (uint256(1) << (node.bit - 1))) == 0)
			return _join(self, set(self, node.left, key, value, weight), node.right);
		return _join(self, node.left, set(self, node.right, key, value, weight));
	}

	/// @notice Partition a root into keys at most cutoff, and keys greater than cutoff.
	/// @dev Only the boundary path is rebuilt; all complete subtrees retain their immutable IDs.
	function split(Store storage self, uint64 root, uint256 cutoff) internal returns (uint64 beforeRoot, uint64 afterRoot) {
		if (root == 0) return (0, 0);
		Node memory node = self.nodes[root];
		if (node.bit == 0) return node.key <= cutoff ? (root, uint64(0)) : (uint64(0), root);
		uint256 different = node.key ^ cutoff;
		if (different != 0 && Math.log2(different) >= node.bit)
			return node.key < cutoff ? (root, uint64(0)) : (uint64(0), root);
		if ((cutoff & (uint256(1) << (node.bit - 1))) == 0) {
			(uint64 leftBefore, uint64 leftAfter) = split(self, node.left, cutoff);
			return (leftBefore, _join(self, leftAfter, node.right));
		}
		(uint64 rightBefore, uint64 rightAfter) = split(self, node.right, cutoff);
		return (_join(self, node.left, rightBefore), rightAfter);
	}

	function _first(Store storage self, uint64 root) private view returns (uint256) {
		while (self.nodes[root].bit != 0) root = self.nodes[root].left;
		return self.nodes[root].value;
	}

	function _last(Store storage self, uint64 root) private view returns (uint256) {
		while (self.nodes[root].bit != 0) root = self.nodes[root].right;
		return self.nodes[root].value;
	}

	function _leaf(Store storage self, uint256 key, uint256 value, uint256 weight) private returns (uint64 id) {
		id = ++self.lastId;
		self.nodes[id] = Node(key, value, weight, 0, 0, 0);
	}

	function _join(Store storage self, uint64 left, uint64 right) private returns (uint64 id) {
		if (left == 0) return right;
		if (right == 0) return left;
		Node storage first = self.nodes[left];
		Node storage second = self.nodes[right];
		id = ++self.lastId;
		self.nodes[id] = Node(first.key, 0, first.total + second.total, left, right, uint16(Math.log2(first.key ^ second.key) + 1));
	}
}
