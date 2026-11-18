// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @dev Exact timestamps use sixteen radix-8 digits. Branches skip common digits.
/// A scope owns its writable nodes until sealing; inherited roots contain only
/// retired writers. Callers must seal before sharing a root with another scope.
library SecurityPoolTimestampMap {
	struct Node {
		uint64[8] children;
		uint256 total;
		uint256 value;
		uint64 writer;
		uint48 key;
		uint8 level;
	}

	struct Store {
		uint64 lastNode;
		uint64 lastWriter;
		mapping(uint64 => Node) nodes;
		mapping(uint256 => uint64) writers;
	}

	function seal(Store storage self, uint256 scope) internal {
		delete self.writers[scope];
	}

	function total(Store storage self, uint64 root) internal view returns (uint256) {
		return self.nodes[root].total;
	}

	function get(Store storage self, uint64 root, uint48 key) internal view returns (uint256) {
		while (root != 0) {
			Node storage node = self.nodes[root];
			if (node.level == 0) return node.key == key ? node.value : 0;
			root = node.children[_digit(key, node.level)];
		}
		return 0;
	}

	function floor(Store storage self, uint64 root, uint48 key) internal view returns (uint256) {
		uint64 fallbackRoot;
		while (root != 0) {
			Node storage node = self.nodes[root];
			if (node.level == 0) {
				if (node.key <= key) return node.value;
				break;
			}
			if (_level(node.key ^ key) > node.level) {
				if (node.key < key) fallbackRoot = root;
				break;
			}
			uint8 digit = _digit(key, node.level);
			root = node.children[digit];
			while (digit != 0) {
				uint64 lower = node.children[--digit];
				if (lower == 0) continue;
				fallbackRoot = lower;
				break;
			}
		}
		while (self.nodes[fallbackRoot].level != 0) {
			Node storage node = self.nodes[fallbackRoot];
			for (uint8 digit = 8; digit != 0; ) {
				uint64 child = node.children[--digit];
				if (child == 0) continue;
				fallbackRoot = child;
				break;
			}
		}
		return self.nodes[fallbackRoot].value;
	}

	function prefixTotal(Store storage self, uint64 root, uint48 cutoff) internal view returns (uint256) {
		return prefixWithPolicy(self, root, cutoff, false);
	}

	function prefixTotalModular(Store storage self, uint64 root, uint48 cutoff) internal view returns (uint256) {
		return prefixWithPolicy(self, root, cutoff, true);
	}

	function prefixWithPolicy(Store storage self, uint64 root, uint48 cutoff, bool modular) internal view returns (uint256 sum) {
		while (root != 0) {
			Node storage node = self.nodes[root];
			if (node.level == 0 || _level(node.key ^ cutoff) > node.level)
				return node.key <= cutoff ? _add(sum, node.total, modular) : sum;
			uint8 digit = _digit(cutoff, node.level);
			for (uint8 i; i < digit; ++i) {
				uint64 child = node.children[i];
				if (child != 0) sum = _add(sum, self.nodes[child].total, modular);
			}
			root = node.children[digit];
		}
	}

	function set(Store storage self, uint256 scope, uint64 root, uint48 key, uint256 value, uint256 weight) internal returns (uint64) {
		return setWithPolicy(self, scope, root, key, value, weight, false);
	}

	function setModular(Store storage self, uint256 scope, uint64 root, uint48 key, uint256 value, uint256 weight) internal returns (uint64) {
		return setWithPolicy(self, scope, root, key, value, weight, true);
	}

	function setWithPolicy(Store storage self, uint256 scope, uint64 root, uint48 key, uint256 value, uint256 weight, bool modular) internal returns (uint64 changed) {
		uint64[16] memory path;
		uint256 depth;
		uint64 cursor = root;
		while (cursor != 0) {
			Node storage node = self.nodes[cursor];
			if (node.level == 0 || _level(node.key ^ key) > node.level) break;
			path[depth++] = cursor;
			cursor = node.children[_digit(key, node.level)];
		}
		Node storage previous = self.nodes[cursor];
		bool found = cursor != 0 && previous.level == 0 && previous.key == key;
		if (value == 0 && !found) return root;
		if (found && value == previous.value && weight == previous.total) return root;

		uint64 writer = self.writers[scope];
		if (writer == 0) {
			writer = ++self.lastWriter;
			self.writers[scope] = writer;
		}
		if (value != 0) {
			changed = found && previous.writer == writer ? cursor : ++self.lastNode;
			Node storage leaf = self.nodes[changed];
			leaf.key = key;
			leaf.writer = writer;
			leaf.value = value;
			leaf.total = weight;
			if (cursor != 0 && !found) {
				uint8 level = _level(previous.key ^ key);
				uint64[8] memory children;
				children[_digit(key, level)] = changed;
				children[_digit(previous.key, level)] = cursor;
				changed = _branch(self, children, key, level, writer, 0, modular);
			}
		}
		while (depth != 0) {
			uint64 parentId = path[--depth];
			Node storage parent = self.nodes[parentId];
			uint64[8] memory children = parent.children;
			children[_digit(key, parent.level)] = changed;
			changed = _branch(self, children, parent.key, parent.level, writer, parentId, modular);
		}
	}

	function _branch(Store storage self, uint64[8] memory children, uint48 key, uint8 level, uint64 writer, uint64 previous, bool modular) private returns (uint64 id) {
		uint64 sole;
		uint8 count;
		uint256 sum;
		for (uint8 i; i < 8; ++i) {
			uint64 child = children[i];
			if (child == 0) continue;
			sole = child;
			++count;
			sum = _add(sum, self.nodes[child].total, modular);
		}
		if (count < 2) return sole;
		id = previous != 0 && self.nodes[previous].writer == writer ? previous : ++self.lastNode;
		Node storage branch = self.nodes[id];
		branch.children = children;
		branch.total = sum;
		branch.key = key;
		branch.level = level;
		branch.writer = writer;
	}

	function _add(uint256 a, uint256 b, bool modular) private pure returns (uint256) {
		if (!modular) return a + b;
		unchecked {
			return a + b;
		}
	}

	function _level(uint48 difference) private pure returns (uint8) {
		return difference == 0 ? 0 : uint8(Math.log2(difference) / 3 + 1);
	}

	function _digit(uint48 key, uint8 level) private pure returns (uint8) {
		return uint8((key >> ((level - 1) * 3)) & 7);
	}
}
