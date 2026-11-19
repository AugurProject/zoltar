// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Exact uint48 deadline prefixes, with at most 24 branch levels and immutable fork roots.
library SecurityPoolMaturityMap {
	struct Node {
		// Four 48-bit child IDs, an 8-bit digit length, and a representative 48-bit key.
		uint256 path;
		uint256 units;
		uint256 correction;
	}

	struct Store {
		uint48 lastId;
		mapping(uint48 => Node) nodes;
	}

	function total(Store storage self, uint64 root) internal view returns (uint256) {
		return self.nodes[uint48(root)].units;
	}

	function get(Store storage self, uint64 root, uint48 key) internal view returns (uint256 units, uint256 correction) {
		while (root != 0) {
			Node storage node = self.nodes[uint48(root)];
			uint256 path = node.path;
			uint256 level = _level(path);
			uint48 representative = _key(path);
			if (level == 0) {
				if (representative == key) return (node.units, node.correction);
				return (0, 0);
			}
			if (representative >> (2 * level) != key >> (2 * level)) return (0, 0);
			root = _child(path, _digit(key, level));
		}
	}

	function prefix(Store storage self, uint64 root, uint48 cutoff) internal view returns (uint256 units, uint256 correction) {
		while (root != 0) {
			Node storage node = self.nodes[uint48(root)];
			uint256 path = node.path;
			uint48 key = _key(path);
			uint256 level = _level(path);
			if (level == 0 || cutoff >> (2 * level) != key >> (2 * level)) {
				if (key <= cutoff) {
					unchecked {
						units += node.units;
						correction += node.correction;
					}
				}
				break;
			}
			uint256 digit = _digit(cutoff, level);
			for (uint256 earlier = 0; earlier < digit; ++earlier) {
				Node storage sibling = self.nodes[_child(path, earlier)];
				unchecked {
					units += sibling.units;
					correction += sibling.correction;
				}
			}
			root = _child(path, digit);
		}
	}

	function add(Store storage self, uint64 root, uint48 key, uint256 units, uint256 correction) internal returns (uint64) {
		if (key == 0 || (units == 0 && correction == 0)) return root;
		return _add(self, uint48(root), key, units, correction);
	}

	function _add(Store storage self, uint48 root, uint48 key, uint256 units, uint256 correction) private returns (uint48) {
		if (root == 0) return _leaf(self, key, units, correction);
		Node storage node = self.nodes[root];
		uint256 path = node.path;
		uint48 representative = _key(path);
		uint256 level = _level(path);
		uint48 difference = representative ^ key;
		if (difference >> (2 * level) != 0) {
			uint256 splitLevel = Math.log2(difference) / 2 + 1;
			uint48 leaf = _leaf(self, key, units, correction);
			uint256 children =
				(uint256(root) << (48 * _digit(representative, splitLevel))) |
					(uint256(leaf) << (48 * _digit(key, splitLevel)));
			return _branch(self, splitLevel, children);
		}
		if (level == 0) {
			unchecked {
				return _leaf(self, key, node.units + units, node.correction + correction);
			}
		}
		uint256 digit = _digit(key, level);
		uint48 updated = _add(self, _child(path, digit), key, units, correction);
		uint256 shift = 48 * digit;
		uint256 replaced =
			((path & type(uint192).max) & ~(uint256(type(uint48).max) << shift)) | (uint256(updated) << shift);
		return _branch(self, level, replaced);
	}

	function _leaf(Store storage self, uint48 key, uint256 units, uint256 correction) private returns (uint48 id) {
		if (units == 0 && correction == 0) return 0;
		id = ++self.lastId;
		self.nodes[id] = Node(uint256(key) << 200, units, correction);
	}

	function _branch(Store storage self, uint256 level, uint256 children) private returns (uint48 id) {
		uint48 first;
		uint256 count;
		uint256 units;
		uint256 correction;
		for (uint256 digit = 0; digit < 4; ++digit) {
			uint48 child = _child(children, digit);
			if (child == 0) continue;
			if (first == 0) first = child;
			++count;
			Node storage node = self.nodes[child];
			unchecked {
				units += node.units;
				correction += node.correction;
			}
		}
		if (count < 2) return first;
		id = ++self.lastId;
		self.nodes[id] = Node(children | (level << 192) | (uint256(_key(self.nodes[first].path)) << 200), units, correction);
	}

	function _key(uint256 path) private pure returns (uint48) {
		return uint48(path >> 200);
	}

	function _level(uint256 path) private pure returns (uint8) {
		return uint8(path >> 192);
	}

	function _child(uint256 path, uint256 digit) private pure returns (uint48) {
		return uint48(path >> (48 * digit));
	}

	function _digit(uint48 key, uint256 level) private pure returns (uint256) {
		return (key >> (2 * (level - 1))) & 3;
	}
}
