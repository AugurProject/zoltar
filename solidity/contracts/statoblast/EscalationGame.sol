// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { EscalationGameSettlement } from './EscalationGameSettlement.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { ESCALATION_TIME_LENGTH, NonDecisionState } from './EscalationGameTypes.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';

contract EscalationGame is EscalationGameSettlement {
	EscalationGameDepositDelegate private immutable depositDelegate;

	constructor(IQuestionLedger _questionLedger, ReputationToken _repToken, EscalationGameProofVerifier _proofVerifier, EscalationGameDepositDelegate _depositDelegate) EscalationGameState(_questionLedger, _repToken, _proofVerifier) {
		fixedQuestionOutcome = BinaryOutcomes.BinaryOutcome.None;
		require(address(_depositDelegate).code.length > 0, 'Deposit delegate');
		depositDelegate = _depositDelegate;
	}

	function start(uint256 _startBondAttoRep, uint256 _nonDecisionThresholdAttoRep) external {
		_initializeStartParams(_startBondAttoRep, _nonDecisionThresholdAttoRep);
		activationTime = block.timestamp + ACTIVATION_DELAY;
		emit GameStarted(activationTime, startBondAttoRep, nonDecisionThresholdAttoRep);
	}

	function startFromFork(uint256 _startBondAttoRep, uint256 _nonDecisionThresholdAttoRep, int256 elapsedAtFork, BinaryOutcomes.BinaryOutcome _fixedQuestionOutcome, bool _winnerHaircutPaidByFork, uint256 _forkCarryInitialBackingAttoRep) external {
		_initializeStartParams(_startBondAttoRep, _nonDecisionThresholdAttoRep);
		if (elapsedAtFork < -int256(ACTIVATION_DELAY) || elapsedAtFork > int256(ESCALATION_TIME_LENGTH))
			revert('Invalid fork elapsed time');
		forkContinuation = true;
		forkElapsedAtStart = elapsedAtFork;
		fixedQuestionOutcome = _fixedQuestionOutcome;
		winnerHaircutPaidByFork = _winnerHaircutPaidByFork;
		forkCarryInitialBackingAttoRep = _forkCarryInitialBackingAttoRep;
		emit GameContinuedFromFork(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork);
	}

	function resumeFromFork() external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.resumeFromFork, ()));
	}

	function previewDepositOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep) external view returns (uint256 acceptedAmountAttoRep, uint256 resultingCumulativeAmountAttoRep) {
		// Keep one reason for this read-only quote path so the size-constrained game
		// can retain the state-changing paths' more specific failure reasons.
		// Deposits close once the curve passes the median and a provisional leader exists.
		require((!forkContinuation || (forkResumedAt != 0 && fixedQuestionOutcome == BinaryOutcomes.BinaryOutcome.None)) && _getUniverseForkTime() == 0 && outcome != BinaryOutcomes.BinaryOutcome.None && nonDecisionState == NonDecisionState.None && getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'Invalid deposit preview');
		uint256 outcomeIndex = uint256(outcome);
		uint256 currentBalance = outcomeState[outcomeIndex].balanceAttoRep;
		require(currentBalance < nonDecisionThresholdAttoRep && amountAttoRep >= startBondAttoRep, 'Invalid deposit preview');
		(acceptedAmountAttoRep, resultingCumulativeAmountAttoRep) = _getAcceptedDepositAmount(outcomeIndex, amountAttoRep, currentBalance, nonDecisionThresholdAttoRep - currentBalance);
		require(acceptedAmountAttoRep != 0, 'Invalid deposit preview');
	}

	/// @notice Quote a reply that must lead, or complete the non-decision threshold.
	function previewLeadingDepositOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external view returns (uint256 accepted, uint256 cumulative) {
		(accepted, cumulative) = this.previewDepositOnOutcome(outcome, maximumDepositAttoRep);
		for (uint8 index = 0; index < 3; index++) {
			if (index != uint8(outcome))
				require(cumulative > outcomeState[index].balanceAttoRep || cumulative == nonDecisionThresholdAttoRep, 'Deposit does not lead');
		}
	}

	function recordDepositFromQuestionLedger(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep, uint256 expectedCumulativeAttoRep) external returns (uint256 parentDepositIndex) {
		require(msg.sender == address(questionLedger), 'Only pool');
		bytes memory returnData = _delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.recordDeposit, (depositor, outcome, amountAttoRep, expectedCumulativeAttoRep)));
		parentDepositIndex = abi.decode(returnData, (uint256));
	}

	function depositRepOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.depositRepOnOutcome, (outcome, maximumDepositAttoRep)));
	}

	/// @notice Refuse to turn a quoted reply into trailing support after transaction reordering.
	function depositRepOnOutcomeWithLead(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.depositRepOnOutcomeWithLead, (outcome, maximumDepositAttoRep)));
	}

	function depositRepOnOutcomeWithAuthorizationAndLead(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 signatureS) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.depositRepOnOutcomeWithAuthorizationAndLead, (depositor, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, signatureS)));
	}

	function _initializeStartParams(uint256 _startBondAttoRep, uint256 _nonDecisionThresholdAttoRep) private {
		if (owner != msg.sender) revert('Only owner');
		// Both start paths set a positive start bond, so a zero bond marks an unstarted game. The factory reuses a
		// prepared game at its CREATE2 address, so the game itself must refuse a second start of either kind.
		require(startBondAttoRep == 0 && activationTime == 0 && _nonDecisionThresholdAttoRep > _startBondAttoRep && _startBondAttoRep > 0, 'Invalid game start');
		startBondAttoRep = _startBondAttoRep;
		nonDecisionThresholdAttoRep = _nonDecisionThresholdAttoRep;
		lnRatioScaled = proofVerifier.computeLnRatioScaled(_startBondAttoRep, _nonDecisionThresholdAttoRep);
	}

	function _getDepositDelegate() internal view override returns (address) {
		return address(depositDelegate);
	}

	/// @notice Routes only the signed deposit entry points to the deposit delegate.
	/// @dev Returns or reverts with the delegate's exact output.
	fallback() external {
		address depositDelegateAddress = address(depositDelegate);
		// Right-aligned selector words compare directly against `shr(224, calldataload(0))`.
		uint256 depositWithPermitSelector = uint32(EscalationGameDepositDelegate.depositRepOnOutcomeWithPermit.selector);
		uint256 depositWithAuthorizationSelector = uint32(EscalationGameDepositDelegate.depositRepOnOutcomeWithAuthorization.selector);
		uint256 depositWithPermitAndLeadSelector = uint32(EscalationGameDepositDelegate.depositRepOnOutcomeWithPermitAndLead.selector);
		assembly ('memory-safe') {
			let selector := shr(224, calldataload(0))
			// Only the signed and protected public deposit entrypoints reach the deposit
			// delegate. Unknown and internal-only selectors are rejected.
			if iszero(
				or(
					or(eq(selector, depositWithPermitSelector), eq(selector, depositWithAuthorizationSelector)),
					eq(selector, depositWithPermitAndLeadSelector)
				)
			) {
				revert(0, 0)
			}
			let pointer := mload(0x40)
			calldatacopy(pointer, 0, calldatasize())
			if iszero(delegatecall(gas(), depositDelegateAddress, pointer, calldatasize(), 0, 0)) {
				returndatacopy(pointer, 0, returndatasize())
				revert(pointer, returndatasize())
			}
			returndatacopy(pointer, 0, returndatasize())
			return(pointer, returndatasize())
		}
	}
}
