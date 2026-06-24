// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { EscalationGameProofVerifier } from '../EscalationGameProofVerifier.sol';

contract EscalationGameFactory {
	EscalationGameProofVerifier public immutable proofVerifier;
	bytes private escalationGameCreationCode;

	constructor() {
		proofVerifier = new EscalationGameProofVerifier();
		escalationGameCreationCode = type(EscalationGame).creationCode;
	}

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
		// Keep EscalationGame init code in storage so the factory runtime stays below EIP-170.
		bytes memory initCode = abi.encodePacked(
			escalationGameCreationCode,
			abi.encode(securityPool, securityPool.repToken(), proofVerifier)
		);
		address deployed;
		assembly {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), 0)
			if iszero(deployed) {
				let revertDataSize := returndatasize()
				if gt(revertDataSize, 0) {
					returndatacopy(0, 0, revertDataSize)
					revert(0, revertDataSize)
				}
			}
		}
		require(deployed != address(0x0), 'Escalation game deployment failed');
		gameImplementation = EscalationGame(deployed);
	}
}
