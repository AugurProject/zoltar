// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolTimestampMap } from '../../statoblast/SecurityPoolTimestampMap.sol';

contract TimestampMapHarness {
	using SecurityPoolTimestampMap for SecurityPoolTimestampMap.Store;

	SecurityPoolTimestampMap.Store private tree;
	mapping(uint256 => uint64) private roots;
	mapping(uint256 => uint64) private snapshots;

	function set(uint256 scope, uint48 key, uint256 value, uint256 weight, bool modular) external {
		roots[scope] = tree.setWithPolicy(scope, roots[scope], key, value, weight, modular);
	}

	function seal(uint256 scope, uint256 snapshot) external {
		snapshots[snapshot] = roots[scope];
		tree.seal(scope);
	}

	function inheritSnapshot(uint256 scope, uint256 snapshot) external {
		roots[scope] = snapshots[snapshot];
	}

	function read(uint256 index, uint48 key, bool frozen, bool modular) external view returns (uint256 value, uint256 floorValue, uint256 prefix, uint256 total) {
		uint64 root = frozen ? snapshots[index] : roots[index];
		return (
			tree.get(root, key),
			tree.floor(root, key),
			tree.prefixWithPolicy(root, key, modular),
			tree.total(root)
		);
	}
}
