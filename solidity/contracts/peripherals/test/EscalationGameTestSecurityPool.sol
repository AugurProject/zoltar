// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { EscalationGame } from '../EscalationGame.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';

contract EscalationGameTestSecurityPool {
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	address public immutable securityPoolForker;
	EscalationGame public escalationGame;

	constructor(Zoltar zoltarAddress, uint248 configuredUniverseId, address configuredSecurityPoolForker) {
		zoltar = zoltarAddress;
		universeId = configuredUniverseId;
		securityPoolForker = configuredSecurityPoolForker;
	}

	function deployEscalationGame(uint256 startBond, uint256 nonDecisionThreshold) external returns (EscalationGame game) {
		require(address(escalationGame) == address(0), 'already deployed');
		game = new EscalationGame{ salt: bytes32(uint256(0)) }(ISecurityPool(payable(address(this))));
		game.start(startBond, nonDecisionThreshold);
		escalationGame = game;
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256) {
		return escalationGame.depositOnOutcome(depositor, outcome, amount);
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) external returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		return escalationGame.claimDepositForWinning(depositIndex, outcome);
	}
}
