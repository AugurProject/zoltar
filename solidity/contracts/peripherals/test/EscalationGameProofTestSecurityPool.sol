// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { EscalationGame, CarriedDepositProof } from '../EscalationGame.sol';

contract EscalationGameProofTestSecurityPool {
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	address public immutable securityPoolForker;
	EscalationGame public escalationGame;

	constructor(Zoltar zoltarAddress, uint248 configuredUniverseId, address configuredSecurityPoolForker) {
		zoltar = zoltarAddress;
		universeId = configuredUniverseId;
		securityPoolForker = configuredSecurityPoolForker;
	}

	function setEscalationGame(EscalationGame game) external {
		require(address(escalationGame) == address(0), 'escalation game already configured');
		escalationGame = game;
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256) {
		return escalationGame.depositOnOutcome(depositor, outcome, amount);
	}

	function initializeForkCarrySnapshot(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external {
		escalationGame.initializeForkCarrySnapshot(
			inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots
		);
	}

	function withdrawDeposit(BinaryOutcomes.BinaryOutcome outcome, CarriedDepositProof calldata proof)
		external
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return escalationGame.withdrawDeposit(proof, outcome);
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome)
		external
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return escalationGame.claimDepositForWinning(depositIndex, outcome);
	}
}
