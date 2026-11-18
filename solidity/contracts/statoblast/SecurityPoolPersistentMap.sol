// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Immutable Patricia roots supporting point changes and aggregate prefix reads.
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

	/// @dev Used only for fee-mode histories whose keys are uint48 timestamps.
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

	/// @dev Used only for fee integrals whose keys are uint48 timestamps.
	function prefixTotal(Store storage self, uint64 root, uint256 cutoff) internal view returns (uint256) {
		if (root == 0) return 0;
		Node storage node = self.nodes[root];
		if (node.bit == 0) return node.key <= cutoff ? node.total : 0;
		uint256 different = node.key ^ cutoff;
		if (different != 0 && Math.log2(different) >= node.bit) return node.key < cutoff ? node.total : 0;
		if ((cutoff & (uint256(1) << (node.bit - 1))) == 0) return prefixTotal(self, node.left, cutoff);
		return self.nodes[node.left].total + prefixTotal(self, node.right, cutoff);
	}

	/// @dev Finality histories retain old weights after their custody has been
	/// released. Their prefixes are residues modulo 2^256. The authority subtracts
	/// its previous residue; the result is exact because unprocessed live custody
	/// is at most uint256.max. Ordinary maps keep checked aggregate arithmetic unless their
	/// owner proves the aggregate cannot wrap, as the settlement fee maps do.
	function prefixTotalModular(Store storage self, uint64 root, uint256 cutoff) internal view returns (uint256 amount) {
		while (root != 0) {
			Node storage node = self.nodes[root];
			uint256 different = node.key ^ cutoff;
			if (node.bit == 0 || (different != 0 && Math.log2(different) >= node.bit)) {
				if (node.key <= cutoff) {
					unchecked {
						amount += node.total;
					}
				}
				return amount;
			}
			if ((cutoff & (uint256(1) << (node.bit - 1))) == 0) root = node.left;
			else {
				unchecked {
					amount += self.nodes[node.left].total;
				}
				root = node.right;
			}
		}
	}

	/// @dev A zero value deletes the leaf. Value and aggregate weight are deliberately distinct.
	function set(Store storage self, uint64 root, uint256 key, uint256 value, uint256 weight) internal returns (uint64) {
		return _set(self, root, key, value, weight, false);
	}

	function setModular(Store storage self, uint64 root, uint256 key, uint256 value, uint256 weight) internal returns (uint64) {
		return _set(self, root, key, value, weight, true);
	}

	function _set(Store storage self, uint64 root, uint256 key, uint256 value, uint256 weight, bool modular) private returns (uint64) {
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
			changed = _leaf(self, key, value, weight);
			if (root != 0 && self.nodes[root].key != key)
				changed =
					key < self.nodes[root].key
						? _join(self, changed, root, modular)
						: _join(self, root, changed, modular);
		}
		while (depth != 0) {
			Node storage parent = self.nodes[path[--depth]];
			changed =
				(key & (uint256(1) << (parent.bit - 1))) == 0
					? _join(self, changed, parent.right, modular)
					: _join(self, parent.left, changed, modular);
		}
		return changed;
	}

	function _last(Store storage self, uint64 root) private view returns (uint256) {
		while (self.nodes[root].bit != 0) root = self.nodes[root].right;
		return self.nodes[root].value;
	}

	function _leaf(Store storage self, uint256 key, uint256 value, uint256 weight) private returns (uint64 id) {
		id = ++self.lastId;
		self.nodes[id] = Node(key, value, weight, 0, 0, 0);
	}

	function _join(Store storage self, uint64 left, uint64 right, bool modular) private returns (uint64 id) {
		if (left == 0) return right;
		if (right == 0) return left;
		Node storage first = self.nodes[left];
		Node storage second = self.nodes[right];
		uint256 weight;
		if (modular) {
			unchecked {
				weight = first.total + second.total;
			}
		} else weight = first.total + second.total;
		id = ++self.lastId;
		self.nodes[id] = Node(first.key, 0, weight, left, right, uint16(Math.log2(first.key ^ second.key) + 1));
	}
}

/// @notice Persistent settlement maturity schedule with two independent modular totals.
library SecurityPoolMaturityMap {
	struct Node {
		uint48 key;
		uint64 left;
		uint64 right;
		uint8 bit;
		uint256 units;
		uint256 correction;
	}

	struct Store {
		uint64 lastId;
		mapping(uint64 => Node) nodes;
	}

	function prefix(Store storage self, uint64 root, uint48 cutoff) internal view returns (uint256 units, uint256 correction) {
		while (root != 0) {
			Node storage node = self.nodes[root];
			uint256 different = node.key ^ cutoff;
			if (node.bit == 0 || (different != 0 && Math.log2(different) >= node.bit)) {
				if (node.key <= cutoff) {
					unchecked {
						units += node.units;
						correction += node.correction;
					}
				}
				break;
			}
			if ((cutoff & (uint48(1) << (node.bit - 1))) == 0) root = node.left;
			else {
				Node storage earlier = self.nodes[node.left];
				unchecked {
					units += earlier.units;
					correction += earlier.correction;
				}
				root = node.right;
			}
		}
	}

	function add(Store storage self, uint64 root, uint48 key, uint256 units, uint256 correction) internal returns (uint64 changed) {
		if (key == 0 || (units == 0 && correction == 0)) return root;
		uint64[48] memory path;
		uint256 depth;
		while (root != 0) {
			Node storage node = self.nodes[root];
			uint256 different = node.key ^ key;
			if (node.bit == 0 || (different != 0 && Math.log2(different) >= node.bit)) break;
			path[depth++] = root;
			root = (key & (uint48(1) << (node.bit - 1))) == 0 ? node.left : node.right;
		}
		Node storage terminal = self.nodes[root];
		bool present = root != 0 && terminal.bit == 0 && terminal.key == key;
		if (present) {
			unchecked {
				units += terminal.units;
				correction += terminal.correction;
			}
		}
		if (units != 0 || correction != 0) {
			changed = ++self.lastId;
			self.nodes[changed] = Node(key, 0, 0, 0, units, correction);
		}
		if (root != 0 && !present)
			changed = key < terminal.key ? _join(self, changed, root) : _join(self, root, changed);
		while (depth != 0) {
			Node storage parent = self.nodes[path[--depth]];
			changed =
				(key & (uint48(1) << (parent.bit - 1))) == 0
					? _join(self, changed, parent.right)
					: _join(self, parent.left, changed);
		}
	}

	function _join(Store storage self, uint64 left, uint64 right) private returns (uint64 id) {
		if (left == 0) return right;
		if (right == 0) return left;
		Node storage earlier = self.nodes[left];
		Node storage later = self.nodes[right];
		id = ++self.lastId;
		unchecked {
			self.nodes[id] = Node(earlier.key, left, right, uint8(Math.log2(earlier.key ^ later.key) + 1), earlier.units + later.units, earlier.correction + later.correction);
		}
	}
}
