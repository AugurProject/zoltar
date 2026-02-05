// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

contract EscalationGameFactory {
	function deployEscalationGame(ISecurityPool securityPool, uint256 forkTreshold) external returns (EscalationGame) {
		return new EscalationGame{ salt: keccak256(abi.encodePacked(msg.sender)) }(securityPool, forkTreshold);
	}
}
