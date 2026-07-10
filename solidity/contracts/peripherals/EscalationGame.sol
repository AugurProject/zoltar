// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { EscalationGameSettlement } from './EscalationGameSettlement.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { Deposit, ESCALATION_TIME_LENGTH, Node, OutcomeState } from './EscalationGameTypes.sol';

contract EscalationGame is EscalationGameSettlement {
	constructor(
		ISecurityPool _securityPool,
		ReputationToken _repToken,
		EscalationGameProofVerifier _proofVerifier
	) EscalationGameState(_securityPool, _repToken, _proofVerifier) {}

	function start(uint256 _startBond, uint256 _nonDecisionThreshold) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		activationTime = block.timestamp + activationDelay;
		emit GameStarted(activationTime, startBond, nonDecisionThreshold);
	}

	function startFromFork(uint256 _startBond, uint256 _nonDecisionThreshold, uint256 elapsedAtFork) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		require(elapsedAtFork <= ESCALATION_TIME_LENGTH, 'Fork time too high');
		forkContinuation = true;
		forkElapsedAtStart = elapsedAtFork;
		emit GameContinuedFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function resumeFromFork() external {
		require(owner == msg.sender || address(securityPool) == msg.sender, 'Only owner or security pool');
		require(forkContinuation, 'No fork mode');
		require(forkResumedAt == 0, 'Fork resumed');
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function previewDepositOnOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount
	) external view returns (uint256 acceptedAmount, uint256 resultingCumulativeAmount) {
		require(nonDecisionTimestamp == 0, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'Question resolved');
		require(outcomeState[uint8(outcome)].balance < nonDecisionThreshold, 'Outcome full');
		require(amount >= startBond, 'Below start bond');
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
		require(nonDecisionTimestamp == 0, 'Non-decision done');
		require(msg.sender == address(securityPool), 'Only security pool');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'Question resolved');
		require(outcomeState[uint8(outcome)].balance < nonDecisionThreshold, 'Outcome full');
		require(amount > 0, 'Amount is zero');
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
		require(effectiveDeposit == amount, 'Deposit exceeds room');
		require(newBalance == expectedCumulativeAmount, 'Preview mismatch');

		selectedOutcomeState.balance += effectiveDeposit;
		escrowedRepByVault[depositor] += effectiveDeposit;
		totalEscrowedRep += effectiveDeposit;
		unresolvedRepByVault[depositor] += effectiveDeposit;
		totalLocalUnresolvedRep += effectiveDeposit;

		Deposit memory deposit;
		deposit.depositor = depositor;
		deposit.amount = effectiveDeposit;
		// `cumulativeAmount` snapshots this outcome's depth immediately after this append.
		// If this outcome later wins, settlement intentionally uses this append order to determine
		// which interval of the deposit landed inside the later reward-eligible window.
		deposit.cumulativeAmount = newBalance;
		selectedOutcomeState.deposits.push(deposit);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
		unresolvedLocalDepositRefsByVault[depositor].push(_encodeLocalDepositRef(uint8(outcome), depositIndex));
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(uint8(outcome), depositIndex);
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
		emit DepositOnOutcome(
			depositor,
			outcome,
			deposit.amount,
			depositIndex,
			deposit.cumulativeAmount,
			escrowedRepByVault[depositor],
			totalEscrowedRep
		);
		if (hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
			emit NonDecisionReached(nonDecisionTimestamp);
		}
	}

	function _initializeStartParams(uint256 _startBond, uint256 _nonDecisionThreshold) private {
		require(owner == msg.sender, 'Only game owner');
		require(activationTime == 0, 'Game started');
		require(_nonDecisionThreshold > _startBond, 'Threshold too low');
		require(_startBond > 0, 'Start bond zero');
		require(_startBond >= 1e18, 'Start bond below 1 REP');
		require(_nonDecisionThreshold >= 1e18, 'Threshold below 1 REP');
		startBond = _startBond;
		nonDecisionThreshold = _nonDecisionThreshold;
		lnRatioScaled = proofVerifier.computeLnRatioScaled(_startBond, _nonDecisionThreshold);
	}
}
