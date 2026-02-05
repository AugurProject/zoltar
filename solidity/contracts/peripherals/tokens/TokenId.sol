// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import '../../Zoltar.sol';
import { YesNoMarkets } from '../YesNoMarkets.sol';

library TokenId {

	function getTokenId(uint248 _universeId, YesNoMarkets.Outcome _outcome) internal pure returns (uint256 _tokenId) {
		bytes memory _tokenIdBytes = abi.encodePacked(_universeId, uint56(0), _outcome);
		assembly {
			_tokenId := mload(add(_tokenIdBytes, add(0x20, 0)))
		}
	}

	function getTokenIds(uint248 _universeId, YesNoMarkets.Outcome[] memory _outcomes) internal pure returns (uint256[] memory _tokenIds) {
		_tokenIds = new uint256[](_outcomes.length);
		for (uint256 _i = 0; _i < _outcomes.length; _i++) {
			_tokenIds[_i] = getTokenId(_universeId, _outcomes[_i]);
		}
	}

	function unpackTokenId(uint256 _tokenId) internal pure returns (uint248 _universe, YesNoMarkets.Outcome _outcome) {
		assembly {
			_universe := shr(8, and(_tokenId, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00))
			_outcome := and(_tokenId, 0xFF)
		}
	}
}
