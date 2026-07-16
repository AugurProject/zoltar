// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';
import { IEscalationGameEvents } from './interfaces/IEscalationGame.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import { Deposit, MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, Node, OutcomeState } from './EscalationGameTypes.sol';

interface IEscalationGameDepositContext {
	function getQuestionResolution() external view returns (BinaryOutcomes.BinaryOutcome);
	function hasReachedNonDecision() external view returns (bool);
}

contract EscalationGameDepositDelegate is EscalationGameStorage, IEscalationGameEvents {
	function recordDeposit(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 repAmount,
		uint256 expectedCumulativeRepAmount
	) external returns (uint256 parentDepositIndex) {
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		_validateAcceptedDeposit(
			outcome,
			outcomeIndex,
			selectedOutcomeState.balance,
			repAmount,
			expectedCumulativeRepAmount
		);
		selectedOutcomeState.balance = expectedCumulativeRepAmount;
		escrowedRepByVault[depositor] += repAmount;
		totalEscrowedRep += repAmount;
		unresolvedRepByVault[depositor] += repAmount;
		totalLocalUnresolvedRep += repAmount;
		localUnresolvedPrincipalByVaultAndOutcome[depositor][outcomeIndex] += repAmount;

		selectedOutcomeState.deposits.push(
			Deposit({ depositor: depositor, amount: repAmount, cumulativeAmount: expectedCumulativeRepAmount })
		);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
		parentDepositIndex =
			forkContinuation ? uint256(keccak256(abi.encode(address(this), outcomeIndex, depositIndex))) : depositIndex;
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;
		Node storage node = nodes[nodeId];
		node.parentNodeId = selectedOutcomeState.localHeadNodeId;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = repAmount;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmount = expectedCumulativeRepAmount;
		node.carryLeafIndex = selectedOutcomeState.currentLeafCount;
		selectedOutcomeState.localNodeIds.push(nodeId);
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotal += repAmount;
		_appendCarryLeaf(selectedOutcomeState, nodeId);

		emit LocalDepositAppended(
			nodeId,
			outcome,
			depositor,
			repAmount,
			parentDepositIndex,
			expectedCumulativeRepAmount
		);
		emit DepositOnOutcome(
			depositor,
			outcome,
			repAmount,
			depositIndex,
			expectedCumulativeRepAmount,
			escrowedRepByVault[depositor],
			totalEscrowedRep
		);
		if (IEscalationGameDepositContext(address(this)).hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
			emit NonDecisionReached(nonDecisionTimestamp);
		}
	}

	function _validateAcceptedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		uint8 outcomeIndex,
		uint256 currentBalance,
		uint256 repAmount,
		uint256 expectedCumulativeRepAmount
	) private view {
		require(nonDecisionTimestamp == 0, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(
			IEscalationGameDepositContext(address(this)).getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None,
			'Question resolved'
		);
		require(currentBalance < nonDecisionThreshold, 'Outcome full');
		require(repAmount > 0, 'Deposit zero');
		require(expectedCumulativeRepAmount == currentBalance + repAmount, 'Preview mismatch');
		require(expectedCumulativeRepAmount <= nonDecisionThreshold, 'Deposit exceeds room');
		require(repAmount >= startBond || expectedCumulativeRepAmount == nonDecisionThreshold, 'Below start bond');

		uint256 maxBalance = outcomeState[0].balance;
		if (outcomeState[1].balance > maxBalance) maxBalance = outcomeState[1].balance;
		if (outcomeState[2].balance > maxBalance) maxBalance = outcomeState[2].balance;
		if (expectedCumulativeRepAmount != maxBalance || maxBalance >= nonDecisionThreshold) return;
		for (uint8 otherOutcomeIndex = 0; otherOutcomeIndex < 3; otherOutcomeIndex++) {
			if (otherOutcomeIndex != outcomeIndex && outcomeState[otherOutcomeIndex].balance == maxBalance) {
				revert('Preview mismatch');
			}
		}
	}

	function _appendCarryLeaf(OutcomeState storage state, uint256 nodeId) private {
		Node storage node = nodes[nodeId];
		bytes32 carryHash = MerkleMountainRange.hashLeaf(
			node.depositor,
			node.outcome,
			node.amount,
			node.parentDepositIndex,
			node.cumulativeAmount,
			nodeId
		);
		uint256 leafCount = state.currentLeafCount;
		uint256 peakHeight;
		uint256 carryStartIndex = leafCount;
		state.currentCarryNodeHashes[0][carryStartIndex] = carryHash;
		while (((leafCount >> peakHeight) & 1) == 1) {
			uint256 siblingStartIndex = carryStartIndex - (uint256(1) << peakHeight);
			carryHash = MerkleMountainRange.hashParent(state.currentPeaks[peakHeight], carryHash);
			delete state.currentPeaks[peakHeight];
			peakHeight += 1;
			carryStartIndex = siblingStartIndex;
			state.currentCarryNodeHashes[peakHeight][carryStartIndex] = carryHash;
		}
		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'MMR too tall');
		state.currentPeaks[peakHeight] = carryHash;
		state.currentLeafCount = leafCount + 1;
	}
}
