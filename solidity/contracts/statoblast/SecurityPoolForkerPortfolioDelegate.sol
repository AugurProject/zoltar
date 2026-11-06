// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolPortfolioNative } from './interfaces/ISecurityPoolPortfolioNative.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ESCALATION_TIME_LENGTH } from './EscalationGameTypes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';

/// @notice Materialize one question directly from its last live source game.
/// @dev Portfolio assets already migrated at branch level. No per-question truth
/// auction, vault migration, ancestor walk, or reporter-token transfer occurs here.
contract SecurityPoolForkerPortfolioDelegate {
	Zoltar public immutable zoltar;
	constructor(Zoltar protocol) {
		require(address(protocol).code.length != 0, 'Native fork protocol is missing');
		zoltar = protocol;
	}

	/// @notice Optional first-use preparation keeps deployment and maximum-size carry installation in separate transactions.
	function preparePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) external returns (ISecurityPool child) {
		(child, , ) = _preparePortfolioQuestion(source, targetUniverse);
	}

	function materializePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) public returns (ISecurityPool child) {
		ISecurityPoolPortfolioNative portfolio;
		address sourceGame;
		(child, portfolio, sourceGame) = _preparePortfolioQuestion(source, targetUniverse);
		if (child.systemState() == SystemState.Operational) return child;
		if (zoltar.getForkTime(targetUniverse) != 0) {
			(SecurityPoolReporterLedger.Question memory state, bool finalClaim) = SecurityPoolReporterLedger(portfolio.reporterLedger(targetUniverse)).question(targetUniverse, source.questionId());
			require((finalClaim && state.balanceAttoRep != 0) || _hasProtectedQuestionCash(portfolio, targetUniverse, source.questionId()), 'Only finalized questions can activate in a forked universe');
		}
		if (sourceGame != address(0) && !_continueReporterGame(portfolio, source, child, EscalationGame(sourceGame)))
			return child;
		child.setSystemState(SystemState.Operational);
		if (sourceGame != address(0)) {
			portfolio.registerReporterGame(address(child.escalationGame()));
			child.resumeForkedEscalationGame();
			_validateFinalizedContinuation(portfolio, child);
		}
		child.updateSettlementCollateral();
	}

	/// @dev Late materialization may checkpoint an inherited deadline, never replace
	/// it with now. Refuse an operational game whose final claims disagree with custody.
	function _validateFinalizedContinuation(ISecurityPoolPortfolioNative portfolio, ISecurityPool child) private view {
		EscalationGame game = child.escalationGame();
		if (game.getFinalQuestionResolution() == BinaryOutcomes.BinaryOutcome.None) return;
		uint248 universe = child.universeId();
		uint48 finalAfter = portfolio.logicalTimeForNative(universe, uint48(game.getEscalationGameEndDate()));
		uint48 minimum = portfolio.logicalTimeForNative(universe, 0) + 3 days;
		(SecurityPoolReporterLedger.Question memory reporter, ) = SecurityPoolReporterLedger(portfolio.reporterLedger(universe)).question(universe, child.questionId());
		require(reporter.finalAfter != 0 && (reporter.finalAfter > minimum ? reporter.finalAfter : minimum) == finalAfter, 'Reporter continuation finality mismatch');
		SecurityPoolPortfolioSettlement settlement = SecurityPoolPortfolioSettlement(portfolio.settlement());
		(SecurityPoolSettlementBook.Question memory claim, ) = settlement.ledger().question(settlement.bookIds(universe), child.questionId());
		if (claim.outcomeSupplyAttoShares != 0)
			require(claim.finalAfter != 0 && (claim.finalAfter > minimum ? claim.finalAfter : minimum) == finalAfter, 'Settlement continuation finality mismatch');
	}

	function _hasProtectedQuestionCash(ISecurityPoolPortfolioNative portfolio, uint248 universe, uint256 questionId) private view returns (bool) {
		SecurityPoolPortfolioSettlement engine = SecurityPoolPortfolioSettlement(portfolio.settlement());
		SecurityPoolSettlementBook ledger = engine.ledger();
		uint64 bookId = engine.bookIds(universe);
		(SecurityPoolSettlementBook.Question memory question, uint64 frozenBookId) = ledger.question(bookId, questionId);
		if (frozenBookId == 0 || question.outcomeSupplyAttoShares == 0) return false;
		(, , uint64 sourceBookId, ) = ledger.frozenBooks(frozenBookId);
		return sourceBookId == bookId;
	}

	/// @dev The source share namespace may be a prepared pool without its own game.
	function materializeImmediatePortfolioChild(ISecurityPool source, uint256 outcomeIndex) external returns (ISecurityPool) {
		uint248 targetUniverse = zoltar.getChildUniverseId(source.universeId(), outcomeIndex);
		ISecurityPoolPortfolioNative portfolio = ISecurityPoolPortfolioNative(source.securityPoolFactory().getSecurityPoolPortfolio(source));
		portfolio.prepareQuestionUniverse(targetUniverse);
		address game = portfolio.sourceGame(targetUniverse, source.questionId());
		if (game != address(0)) source = EscalationGame(game).securityPool();
		return materializePortfolioQuestion(source, targetUniverse);
	}

	function _preparePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) private returns (ISecurityPool child, ISecurityPoolPortfolioNative portfolio, address sourceGame) {
		ISecurityPoolFactory factory = source.securityPoolFactory();
		bytes32 origin = factory.getSecurityPoolOriginId(source);
		require(address(factory.getSecurityPool(origin, source.universeId())) == address(source), 'Source pool is not canonical');
		address authority = factory.getSecurityPoolPortfolio(source);
		require(authority != address(0) && source.portfolioCustody() != address(0), 'Source is not a bound portfolio question');
		require(zoltar.getForkTime(source.universeId()) != 0, 'Source universe has not forked');
		portfolio = ISecurityPoolPortfolioNative(authority);
		portfolio.prepareQuestionUniverse(targetUniverse);
		child = factory.getSecurityPool(origin, targetUniverse);
		if (address(child) != address(0) && child.systemState() == SystemState.Operational)
			return (child, portfolio, address(0));
		SecurityPoolReporterLedger reporters = SecurityPoolReporterLedger(portfolio.reporterLedger(targetUniverse));
		reporters.checkpoint(targetUniverse);
		(SecurityPoolReporterLedger.Question memory reporterState, ) = reporters.question(targetUniverse, source.questionId());
		sourceGame = reporterState.sourceGame;
		require(sourceGame == address(0) || sourceGame == address(source.escalationGame()), 'Use last live reporter source');
		if (address(child) != address(0)) {
			require(address(child.parent()) == address(source), 'Use prepared question source');
			return (child, portfolio, sourceGame);
		}
		factory.preparePortfolioPriceFeed(source, targetUniverse);
		(child, ) = factory.deployChildSecurityPool(source, source.shareToken(), targetUniverse, source.questionId(), source.statoblastSecurityMultiplierBps(), 0, 0);
		require(child.truthAuction() == address(0), 'Portfolio question cannot have a truth auction');
		source.authorizeChildPool(child);
		portfolio.registerChildPool(child);
		if (zoltar.getForkTime(targetUniverse) != 0) child.setSystemState(SystemState.PoolForked);
	}

	function getQuestionOutcome(ISecurityPool pool) external view returns (BinaryOutcomes.BinaryOutcome) {
		if (pool.systemState() != SystemState.Operational) return BinaryOutcomes.BinaryOutcome.None;
		EscalationGame game = pool.escalationGame();
		if (address(game) != address(0)) return game.getFinalQuestionResolution();
		ISecurityPoolPortfolioNative portfolio = ISecurityPoolPortfolioNative(pool.securityPoolFactory().getSecurityPoolPortfolio(pool));
		(bool isFixed, uint256 fixedValue) = portfolio.inheritedFixedOutcome(pool.universeId(), pool.questionId());
		uint48 anchor = portfolio.logicalTimeForNative(pool.universeId(), 0);
		return
			isFixed && portfolio.logicalTime(pool.universeId()) > anchor + 3 days
				? BinaryOutcomes.BinaryOutcome(fixedValue)
				: BinaryOutcomes.BinaryOutcome.None;
	}

	function _continueReporterGame(ISecurityPoolPortfolioNative portfolio, ISecurityPool source, ISecurityPool child, EscalationGame game) private returns (bool complete) {
		if (address(child.escalationGame()) == address(0)) _initializeReporterGame(portfolio, source, child, game);
		(
			bytes32[64][3] memory peaks,
			uint256[3] memory leafCounts,
			uint256[3] memory carryTotals,
			bytes32[3] memory nullifierRoots
		) = game.getForkCarrySnapshot();
		uint256[3] memory balances = game.getOutcomeBalancesAttoRep();
		bytes32[3] memory carryRoots = game.getForkCarryRoots();
		bytes32 snapshotId = keccak256(abi.encode(address(game), carryRoots, nullifierRoots, leafCounts, carryTotals, balances));
		// At most one fixed 64-peak outcome is installed per transaction. Keep the
		// reporter source and native pool inactive until all three are complete.
		uint8 outcomeIndex = child.escalationGame().forkCarrySnapshotOutcomesInitialized();
		if (outcomeIndex < 3)
			child.initializeForkCarryOutcome(address(game), snapshotId, peaks[outcomeIndex], leafCounts[outcomeIndex], carryTotals[outcomeIndex], balances[outcomeIndex], nullifierRoots[outcomeIndex]);
		return child.escalationGame().forkCarrySnapshotInitialized();
	}

	function _initializeReporterGame(ISecurityPoolPortfolioNative portfolio, ISecurityPool source, ISecurityPool child, EscalationGame game) private {
		uint48 logicalAnchor = portfolio.logicalTimeForNative(child.universeId(), 0);
		uint256 sourceStart = game.forkContinuation() ? game.forkResumedAt() : game.activationTime();
		require(sourceStart != 0 && sourceStart <= type(uint48).max, 'Source reporter clock is invalid');
		uint256 logicalStart = portfolio.logicalTimeForNative(source.universeId(), uint48(sourceStart));
		int256 elapsed = game.forkContinuation() ? game.forkElapsedAtStart() : int256(0);
		// Preserve pre-activation time too: dropping a negative offset makes the
		// game finalize before its inherited settlement and reporter schedules.
		elapsed += int256(uint256(logicalAnchor)) - int256(logicalStart);
		if (elapsed > int256(ESCALATION_TIME_LENGTH)) elapsed = int256(ESCALATION_TIME_LENGTH);
		(bool fixedOutcome, uint256 outcome) = portfolio.inheritedFixedOutcome(child.universeId(), child.questionId());
		require(!fixedOutcome || outcome < uint256(BinaryOutcomes.BinaryOutcome.None), 'Unsupported inherited reporter outcome');
		child.setAwaitingForkContinuation(true);
		child.initializeForkedEscalationGame(game.startBondAttoRep(), game.nonDecisionThresholdAttoRep(), elapsed, fixedOutcome ? BinaryOutcomes.BinaryOutcome(outcome) : BinaryOutcomes.BinaryOutcome.None);
	}
}
