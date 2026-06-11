// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { EscalationGameCarryTree } from '../EscalationGameCarryTree.sol';

contract EscalationGameFactory {
	function deployEscalationGame(uint256 startBond, uint256 _nonDecisionThreshold) external returns (EscalationGame) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		EscalationGameCarryTree gameImplementation = new EscalationGameCarryTree{ salt: bytes32(uint256(0x0)) }(securityPool);
		gameImplementation.start(startBond, _nonDecisionThreshold);
		EscalationGame game = EscalationGame(payable(address(gameImplementation)));
		return game;
	}

	function deployEscalationGameFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork) external returns (EscalationGame) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		EscalationGameCarryTree gameImplementation = new EscalationGameCarryTree{ salt: bytes32(uint256(0x0)) }(securityPool);
		gameImplementation.startFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
		EscalationGame game = EscalationGame(payable(address(gameImplementation)));
		return game;
	}
}
