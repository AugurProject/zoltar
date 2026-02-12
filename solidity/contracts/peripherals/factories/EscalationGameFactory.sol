// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

contract EscalationGameFactory {
	function deployEscalationGame(uint256 startBond, uint256 _nonDecisionTreshold) external returns (EscalationGame) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		EscalationGame game = new EscalationGame{ salt: bytes32(uint256(1)) }(securityPool);
		game.start(startBond, _nonDecisionTreshold);
		return game;
	}
}
