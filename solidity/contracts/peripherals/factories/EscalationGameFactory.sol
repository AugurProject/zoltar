// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

contract EscalationGameFactory {
	function deployEscalationGame(uint256 startBond, uint256 _nonDecisionThreshold) external returns (EscalationGame) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		EscalationGame game = new EscalationGame{ salt: bytes32(uint256(0x0)) }(securityPool);
		game.start(startBond, _nonDecisionThreshold);
		return game;
	}
}
