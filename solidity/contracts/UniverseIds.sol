// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library UniverseIds {
	function child(uint248 universeId, uint256 outcomeIndex) internal pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
	}
}
