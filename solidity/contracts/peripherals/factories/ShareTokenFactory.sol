// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { ShareToken } from '../tokens/ShareToken.sol';
import { Zoltar } from '../../Zoltar.sol';

contract ShareTokenFactory {
	Zoltar immutable zoltar;
	mapping(bytes32 => ShareToken) private shareTokens;

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function deployShareToken(bytes32 salt, uint256 questionId) external returns (ShareToken shareToken) {
		bytes32 deploymentKey = keccak256(abi.encode(msg.sender, salt, questionId));
		shareToken = shareTokens[deploymentKey];
		if (address(shareToken) != address(0)) return shareToken;

		shareToken = new ShareToken{ salt: salt }(msg.sender, zoltar, questionId);
		shareTokens[deploymentKey] = shareToken;
	}
}
