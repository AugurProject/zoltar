// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolTimestampMap } from './SecurityPoolTimestampMap.sol';

/// @dev The settlement book owns all schedule mutations. Keeping the store in
/// a separate runtime lets the book fit the deployment bytecode limit.
contract SecurityPoolTimestampStore {
	using SecurityPoolTimestampMap for SecurityPoolTimestampMap.Store;

	address private immutable book;
	SecurityPoolTimestampMap.Store private tree;

	constructor() {
		book = msg.sender;
	}

	modifier onlyBook() {
		require(msg.sender == book, 'Only settlement book');
		_;
	}

	function seal(uint64 scope) external onlyBook {
		tree.seal(scope);
	}

	function set(uint64 scope, uint64 root, uint48 key, uint256 value, uint256 weight, bool modular) external onlyBook returns (uint64) {
		return tree.setWithPolicy(scope, root, key, value, weight, modular);
	}

	function prefix(uint64 root, uint48 cutoff, bool modular) external view returns (uint256) {
		return tree.prefixWithPolicy(root, cutoff, modular);
	}

	function floor(uint64 root, uint48 key) external view returns (uint256) {
		return tree.floor(root, key);
	}

	function get(uint64 root, uint48 key) external view returns (uint256) {
		return tree.get(root, key);
	}

	function total(uint64 root) external view returns (uint256) {
		return tree.total(root);
	}
}
