// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';

/// @notice Open admission policy allowing any question that meets the security pool's native checks.
contract SecurityPoolOpenAdmissionPolicy is ISecurityPoolQuestionAdmissionPolicy {
	function isQuestionAllowed(address, uint248, uint256) external pure returns (bool) {
		return true;
	}
}
