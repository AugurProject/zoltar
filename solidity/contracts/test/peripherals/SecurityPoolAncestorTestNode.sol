// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract SecurityPoolAncestorTestNode {
	address public immutable parent;
	bytes32 private constant TEST_ORIGIN_ID = keccak256('test security pool lineage');

	constructor(address parentPool) {
		parent = parentPool;
	}

	function securityPoolFactory() external view returns (address) {
		return address(this);
	}

	function getSecurityPoolOriginId(address) external pure returns (bytes32) {
		return TEST_ORIGIN_ID;
	}
}
