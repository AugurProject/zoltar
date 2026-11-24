// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { QuestionForkerDelegate } from './QuestionForkerDelegate.sol';
import { ISecurityPoolNative } from './interfaces/ISecurityPoolNative.sol';
import { DelegateCall } from './DelegateCall.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';

contract QuestionForker {
	Zoltar public immutable zoltar;
	address private immutable securityPoolDelegate;
	// Never delegate through a module address supplied by an external pool.

	constructor(Zoltar _zoltar, address _securityPoolDelegate) {
		require(address(_zoltar).code.length != 0 && _securityPoolDelegate.code.length != 0 && address(QuestionForkerDelegate(_securityPoolDelegate).zoltar()) == address(_zoltar), 'Invalid native security pool module');
		zoltar = _zoltar;
		securityPoolDelegate = _securityPoolDelegate;
	}

	/// @notice Freezes question accounting in a forked universe; reporter and capital migration follow their separate ledgers. Callable by anyone.
	function initiateQuestionLedgerFork(IQuestionLedger questionLedger) external {
		require(zoltar.getForkTime(questionLedger.universeId()) != 0, 'Universe has not forked');
		require(QuestionForkerDelegate(securityPoolDelegate).getQuestionOutcome(questionLedger) == BinaryOutcomes.BinaryOutcome.None, 'Question finalized before fork');
		questionLedger.activateForkMode();
	}

	function _delegateMigrationCall(address delegate, bytes memory callData) private returns (bytes memory data) {
		return DelegateCall.invoke(delegate, callData);
	}

	/// @notice Prepares a question pool in an eligible target universe; returns the existing child when it is already prepared.
	function prepareSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger) {
		return
			abi.decode(DelegateCall.invoke(securityPoolDelegate, abi.encodeCall(QuestionForkerDelegate.prepareSecurityPoolQuestion, (source, targetUniverse))), (IQuestionLedger));
	}

	function materializeSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger) {
		return
			abi.decode(DelegateCall.invoke(securityPoolDelegate, abi.encodeCall(QuestionForkerDelegate.materializeSecurityPoolQuestion, (source, targetUniverse))), (IQuestionLedger));
	}

	function createChildUniverse(IQuestionLedger questionLedger, uint256 outcomeIndex) external {
		_delegateMigrationCall(securityPoolDelegate, abi.encodeCall(QuestionForkerDelegate.materializeImmediateSecurityPoolChild, (questionLedger, outcomeIndex)));
	}

	/// @notice Forks the universe on the pool's own question once its escalation game allows it, burning reporter-ledger REP; callable by anyone.
	/// @dev When the live fork threshold exceeds the question's escrow (genesis supply grew after the game started),
	/// the caller pays the shortfall from REP approved to the reporter ledger; see `getOwnForkAdmissionShortfall`.
	function forkZoltarWithOwnEscalationGame(IQuestionLedger questionLedger) external {
		ISecurityPoolNative(questionLedger.securityPoolFactory().securityPoolOf(questionLedger)).forkWithReporterQuestion(questionLedger, msg.sender);
		questionLedger.activateForkMode();
	}

	/// @notice Returns the reporter ledger a caller of `forkZoltarWithOwnEscalationGame` must approve and the REP it pulls from that caller.
	function getOwnForkAdmissionShortfall(IQuestionLedger questionLedger) external view returns (address reporterLedger, uint256 shortfallAttoRep) {
		uint248 universeId = questionLedger.universeId();
		reporterLedger = ISecurityPoolNative(questionLedger.securityPoolFactory().securityPoolOf(questionLedger)).reporterLedger(universeId);
		shortfallAttoRep = SecurityPoolReporterLedger(reporterLedger).forkAdmissionShortfallAttoRep(universeId, questionLedger.questionId());
	}

	/// @notice Returns the pool's final question outcome, or None while unresolved or while the pool is forked.
	function getQuestionOutcome(IQuestionLedger questionLedger) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		return QuestionForkerDelegate(securityPoolDelegate).getQuestionOutcome(questionLedger);
	}
}
