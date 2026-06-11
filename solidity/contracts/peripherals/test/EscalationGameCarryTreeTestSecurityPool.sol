// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { EscalationGameCarryTree, CarriedDepositProof } from '../EscalationGameCarryTree.sol';

contract EscalationGameCarryTreeTestSecurityPool {
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	address public immutable securityPoolForker;
	EscalationGameCarryTree public escalationGameCarryTree;

	constructor(Zoltar zoltarAddress, uint248 configuredUniverseId, address configuredSecurityPoolForker) {
		zoltar = zoltarAddress;
		universeId = configuredUniverseId;
		securityPoolForker = configuredSecurityPoolForker;
	}

	function setEscalationGameCarryTree(EscalationGameCarryTree game) external {
		require(address(escalationGameCarryTree) == address(0), 'carry tree already configured');
		escalationGameCarryTree = game;
	}

	function depositOnCarryTreeOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256) {
		return escalationGameCarryTree.depositOnOutcome(depositor, outcome, amount);
	}

	function initializeForkCarrySnapshot(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external {
		escalationGameCarryTree.initializeForkCarrySnapshot(
			inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedNullifierRoots
		);
	}

	function withdrawCarriedDeposit(BinaryOutcomes.BinaryOutcome outcome, CarriedDepositProof calldata proof)
		external
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return escalationGameCarryTree.withdrawCarriedDeposit(outcome, proof);
	}

	function claimCarryTreeDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome)
		external
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return escalationGameCarryTree.claimDepositForWinning(depositIndex, outcome);
	}
}
