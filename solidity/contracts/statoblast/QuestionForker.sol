// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { QuestionForkerDelegate } from './QuestionForkerDelegate.sol';
import { ISecurityPoolPortfolioNative } from './interfaces/ISecurityPoolPortfolioNative.sol';
import { DelegateCall } from './DelegateCall.sol';

contract QuestionForker {
	Zoltar public immutable zoltar;
	address private immutable portfolioDelegate;
	// Never delegate through a module address supplied by an external pool.

	constructor(Zoltar _zoltar, address _portfolioDelegate) {
		require(address(_zoltar).code.length != 0 && _portfolioDelegate.code.length != 0 && address(QuestionForkerDelegate(_portfolioDelegate).zoltar()) == address(_zoltar), 'Invalid native portfolio module');
		zoltar = _zoltar;
		portfolioDelegate = _portfolioDelegate;
	}

	/// @notice Freezes question accounting in a forked universe; reporter and capital migration follow their separate ledgers. Callable by anyone.
	function initiateQuestionLedgerFork(IQuestionLedger questionLedger) external {
		require(zoltar.getForkTime(questionLedger.universeId()) != 0, 'Universe has not forked');
		require(QuestionForkerDelegate(portfolioDelegate).getQuestionOutcome(questionLedger) == BinaryOutcomes.BinaryOutcome.None, 'Question finalized before fork');
		questionLedger.activateForkMode();
	}

	function _delegateMigrationCall(address delegate, bytes memory callData) private returns (bytes memory data) {
		return DelegateCall.invoke(delegate, callData);
	}

	/// @notice Prepares a question pool in an eligible target universe; returns the existing child when it is already prepared.
	function preparePortfolioQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger) {
		return
			abi.decode(DelegateCall.invoke(portfolioDelegate, abi.encodeCall(QuestionForkerDelegate.preparePortfolioQuestion, (source, targetUniverse))), (IQuestionLedger));
	}

	function materializePortfolioQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger) {
		return
			abi.decode(DelegateCall.invoke(portfolioDelegate, abi.encodeCall(QuestionForkerDelegate.materializePortfolioQuestion, (source, targetUniverse))), (IQuestionLedger));
	}

	function createChildUniverse(IQuestionLedger questionLedger, uint256 outcomeIndex) external {
		_delegateMigrationCall(portfolioDelegate, abi.encodeCall(QuestionForkerDelegate.materializeImmediatePortfolioChild, (questionLedger, outcomeIndex)));
	}

	/// @notice Forks the universe on the pool's own question once its escalation game allows it, burning reporter-ledger REP; callable by anyone.
	function forkZoltarWithOwnEscalationGame(IQuestionLedger questionLedger) external {
		ISecurityPoolPortfolioNative(questionLedger.securityPoolFactory().getSecurityPoolPortfolio(questionLedger)).forkWithReporterQuestion(questionLedger);
		questionLedger.activateForkMode();
	}

	/// @notice Returns the pool's final question outcome, or None while unresolved or while the pool is forked.
	function getQuestionOutcome(IQuestionLedger questionLedger) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		return QuestionForkerDelegate(portfolioDelegate).getQuestionOutcome(questionLedger);
	}
}
