// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library CheckedCast {
	function toUint48(uint256 value) internal pure returns (uint48) {
		require(value <= type(uint48).max, 'Timestamp exceeds uint48');
		return uint48(value);
	}
}
