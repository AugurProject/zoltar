// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolQuestionAdmissionPolicy } from '../../statoblast/interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';

contract QuestionAdmissionPolicyHarness is ISecurityPoolQuestionAdmissionPolicy {
	bool public allowed = true;
	bool public unavailable;

	function setState(bool _allowed, bool _unavailable) external {
		allowed = _allowed;
		unavailable = _unavailable;
	}

	function isQuestionAllowed(address, uint248, uint256) external view returns (bool) {
		require(!unavailable, 'Admission unavailable');
		return allowed;
	}
}
