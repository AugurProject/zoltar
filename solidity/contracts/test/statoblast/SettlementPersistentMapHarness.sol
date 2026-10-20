// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPersistentMap } from '../../statoblast/SecurityPoolPersistentMap.sol';

contract SettlementPersistentMapHarness {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;
	SecurityPoolPersistentMap.Store private tree;
	uint64[] public roots;

	constructor() {
		roots.push(0);
	}

	function set(uint256 rootIndex, uint256 key, uint256 value, uint256 weight) external {
		roots.push(tree.set(roots[rootIndex], key, value, weight));
	}

	function split(uint256 rootIndex, uint256 cutoff) external {
		(uint64 beforeRoot, uint64 afterRoot) = tree.split(roots[rootIndex], cutoff);
		roots.push(beforeRoot);
		roots.push(afterRoot);
	}

	function get(uint256 rootIndex, uint256 key) external view returns (uint256) {
		return tree.get(roots[rootIndex], key);
	}

	function ceiling(uint256 rootIndex, uint256 key) external view returns (uint256) {
		return tree.ceiling(roots[rootIndex], key);
	}

	function total(uint256 rootIndex) external view returns (uint256) {
		return tree.total(roots[rootIndex]);
	}
}
