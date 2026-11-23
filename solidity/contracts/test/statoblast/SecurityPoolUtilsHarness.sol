// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolUtils } from '../../statoblast/SecurityPoolUtils.sol';

contract SecurityPoolUtilsHarness {
	function calculateInitialEscalationDepositAttoRep(uint256 supply) external pure returns (uint256) {
		return SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(supply);
	}
}
