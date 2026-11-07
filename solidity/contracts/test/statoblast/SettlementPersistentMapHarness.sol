// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPersistentMap } from '../../statoblast/SecurityPoolPersistentMap.sol';
import { SecurityPoolFrozenHistory } from '../../statoblast/SecurityPoolFrozenHistory.sol';

contract SettlementPersistentMapHarness {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;
	using SecurityPoolFrozenHistory for SecurityPoolFrozenHistory.Store;
	SecurityPoolPersistentMap.Store private tree;
	SecurityPoolFrozenHistory.Store private frozenHistory;
	uint64[] public roots;
	uint64[] public frozenRoots;

	constructor() {
		roots.push(0);
		frozenRoots.push(0);
	}

	function set(uint256 rootIndex, uint256 key, uint256 value, uint256 weight) external {
		roots.push(tree.set(roots[rootIndex], key, value, weight));
	}

	function setModular(uint256 rootIndex, uint256 key, uint256 value, uint256 weight) external {
		roots.push(tree.setModular(roots[rootIndex], key, value, weight));
	}

	function prefixTotalModular(uint256 rootIndex, uint256 cutoff) external view returns (uint256) {
		return tree.prefixTotalModular(roots[rootIndex], cutoff);
	}

	function appendFrozen(uint256 rootIndex, uint48 timestamp, uint256 value) external {
		frozenRoots.push(frozenHistory.append(frozenRoots[rootIndex], timestamp, value));
	}

	function frozenCeiling(uint256 rootIndex, uint48 timestamp) external view returns (uint256) {
		return frozenHistory.ceiling(frozenRoots[rootIndex], timestamp);
	}

	function prefixTotal(uint256 rootIndex, uint256 cutoff) external view returns (uint256) {
		return tree.prefixTotal(roots[rootIndex], cutoff);
	}

	function get(uint256 rootIndex, uint256 key) external view returns (uint256) {
		return tree.get(roots[rootIndex], key);
	}

	function floor(uint256 rootIndex, uint256 key) external view returns (uint256) {
		return tree.floor(roots[rootIndex], key);
	}

	function total(uint256 rootIndex) external view returns (uint256) {
		return tree.total(roots[rootIndex]);
	}
}
