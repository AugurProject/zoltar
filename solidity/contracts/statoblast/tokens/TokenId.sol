// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../BinaryOutcomes.sol';

library TokenId {
	function getTokenId(uint248 _universeId, BinaryOutcomes.BinaryOutcome _outcome) internal pure returns (uint256 _tokenId) {
		return (uint256(_universeId) << 8) | uint8(_outcome);
	}

	function getTokenIds(uint248 _universeId, BinaryOutcomes.BinaryOutcome[] calldata _outcomes) internal pure returns (uint256[] memory _tokenIds) {
		_tokenIds = new uint256[](_outcomes.length);
		for (uint256 _i = 0; _i < _outcomes.length; _i++) {
			_tokenIds[_i] = getTokenId(_universeId, _outcomes[_i]);
		}
	}

	function unpackTokenId(uint256 _tokenId) internal pure returns (uint248 _universe, BinaryOutcomes.BinaryOutcome _outcome) {
		uint8 outcomeByte = uint8(_tokenId);
		require(outcomeByte <= uint8(BinaryOutcomes.BinaryOutcome.None), 'Unknown outcome in token id');
		return (uint248(_tokenId >> 8), BinaryOutcomes.BinaryOutcome(outcomeByte));
	}
}
