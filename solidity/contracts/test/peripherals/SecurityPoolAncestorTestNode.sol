// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract SecurityPoolAncestorTestNode {
	address public immutable parent;

	constructor(address parentPool) {
		parent = parentPool;
	}
}
