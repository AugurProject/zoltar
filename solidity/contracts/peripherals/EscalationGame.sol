// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { EscalationGameSettlement } from './EscalationGameSettlement.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { ESCALATION_TIME_LENGTH, OutcomeState } from './EscalationGameTypes.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';

contract EscalationGame is EscalationGameSettlement {
	EscalationGameDepositDelegate private immutable depositDelegate;

	constructor(
		ISecurityPool _securityPool,
		ReputationToken _repToken,
		EscalationGameProofVerifier _proofVerifier
	) EscalationGameState(_securityPool, _repToken, _proofVerifier) {
		depositDelegate = new EscalationGameDepositDelegate();
	}

	function start(uint256 _startBond, uint256 _nonDecisionThreshold) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		fixedQuestionOutcome = BinaryOutcomes.BinaryOutcome.None;
		activationTime = block.timestamp + activationDelay;
		emit GameStarted(activationTime, startBond, nonDecisionThreshold);
	}

	function startFromFork(
		uint256 _startBond,
		uint256 _nonDecisionThreshold,
		uint256 elapsedAtFork,
		BinaryOutcomes.BinaryOutcome _fixedQuestionOutcome
	) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		require(elapsedAtFork <= ESCALATION_TIME_LENGTH, 'Fork time too high');
		forkContinuation = true;
		forkElapsedAtStart = elapsedAtFork;
		fixedQuestionOutcome = _fixedQuestionOutcome;
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
		require(msg.sender == address(securityPool), 'Only security pool');
		(bool success, bytes memory returnData) = address(depositDelegate).delegatecall(
			abi.encodeCall(
				EscalationGameDepositDelegate.recordDeposit,
				(depositor, outcome, amount, expectedCumulativeAmount)
			)
		);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(returnData, 0x20), mload(returnData))
			}
		}
		parentDepositIndex = abi.decode(returnData, (uint256));
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
