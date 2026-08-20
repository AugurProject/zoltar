// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../../ReputationToken.sol';

contract SecurityPoolConstructorFailureZoltar {
	function getRepToken(uint248) external pure returns (ReputationToken) {
		return ReputationToken(address(0x1234));
	}
}
