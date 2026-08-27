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

	constructor(ISecurityPool _securityPool, ReputationToken _repToken, EscalationGameProofVerifier _proofVerifier, EscalationGameClaimDelegate _claimDelegate) EscalationGameState(_securityPool, _repToken, _proofVerifier, _claimDelegate) {
		depositDelegate = new EscalationGameDepositDelegate();
	}

	function start(uint256 _startBondAttoRep, uint256 _nonDecisionThresholdAttoRep) external {
		_initializeStartParams(_startBondAttoRep, _nonDecisionThresholdAttoRep);
		fixedQuestionOutcome = BinaryOutcomes.BinaryOutcome.None;
		activationTime = block.timestamp + activationDelay;
		emit GameStarted(activationTime, startBondAttoRep, nonDecisionThresholdAttoRep);
	}

	function startFromFork(uint256 _startBondAttoRep, uint256 _nonDecisionThresholdAttoRep, uint256 elapsedAtFork, BinaryOutcomes.BinaryOutcome _fixedQuestionOutcome, bool _winnerHaircutPaidByFork, uint256 _forkCarryInitialBackingAttoRep) external {
		_initializeStartParams(_startBondAttoRep, _nonDecisionThresholdAttoRep);
		if (elapsedAtFork > ESCALATION_TIME_LENGTH) revert();
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

	function applyTruthAuctionHaircut(uint256 repToRemoveAttoRep) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.applyTruthAuctionHaircut, (repToRemoveAttoRep)));
	}

	function previewDepositOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep) external view returns (uint256 acceptedAmountAttoRep, uint256 resultingCumulativeAmountAttoRep) {
		// Keep one reason for this read-only quote path so the size-constrained game
		// can retain the state-changing paths' more specific failure reasons.
		require(nonDecisionState == NonDecisionState.None && outcome != BinaryOutcomes.BinaryOutcome.None && getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None && outcomeState[uint8(outcome)].balanceAttoRep < nonDecisionThresholdAttoRep && amountAttoRep >= startBondAttoRep, 'Invalid deposit preview');
		uint256 outcomeIndex = uint256(outcome);
		uint256 currentBalance = outcomeState[outcomeIndex].balanceAttoRep;
		uint256 room = nonDecisionThresholdAttoRep - currentBalance;
		(acceptedAmountAttoRep, resultingCumulativeAmountAttoRep) = _getAcceptedDepositAmount(outcomeIndex, amountAttoRep, currentBalance, room);
	}

	function recordDepositFromSecurityPool(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep, uint256 expectedCumulativeAttoRep) external returns (uint256 parentDepositIndex) {
		require(msg.sender == address(securityPool), 'Only security pool');
		bytes memory returnData = _delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.recordDeposit, (depositor, outcome, amountAttoRep, expectedCumulativeAttoRep)));
		parentDepositIndex = abi.decode(returnData, (uint256));
	}

	function depositRepFromWallet(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.recordWalletDeposit, (outcome, maximumDepositAttoRep)));
	}

	function _initializeStartParams(uint256 _startBondAttoRep, uint256 _nonDecisionThresholdAttoRep) private {
		if (owner != msg.sender) revert();
		require(activationTime == 0 && _nonDecisionThresholdAttoRep > _startBondAttoRep && _startBondAttoRep > 0, 'Invalid game start');
		startBondAttoRep = _startBondAttoRep;
		nonDecisionThresholdAttoRep = _nonDecisionThresholdAttoRep;
		lnRatioScaled = proofVerifier.computeLnRatioScaled(_startBondAttoRep, _nonDecisionThresholdAttoRep);
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
