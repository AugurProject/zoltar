// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { EscalationGameSettlement } from './EscalationGameSettlement.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { ESCALATION_TIME_LENGTH, NonDecisionState, OutcomeState } from './EscalationGameTypes.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';
import { EscalationGameClaimDelegate } from './EscalationGameClaimDelegate.sol';

contract EscalationGame is EscalationGameSettlement {
	EscalationGameDepositDelegate private immutable depositDelegate;

	constructor(
		ISecurityPool _securityPool,
		ReputationToken _repToken,
		EscalationGameProofVerifier _proofVerifier,
		EscalationGameClaimDelegate _claimDelegate
	) EscalationGameState(_securityPool, _repToken, _proofVerifier, _claimDelegate) {
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
		BinaryOutcomes.BinaryOutcome _fixedQuestionOutcome,
		bool _winnerHaircutPaidByFork,
		uint256 _forkCarryInitialBacking
	) external {
		_initializeStartParams(_startBond, _nonDecisionThreshold);
		if (elapsedAtFork > ESCALATION_TIME_LENGTH) revert();
		forkContinuation = true;
		forkElapsedAtStart = elapsedAtFork;
		fixedQuestionOutcome = _fixedQuestionOutcome;
		winnerHaircutPaidByFork = _winnerHaircutPaidByFork;
		forkCarryInitialBacking = _forkCarryInitialBacking;
		emit GameContinuedFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function resumeFromFork() external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.resumeFromFork, ()));
	}

	function applyTruthAuctionHaircut(uint256 repToRemove) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.applyTruthAuctionHaircut, (repToRemove)));
	}

	function previewDepositOnOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount
	) external view returns (uint256 acceptedAmount, uint256 resultingCumulativeAmount) {
		// Keep one reason for this read-only quote path so the size-constrained game
		// can retain the state-changing paths' more specific failure reasons.
		require(
			nonDecisionState == NonDecisionState.None &&
				outcome != BinaryOutcomes.BinaryOutcome.None &&
				getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None &&
				outcomeState[uint8(outcome)].balance < nonDecisionThreshold &&
				amount >= startBond,
			'Invalid deposit preview'
		);
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
		bytes memory returnData = _delegateDepositCall(
			abi.encodeCall(
				EscalationGameDepositDelegate.recordDeposit,
				(depositor, outcome, amount, expectedCumulativeAmount)
			)
		);
		parentDepositIndex = abi.decode(returnData, (uint256));
	}

	function _initializeStartParams(uint256 _startBond, uint256 _nonDecisionThreshold) private {
		if (owner != msg.sender) revert();
		require(activationTime == 0 && _nonDecisionThreshold > _startBond && _startBond > 0, 'Invalid game start');
		startBond = _startBond;
		nonDecisionThreshold = _nonDecisionThreshold;
		lnRatioScaled = proofVerifier.computeLnRatioScaled(_startBond, _nonDecisionThreshold);
	}

	function _getDepositDelegate() internal view override returns (address) {
		return address(depositDelegate);
	}

	fallback() external {
		address claimDelegateAddress = address(claimDelegate);
		assembly ('memory-safe') {
			// Every selector not implemented by the inherited game belongs to the
			// shared claim module. Its normal dispatcher also rejects unknown calls.
			calldatacopy(0, 0, calldatasize())
			if iszero(delegatecall(gas(), claimDelegateAddress, 0, calldatasize(), 0, 0)) {
				returndatacopy(0, 0, returndatasize())
				revert(0, returndatasize())
			}
			returndatacopy(0, 0, returndatasize())
			return(0, returndatasize())
		}
	}
}
