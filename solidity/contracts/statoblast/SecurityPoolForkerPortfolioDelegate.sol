// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedCast } from '../CheckedCast.sol';

import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolPortfolioNative } from './interfaces/ISecurityPoolPortfolioNative.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ESCALATION_TIME_LENGTH } from './EscalationGameTypes.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';

/// @notice Materialize one question directly from its last live source game.
/// @dev Portfolio assets already migrated at branch level. No per-question collateral
/// repair auction, vault migration, ancestor walk, or reporter-token transfer occurs here.
contract SecurityPoolForkerPortfolioDelegate {
	Zoltar public immutable zoltar;
	constructor(Zoltar protocol) {
		require(address(protocol).code.length != 0, 'Native fork protocol is missing');
		zoltar = protocol;
	}

	/// @notice Optional first-use preparation keeps deployment and maximum-size carry installation in separate transactions.
	function preparePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) external returns (ISecurityPool child) {
		(child, , , ) = _preparePortfolioQuestion(source, targetUniverse);
	}

	function materializePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) public returns (ISecurityPool child) {
		ISecurityPoolPortfolioNative portfolio;
		address sourceGame;
		(child, portfolio, sourceGame, source) = _preparePortfolioQuestion(source, targetUniverse);
		if (child.systemState() == SystemState.Operational) return child;
		if (zoltar.getForkTime(targetUniverse) != 0)
			require(_canActivateInForkedUniverse(portfolio, targetUniverse, source.questionId()), 'Only finalized questions can activate in a forked universe');
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
		uint48 finalAfter = portfolio.portfolioTimeForNative(universe, CheckedCast.toUint48(game.getEscalationGameEndDate()));
		uint48 minimum = portfolio.portfolioTimeForNative(universe, 0) + 3 days;
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
		// Share migration must not depend on someone else having deployed the branch.
		if (address(zoltar.getRepToken(targetUniverse)) == address(0))
			zoltar.deployChild(source.universeId(), outcomeIndex);
		ISecurityPoolPortfolioNative portfolio = ISecurityPoolPortfolioNative(source.securityPoolFactory().getSecurityPoolPortfolio(source));
		portfolio.prepareQuestionUniverse(targetUniverse);
		address game = portfolio.sourceGame(targetUniverse, source.questionId());
		if (game != address(0)) source = EscalationGame(game).securityPool();
		// A target that forked before this question was materialized there cannot
		// activate a live question. Its prepared, forked ledger is all that shares
		// need in order to migrate on through that universe.
		if (zoltar.getForkTime(targetUniverse) != 0) {
			(ISecurityPool child, ISecurityPoolPortfolioNative authority, , ) = _preparePortfolioQuestion(source, targetUniverse);
			if (
				child.systemState() == SystemState.Operational ||
				!_canActivateInForkedUniverse(authority, targetUniverse, source.questionId())
			) return child;
		}
		return materializePortfolioQuestion(source, targetUniverse);
	}

	function _canActivateInForkedUniverse(ISecurityPoolPortfolioNative portfolio, uint248 targetUniverse, uint256 questionId) private view returns (bool) {
		(SecurityPoolReporterLedger.Question memory state, bool finalClaim) = SecurityPoolReporterLedger(portfolio.reporterLedger(targetUniverse)).question(targetUniverse, questionId);
		return
			(finalClaim && state.balanceAttoRep != 0) ||
			_hasProtectedQuestionCash(portfolio, targetUniverse, questionId);
	}

	/// @dev Returns the effective source: an existing ledger's immutable parent, otherwise
	/// the caller's canonical source after proving the target descends from its universe.
	function _preparePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) private returns (ISecurityPool child, ISecurityPoolPortfolioNative portfolio, address sourceGame, ISecurityPool) {
		ISecurityPoolFactory factory = source.securityPoolFactory();
		bytes32 origin = factory.getSecurityPoolOriginId(source);
		require(address(factory.getSecurityPool(origin, source.universeId())) == address(source), 'Source pool is not canonical');
		address authority = factory.getSecurityPoolPortfolio(source);
		require(authority != address(0) && source.portfolioCustody() != address(0), 'Source is not a bound portfolio question');
		require(zoltar.getForkTime(source.universeId()) != 0, 'Source universe has not forked');
		portfolio = ISecurityPoolPortfolioNative(authority);
		portfolio.prepareQuestionUniverse(targetUniverse);
		child = factory.getSecurityPool(origin, targetUniverse);
		// An already operational child returns before its parent is checked, so prove its factory first.
		if (address(child) != address(0))
			require(address(child.securityPoolFactory()) == address(factory), 'Child pool is not from the source factory');
		if (address(child) != address(0)) {
			if (child.systemState() == SystemState.Operational) return (child, portfolio, address(0), source);
			// The forker deployed this child from a proven canonical parent, so any caller
			// completes the prepared ledger whatever ancestor source it names.
			source = child.parent();
		} else {
			_requireDescendant(source.universeId(), targetUniverse);
		}
		SecurityPoolReporterLedger reporters = SecurityPoolReporterLedger(portfolio.reporterLedger(targetUniverse));
		reporters.checkpoint(targetUniverse);
		(SecurityPoolReporterLedger.Question memory reporterState, bool finalClaim) = reporters.question(targetUniverse, source.questionId());
		require(!finalClaim || reporterState.balanceAttoRep != 0, 'Question finalized in source universe');
		sourceGame = reporterState.sourceGame;
		require(sourceGame == address(0) || sourceGame == address(source.escalationGame()), 'Use last live reporter source');
		if (address(child) != address(0)) return (child, portfolio, sourceGame, source);
		factory.preparePortfolioPriceFeed(source, targetUniverse);
		child = factory.deployChildSecurityPool(source, source.shareToken(), targetUniverse, source.questionId(), source.statoblastSecurityMultiplierBps());
		_requireChildProvenance(factory, source, child, targetUniverse);
		source.authorizeChildPool(child);
		portfolio.registerChildPool(child);
		if (zoltar.getForkTime(targetUniverse) != 0) child.setSystemState(SystemState.PoolForked);
		return (child, portfolio, sourceGame, source);
	}

	/// @dev A sibling or unrelated branch must never become a ledger's immutable parent.
	/// The walk ends at genesis; each step is a real fork, so depth stays small.
	function _requireDescendant(uint248 ancestor, uint248 universe) private view {
		while (universe != 0) {
			(, , , , universe) = zoltar.universes(universe);
			if (universe == ancestor) return;
		}
		revert('Target universe does not descend from source');
	}

	/// @dev `source` and everything derived from it are caller-supplied. A pool's factory is
	/// immutable, so a child that names `factory` proves the factory, and therefore the
	/// canonical source lookup, before this forker uses its privileges on the child.
	function _requireChildProvenance(ISecurityPoolFactory factory, ISecurityPool source, ISecurityPool child, uint248 targetUniverse) private view {
		require(address(child.securityPoolFactory()) == address(factory), 'Child pool is not from the source factory');
		require(address(child.parent()) == address(source) && child.universeId() == targetUniverse && address(child.shareToken()) == address(source.shareToken()), 'Child pool does not continue the source');
	}

	function getQuestionOutcome(ISecurityPool pool) external view returns (BinaryOutcomes.BinaryOutcome) {
		if (pool.systemState() != SystemState.Operational) return BinaryOutcomes.BinaryOutcome.None;
		EscalationGame game = pool.escalationGame();
		if (address(game) != address(0)) return game.getFinalQuestionResolution();
		ISecurityPoolPortfolioNative portfolio = ISecurityPoolPortfolioNative(pool.securityPoolFactory().getSecurityPoolPortfolio(pool));
		(bool isFixed, uint256 fixedValue) = portfolio.inheritedFixedOutcome(pool.universeId(), pool.questionId());
		require(!isFixed || fixedValue < uint256(BinaryOutcomes.BinaryOutcome.None), 'Unsupported inherited reporter outcome');
		uint48 anchor = portfolio.portfolioTimeForNative(pool.universeId(), 0);
		return
			isFixed && portfolio.portfolioTime(pool.universeId()) > anchor + 3 days
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
		uint48 portfolioTimeAnchor = portfolio.portfolioTimeForNative(child.universeId(), 0);
		uint256 sourceStart = game.forkContinuation() ? game.forkResumedAt() : game.activationTime();
		require(sourceStart != 0 && sourceStart <= type(uint48).max, 'Source reporter clock is invalid');
		uint256 portfolioStartTime = portfolio.portfolioTimeForNative(source.universeId(), CheckedCast.toUint48(sourceStart));
		int256 elapsed = game.forkContinuation() ? game.forkElapsedAtStart() : int256(0);
		// Preserve pre-activation time too: dropping a negative offset makes the
		// game finalize before its inherited settlement and reporter schedules.
		elapsed += int256(uint256(portfolioTimeAnchor)) - int256(portfolioStartTime);
		if (elapsed > int256(ESCALATION_TIME_LENGTH)) elapsed = int256(ESCALATION_TIME_LENGTH);
		(bool fixedOutcome, uint256 outcome) = portfolio.inheritedFixedOutcome(child.universeId(), child.questionId());
		require(!fixedOutcome || outcome < uint256(BinaryOutcomes.BinaryOutcome.None), 'Unsupported inherited reporter outcome');
		child.setAwaitingForkContinuation(true);
		child.initializeForkedEscalationGame(game.startBondAttoRep(), game.nonDecisionThresholdAttoRep(), elapsed, fixedOutcome ? BinaryOutcomes.BinaryOutcome(outcome) : BinaryOutcomes.BinaryOutcome.None);
	}
}
