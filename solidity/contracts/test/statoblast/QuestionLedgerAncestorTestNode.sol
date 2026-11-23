// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract QuestionLedgerAncestorTestNode {
	address public immutable parent;
	bytes32 private constant TEST_ORIGIN_ID = keccak256('test question ledger lineage');

	constructor(address parentPool) {
		parent = parentPool;
	}

	function securityPoolFactory() external view returns (address) {
		return address(this);
	}

	function getQuestionLedgerOriginId(address) external pure returns (bytes32) {
		return TEST_ORIGIN_ID;
	}
}
