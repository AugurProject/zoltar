// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolMaturityMap } from '../../statoblast/SecurityPoolMaturityMap.sol';

contract SecurityPoolMaturityMapHarness {
	using SecurityPoolMaturityMap for SecurityPoolMaturityMap.Store;

	SecurityPoolMaturityMap.Store private tree;
	uint64[] public roots;

	constructor() {
		roots.push(0);
	}

	function add(uint256 rootIndex, uint48 key, uint256 units, uint256 correction) external {
		roots.push(tree.add(roots[rootIndex], key, units, correction));
	}

	function get(uint256 rootIndex, uint48 key) external view returns (uint256 units, uint256 correction) {
		return tree.get(roots[rootIndex], key);
	}

	function prefix(uint256 rootIndex, uint48 cutoff) external view returns (uint256 units, uint256 correction) {
		return tree.prefix(roots[rootIndex], cutoff);
	}

	function total(uint256 rootIndex) external view returns (uint256) {
		return tree.total(roots[rootIndex]);
	}
}
