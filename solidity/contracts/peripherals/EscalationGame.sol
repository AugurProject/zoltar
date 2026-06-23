// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameSettlement } from './EscalationGameSettlement.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { Deposit, ESCALATION_TIME_LENGTH, Node, OutcomeState } from './EscalationGameTypes.sol';

contract EscalationGame is EscalationGameSettlement {
	constructor(ISecurityPool _securityPool, ReputationToken _repToken) EscalationGameState(_securityPool, _repToken) {}

	function start(uint256 _startBond, uint256 _nonDecisionThreshold) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		activationTime = block.timestamp + activationDelay;
		emit GameStarted(activationTime, startBond, nonDecisionThreshold);
	}

	function startFromFork(uint256 _startBond, uint256 _nonDecisionThreshold, uint256 elapsedAtFork) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		require(elapsedAtFork <= ESCALATION_TIME_LENGTH, 'it');
		forkContinuation = true;
		forkElapsedAtStart = elapsedAtFork;
		emit GameContinuedFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function resumeFromFork() external {
		require(owner == msg.sender || address(securityPool) == msg.sender, 'or');
		require(forkContinuation, 'fc');
		require(forkResumedAt == 0, 'ar');
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function forkContinuationResumed() public view returns (bool) {
		return forkResumedAt != 0;
	}

	function previewDepositOnOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount
	) external view returns (uint256 acceptedAmount, uint256 resultingCumulativeAmount) {
		require(nonDecisionTimestamp == 0, 'nd');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'bad outcome');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'to');
		require(outcomeState[uint8(outcome)].balance < nonDecisionThreshold, 'af');
		require(amount >= startBond, 'md');
		uint256 outcomeIndex = uint256(outcome);
		uint256 currentBalance = outcomeState[outcomeIndex].balance;
		uint256 room = nonDecisionThreshold - currentBalance;
		(acceptedAmount, resultingCumulativeAmount) = _getAcceptedDepositAmount(
			outcomeIndex,
			amount,
			currentBalance,
			room
		);
	}

	function recordDepositFromSecurityPool(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 expectedCumulativeAmount
	) external returns (uint256 parentDepositIndex) {
		require(nonDecisionTimestamp == 0, 'nd');
		require(msg.sender == address(securityPool), 'only pool');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'bad outcome');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'to');
		require(outcomeState[uint8(outcome)].balance < nonDecisionThreshold, 'af');
		require(amount > 0, 'md');
		uint256 outcomeIndex = uint256(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		uint256 currentBalance = selectedOutcomeState.balance;
		uint256 room = nonDecisionThreshold - currentBalance;
		(uint256 effectiveDeposit, uint256 newBalance) = _getAcceptedDepositAmount(
			outcomeIndex,
			amount,
			currentBalance,
			room
		);
		require(effectiveDeposit == amount, 'ds');
		require(newBalance == expectedCumulativeAmount, 'ps');

		selectedOutcomeState.balance += effectiveDeposit;
		escrowedRepByVault[depositor] += effectiveDeposit;
		totalEscrowedRep += effectiveDeposit;
		unresolvedRepByVault[depositor] += effectiveDeposit;
		totalLocalUnresolvedRep += effectiveDeposit;

		Deposit memory deposit;
		deposit.depositor = depositor;
		deposit.amount = effectiveDeposit;
		deposit.cumulativeAmount = newBalance;
		selectedOutcomeState.deposits.push(deposit);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
		unresolvedLocalDepositRefsByVault[depositor].push(_encodeLocalDepositRef(uint8(outcome), depositIndex));
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
		parentDepositIndex = stableParentDepositIndex;
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;
		Node storage node = nodes[nodeId];
		node.parentNodeId = selectedOutcomeState.localHeadNodeId;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = effectiveDeposit;
		node.parentDepositIndex = stableParentDepositIndex;
		node.cumulativeAmount = deposit.cumulativeAmount;
		node.carryLeafIndex = selectedOutcomeState.currentLeafCount;
		selectedOutcomeState.localNodeIds.push(nodeId);
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotal += effectiveDeposit;
		_appendLocalCarryLeafToCurrentSnapshot(selectedOutcomeState, nodeId);
		emit LocalDepositAppended(
			nodeId,
			outcome,
			depositor,
			effectiveDeposit,
			stableParentDepositIndex,
			deposit.cumulativeAmount
		);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, depositIndex, deposit.cumulativeAmount);
		if (hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
		}
	}

	function _initializeStartParams(uint256 _startBond, uint256 _nonDecisionThreshold) private {
		require(owner == msg.sender, 'os');
		require(activationTime == 0, 'as');
		require(_nonDecisionThreshold > _startBond, 'te');
		require(_startBond > 0, 'sb');
		require(_startBond >= 1e18, 's1');
		require(_nonDecisionThreshold >= 1e18, 't1');
		startBond = _startBond;
		nonDecisionThreshold = _nonDecisionThreshold;
		lnRatioScaled = _computeLnRatioScaled(_startBond, _nonDecisionThreshold);
	}
}
