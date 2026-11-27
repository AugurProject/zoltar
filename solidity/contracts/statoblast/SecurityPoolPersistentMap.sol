// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Immutable Patricia roots supporting point changes and predecessor reads.
/// @dev A path contains at most 256 branch bits. Copying a root never copies its leaves.
library SecurityPoolPersistentMap {
	struct Node {
		uint256 key;
		uint256 value;
		uint64 left;
		uint64 right;
		// Zero denotes a leaf; branches store the tested bit index plus one.
		uint16 bit;
	}

	struct Store {
		uint64 lastId;
		mapping(uint64 => Node) nodes;
	}

	function get(Store storage self, uint64 root, uint256 key) internal view returns (uint256 value) {
		while (root != 0) {
			Node storage node = self.nodes[root];
			if (node.bit == 0) return node.key == key ? node.value : 0;
			root = (key & (uint256(1) << (node.bit - 1))) == 0 ? node.left : node.right;
		}
	}

	/// @dev Used only for fee-mode histories whose keys are uint48 timestamps.
	/// Returns zero when no predecessor exists; stored values are nonzero IDs.
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

	/// @dev A zero value deletes the leaf.
	function set(Store storage self, uint64 root, uint256 key, uint256 value) internal returns (uint64) {
		// Branch bits strictly decrease, so every possible path fits this fixed
		// buffer. Iteration avoids consuming the EVM stack on a full-width key.
		uint64[256] memory path;
		uint256 depth;
		while (root != 0) {
			Node storage node = self.nodes[root];
			uint256 different = node.key ^ key;
			if (node.bit == 0 || (different != 0 && Math.log2(different) >= node.bit)) break;
			path[depth++] = root;
			root = (key & (uint256(1) << (node.bit - 1))) == 0 ? node.left : node.right;
		}
		uint64 changed;
		if (value == 0) changed = root == 0 || self.nodes[root].key == key ? 0 : root;
		else {
			changed = _leaf(self, key, value);
			if (root != 0 && self.nodes[root].key != key)
				changed = key < self.nodes[root].key ? _join(self, changed, root) : _join(self, root, changed);
		}
		while (depth != 0) {
			Node storage parent = self.nodes[path[--depth]];
			changed =
				(key & (uint256(1) << (parent.bit - 1))) == 0
					? _join(self, changed, parent.right)
					: _join(self, parent.left, changed);
		}
		return changed;
	}

	function _last(Store storage self, uint64 root) private view returns (uint256) {
		while (self.nodes[root].bit != 0) root = self.nodes[root].right;
		return self.nodes[root].value;
	}

	function _leaf(Store storage self, uint256 key, uint256 value) private returns (uint64 id) {
		id = ++self.lastId;
		self.nodes[id] = Node({key: key, value: value, left: 0, right: 0, bit: 0});
	}

	function _join(Store storage self, uint64 left, uint64 right) private returns (uint64 id) {
		if (left == 0) return right;
		if (right == 0) return left;
		uint256 firstKey = self.nodes[left].key;
		id = ++self.lastId;
		self.nodes[id] = Node({key: firstKey, value: 0, left: left, right: right, bit: uint16(Math.log2(firstKey ^ self.nodes[right].key) + 1)});
	}
}
