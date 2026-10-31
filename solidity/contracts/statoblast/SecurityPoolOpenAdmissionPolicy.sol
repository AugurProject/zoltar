// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';

/// @notice Curated admission policy allowing any question that meets the portfolio's native checks.
contract SecurityPoolOpenAdmissionPolicy is ISecurityPoolQuestionAdmissionPolicy {
	function isQuestionAllowed(address, uint248, uint256) external pure returns (bool) {
		return true;
	}
}
