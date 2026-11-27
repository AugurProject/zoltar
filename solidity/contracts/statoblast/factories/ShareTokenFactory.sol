// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { ShareToken } from '../tokens/ShareToken.sol';
import { Zoltar } from '../../Zoltar.sol';

contract ShareTokenFactory {
	Zoltar immutable zoltar;

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	/// @dev The caller supplies a unique salt per token; CREATE2 reverts on a repeated one.
	function deployShareToken(bytes32 salt, uint256 questionId) external returns (ShareToken) {
		return new ShareToken{salt: salt}(msg.sender, zoltar, questionId);
	}
}
