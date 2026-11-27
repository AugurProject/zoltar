// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../BinaryOutcomes.sol';

/// @dev A token id packs the universe id into its upper 248 bits and the outcome into its lowest byte.
library TokenId {
	function getTokenId(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) internal pure returns (uint256 _tokenId) {
		return (uint256(_universeId) << 8) | uint8(_outcome);
	}

	function getUniverseId(uint256 _tokenId) internal pure returns (uint248) {
		return uint248(_tokenId >> 8);
	}

	/// @dev The same outcome's token id in `_childUniverseId`.
	function getChildId(uint256 _tokenId, uint248 _childUniverseId) internal pure returns (uint256) {
		return (uint256(_childUniverseId) << 8) | uint8(_tokenId);
	}
}
