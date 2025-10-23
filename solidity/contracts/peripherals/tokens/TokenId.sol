// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import '../../Zoltar.sol';

library TokenId {

	function getTokenId(uint192 _universeId, uint56 _marketId, Zoltar.Outcome _outcome) internal pure returns (uint256 _tokenId) {
		bytes memory _tokenIdBytes = abi.encodePacked(_universeId, _marketId, _outcome);
		assembly {
			_tokenId := mload(add(_tokenIdBytes, add(0x20, 0)))
		}
	}

	function getTokenIds(uint192 _universeId, uint56 _market, Zoltar.Outcome[] memory _outcomes) internal pure returns (uint256[] memory _tokenIds) {
		_tokenIds = new uint256[](_outcomes.length);
		for (uint256 _i = 0; _i < _outcomes.length; _i++) {
			_tokenIds[_i] = getTokenId(_universeId, _market, _outcomes[_i]);
		}
	}

	function unpackTokenId(uint256 _tokenId) internal pure returns (uint192 _universe, uint56 _market, Zoltar.Outcome _outcome) {
		assembly {
			_universe := shr(64, and(_tokenId, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF0000000000000000))
			_market := shr(8,  and(_tokenId, 0x000000000000000000000000000000000000000000000000FFFFFFFFFFFFFF00))
			_outcome := and(_tokenId, 0x00000000000000000000000000000000000000000000000000000000000000FF)
		}
	}
}
