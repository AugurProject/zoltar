// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

contract EscalationGameFactory {
	function deployEscalationGame(uint256 startBond, uint256 _nonDecisionThreshold) external returns (EscalationGame) {
		EscalationGame gameImplementation = _deployEscalationGame();
		gameImplementation.start(startBond, _nonDecisionThreshold);
		return gameImplementation;
	}

	function deployEscalationGameFromFork(
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256 elapsedAtFork
	) external returns (EscalationGame) {
		EscalationGame gameImplementation = _deployEscalationGame();
		gameImplementation.startFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
		return gameImplementation;
	}

	function _deployEscalationGame() private returns (EscalationGame gameImplementation) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		gameImplementation = new EscalationGame{ salt: bytes32(0) }(securityPool, securityPool.repToken());
	}
}
