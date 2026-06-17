// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';

contract EscalationGameFactory {
	function deployEscalationGame(uint256 startBond, uint256 _nonDecisionThreshold) external returns (EscalationGame) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		EscalationGame gameImplementation = new EscalationGame{ salt: bytes32(uint256(0x0)) }(securityPool, securityPool.repToken());
		gameImplementation.start(startBond, _nonDecisionThreshold);
		return EscalationGame(payable(address(gameImplementation)));
	}

	function deployEscalationGameFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork) external returns (EscalationGame) {
		ISecurityPool securityPool = ISecurityPool(payable(msg.sender));
		EscalationGame gameImplementation = new EscalationGame{ salt: bytes32(uint256(0x0)) }(securityPool, securityPool.repToken());
		gameImplementation.startFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
		return EscalationGame(payable(address(gameImplementation)));
	}
}
