// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { BinaryOutcomes } from '../../peripherals/BinaryOutcomes.sol';
import { CarriedDepositProof, EscalationGame } from '../../peripherals/EscalationGame.sol';

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

	function repToken() external view returns (ReputationToken) {
		return zoltar.getRepToken(universeId);
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256, uint256) {
		(uint256 acceptedAmount, uint256 resultingCumulativeAmount) = escalationGame.previewDepositOnOutcome(outcome, amount);
		ReputationToken rep = zoltar.getRepToken(universeId);
		rep.transferFrom(msg.sender, address(escalationGame), acceptedAmount);
		uint256 parentDepositIndex = escalationGame.recordDepositFromSecurityPool(depositor, outcome, acceptedAmount, resultingCumulativeAmount);
		return (acceptedAmount, parentDepositIndex);
	}

	function initializeForkCarrySnapshot(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external {
		uint256 totalInheritedPrincipal =
			inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2];
		if (totalInheritedPrincipal > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalInheritedPrincipal);
		}
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

	function recordForkedEscrow(address depositor, uint256 amount) external {
		escalationGame.recordForkedEscrow(depositor, amount);
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome)
		external
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return escalationGame.claimDepositForWinning(depositIndex, outcome);
	}
}
