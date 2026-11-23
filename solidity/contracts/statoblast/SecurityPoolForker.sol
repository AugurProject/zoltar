// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { SecurityPoolForkerPortfolioDelegate } from './SecurityPoolForkerPortfolioDelegate.sol';
import { ISecurityPoolPortfolioNative } from './interfaces/ISecurityPoolPortfolioNative.sol';
import { DelegateCall } from './DelegateCall.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';

contract SecurityPoolForker {
	Zoltar public immutable zoltar;
	address private immutable portfolioDelegate;
	// Never delegate through a module address supplied by an external pool.

	constructor(Zoltar _zoltar, address _portfolioDelegate) {
		require(address(_zoltar).code.length != 0 && _portfolioDelegate.code.length != 0 && address(SecurityPoolForkerPortfolioDelegate(_portfolioDelegate).zoltar()) == address(_zoltar), 'Invalid native portfolio module');
		zoltar = _zoltar;
		portfolioDelegate = _portfolioDelegate;
	}

	/// @notice Freezes question accounting in a forked universe; reporter and capital migration follow their separate ledgers. Callable by anyone.
	function initiateSecurityPoolFork(ISecurityPool securityPool) external {
		require(zoltar.getForkTime(securityPool.universeId()) != 0, 'Universe has not forked');
		require(SecurityPoolForkerPortfolioDelegate(portfolioDelegate).getQuestionOutcome(securityPool) == BinaryOutcomes.BinaryOutcome.None, 'Question finalized before fork');
		securityPool.activateForkMode();
	}

	function _delegateMigrationCall(address delegate, bytes memory callData) private returns (bytes memory data) {
		return DelegateCall.invoke(delegate, callData);
	}

	/// @notice Prepares a question pool in an eligible target universe; returns the existing child when it is already prepared.
	function preparePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) external returns (ISecurityPool) {
		return
			abi.decode(DelegateCall.invoke(portfolioDelegate, abi.encodeCall(SecurityPoolForkerPortfolioDelegate.preparePortfolioQuestion, (source, targetUniverse))), (ISecurityPool));
	}

	function materializePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) external returns (ISecurityPool) {
		return
			abi.decode(DelegateCall.invoke(portfolioDelegate, abi.encodeCall(SecurityPoolForkerPortfolioDelegate.materializePortfolioQuestion, (source, targetUniverse))), (ISecurityPool));
	}

	function createChildUniverse(ISecurityPool securityPool, uint256 outcomeIndex) external {
		_delegateMigrationCall(portfolioDelegate, abi.encodeCall(SecurityPoolForkerPortfolioDelegate.materializeImmediatePortfolioChild, (securityPool, outcomeIndex)));
	}

	/// @notice Forks the universe on the pool's own question once its escalation game allows it, burning reporter-ledger REP; callable by anyone.
	/// @dev When the live fork threshold exceeds the question's escrow (genesis supply grew after the game started),
	/// the caller pays the shortfall from REP approved to the reporter ledger; see `getOwnForkAdmissionShortfall`.
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external {
		ISecurityPoolPortfolioNative(securityPool.securityPoolFactory().getSecurityPoolPortfolio(securityPool)).forkWithReporterQuestion(securityPool, msg.sender);
		securityPool.activateForkMode();
	}

	/// @notice Returns the reporter ledger a caller of `forkZoltarWithOwnEscalationGame` must approve and the REP it pulls from that caller.
	function getOwnForkAdmissionShortfall(ISecurityPool securityPool) external view returns (address reporterLedger, uint256 shortfallAttoRep) {
		uint248 universeId = securityPool.universeId();
		reporterLedger = ISecurityPoolPortfolioNative(securityPool.securityPoolFactory().getSecurityPoolPortfolio(securityPool)).reporterLedger(universeId);
		shortfallAttoRep = SecurityPoolReporterLedger(reporterLedger).forkAdmissionShortfallAttoRep(universeId, securityPool.questionId());
	}

	/// @notice Returns the pool's final question outcome, or None while unresolved or while the pool is forked.
	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome) {
		return SecurityPoolForkerPortfolioDelegate(portfolioDelegate).getQuestionOutcome(securityPool);
	}
}
