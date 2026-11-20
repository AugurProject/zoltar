// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedTimestamp } from '../../statoblast/CheckedTimestamp.sol';

contract CheckedTimestampHarness {
	function convert(uint256 value) external pure returns (uint48) {
		return CheckedTimestamp.toUint48(value);
	}
}
