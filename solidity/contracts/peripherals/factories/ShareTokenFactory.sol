// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { ShareToken } from '../tokens/ShareToken.sol';
import { Zoltar } from '../../Zoltar.sol';

contract ShareTokenFactory {
	Zoltar immutable zoltar;

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function deployShareToken(bytes32 salt) external returns (ShareToken shareToken) {
		return new ShareToken{ salt: salt }(msg.sender, zoltar);
	}
}
