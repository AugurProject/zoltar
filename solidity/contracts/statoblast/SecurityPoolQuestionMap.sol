// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';

/// @notice Immutable question snapshots keyed by sequential, store-local indices.
/// @dev IDs remain external identities; their bits never determine a trie path.
/// One store spans every fork branch. Indices are assigned on first write and
/// never reused, so copying a root preserves all inherited question identities.
/// Branches may have sparse indices, but no path can exceed 64 branch bits.
library SecurityPoolQuestionMap {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;

	struct Store {
		SecurityPoolPersistentMap.Store tree;
		mapping(uint256 => uint64) indices;
		uint64 lastIndex;
	}

	function get(Store storage self, uint64 root, uint256 questionId) internal view returns (uint256) {
		uint64 index = self.indices[questionId];
		return index == 0 ? 0 : self.tree.get(root, index);
	}

	function set(Store storage self, uint64 root, uint256 questionId, uint256 value) internal returns (uint64) {
		uint64 index = self.indices[questionId];
		if (index == 0) {
			if (value == 0) return root;
			index = ++self.lastIndex;
			self.indices[questionId] = index;
		}
		return self.tree.set(root, index, value);
	}
}
