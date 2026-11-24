// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedCast } from '../../CheckedCast.sol';

contract CheckedTimestampHarness {
	function convert(uint256 value) external pure returns (uint48) {
		return CheckedCast.toUint48(value);
	}
}
