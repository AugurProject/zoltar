// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { EscalationGameCarryTree } from '../EscalationGameCarryTree.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';

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

	function deployEscalationGameCarryTree() external returns (EscalationGameCarryTree game) {
		require(address(escalationGameCarryTree) == address(0), 'carry tree already deployed');
		game = new EscalationGameCarryTree(ISecurityPool(payable(address(this))));
		escalationGameCarryTree = game;
	}

	function startCarryTree(uint256 startBond, uint256 nonDecisionThreshold) external {
		escalationGameCarryTree.start(startBond, nonDecisionThreshold);
	}

	function startCarryTreeFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork) external {
		escalationGameCarryTree.startFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function depositOnCarryTreeOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256) {
		return escalationGameCarryTree.depositOnOutcome(depositor, outcome, amount);
	}

	function importCarryTreeForkDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 parentDepositIndex, uint256 amount) external {
		escalationGameCarryTree.importForkedDeposit(depositor, outcome, parentDepositIndex, amount);
	}

	function branchCarryTreeFromFork(uint256 parentBranchId, uint256 forkedFromNodeId) external returns (uint256 branchId) {
		return escalationGameCarryTree.branchFromFork(parentBranchId, forkedFromNodeId);
	}

	function activateCarryTreeBranch(uint256 branchId) external {
		escalationGameCarryTree.activateBranch(branchId);
	}

	function withdrawImportedCarryTreeForkDeposit(uint256 parentDepositIndex, BinaryOutcomes.BinaryOutcome outcome)
		external
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return escalationGameCarryTree.withdrawImportedForkDeposit(parentDepositIndex, outcome);
	}
}
