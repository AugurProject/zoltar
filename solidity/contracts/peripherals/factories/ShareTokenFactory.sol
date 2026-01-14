// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;
import { IShareToken } from '../interfaces/IShareToken.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';

contract ShareTokenFactory {
	Zoltar zoltar;

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function deployShareToken(uint56 questionId, bytes32 salt) external returns (IShareToken shareToken) {
		return new ShareToken{ salt: salt }(msg.sender, zoltar, questionId);
	}
}
