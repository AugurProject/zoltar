// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedCast } from '../CheckedCast.sol';

import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { Zoltar } from '../Zoltar.sol';
import { IQuestionLedger, ISecurityPoolFactory, SystemState } from './interfaces/IQuestionLedger.sol';
import { ISecurityPoolNative } from './interfaces/ISecurityPoolNative.sol';
import { EscalationGame } from './EscalationGame.sol';
import { EscalationGameRepCustody } from './EscalationGameRepCustody.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ESCALATION_TIME_LENGTH } from './EscalationGameTypes.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { Constants } from '../Constants.sol';

/// @notice Materialize one question directly from its last live source game.
/// @dev Security pool assets already migrated at branch level. No per-question collateral
/// repair auction, vault migration, ancestor walk, or reporter-token transfer occurs here.
contract QuestionForker {
	Zoltar public immutable zoltar;
	constructor(Zoltar protocol) {
		require(address(protocol).code.length != 0, 'Native fork protocol is missing');
		zoltar = protocol;
	}

	/// @notice Freezes question accounting in a forked universe; reporter and capital migration follow their separate ledgers. Callable by anyone.
	function initiateQuestionLedgerFork(IQuestionLedger questionLedger) external {
		require(zoltar.getForkTime(questionLedger.universeId()) != 0, 'Universe has not forked');
		require(getQuestionOutcome(questionLedger) == BinaryOutcomes.BinaryOutcome.None, 'Question finalized before fork');
		questionLedger.activateForkMode();
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

	/// @notice Optional first-use preparation keeps deployment and maximum-size carry installation in separate transactions.
	function prepareSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger child) {
		(child, , , ) = _prepareSecurityPoolQuestion(source, targetUniverse);
	}

	function materializeSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) public returns (IQuestionLedger child) {
		ISecurityPoolNative securityPool;
		address sourceGame;
		(child, securityPool, sourceGame, source) = _prepareSecurityPoolQuestion(source, targetUniverse);
		if (child.systemState() == SystemState.Operational) return child;
		if (zoltar.getForkTime(targetUniverse) != 0)
			require(_canActivateInForkedUniverse(securityPool, targetUniverse, source.questionId()), 'Only finalized questions can activate in a forked universe');
		if (sourceGame != address(0) && !_continueReporterGame(securityPool, source, child, EscalationGame(sourceGame)))
			return child;
		child.setSystemState(SystemState.Operational);
		if (sourceGame != address(0)) {
			securityPool.registerReporterGame(address(child.escalationGame()));
			child.resumeForkedEscalationGame();
			_validateFinalizedContinuation(securityPool, child);
		}
		child.updateSettlementCollateral();
	}

	/// @dev Late materialization may checkpoint an inherited deadline, never replace
	/// it with now. Refuse an operational game whose final claims disagree with custody.
	function _validateFinalizedContinuation(ISecurityPoolNative securityPool, IQuestionLedger child) private view {
		EscalationGame game = child.escalationGame();
		if (game.getFinalQuestionResolution() == BinaryOutcomes.BinaryOutcome.None) return;
		uint248 universe = child.universeId();
		uint48 finalAfter = securityPool.securityPoolTimeForNative(universe, CheckedCast.toUint48(game.getEscalationGameEndDate()));
		(SecurityPoolReporterLedger.Question memory reporter, ) = SecurityPoolReporterLedger(securityPool.reporterLedger(universe)).question(universe, child.questionId());
		require(reporter.finalAfter != 0 && reporter.finalAfter == finalAfter, 'Reporter continuation finality mismatch');
		SecurityPoolSettlement settlement = SecurityPoolSettlement(securityPool.settlement());
		(SecurityPoolSettlementBook.Question memory claim, ) = settlement.ledger().question(settlement.bookIds(universe), child.questionId());
		if (claim.outcomeSupplyAttoShares != 0)
			require(claim.finalAfter != 0 && claim.finalAfter == finalAfter, 'Settlement continuation finality mismatch');
	}

	function _hasProtectedQuestionCash(ISecurityPoolNative securityPool, uint248 universe, uint256 questionId) private view returns (bool) {
		SecurityPoolSettlement engine = SecurityPoolSettlement(securityPool.settlement());
		SecurityPoolSettlementBook ledger = engine.ledger();
		uint64 bookId = engine.bookIds(universe);
		(SecurityPoolSettlementBook.Question memory question, uint64 frozenBookId) = ledger.question(bookId, questionId);
		if (frozenBookId == 0 || question.outcomeSupplyAttoShares == 0) return false;
		(, , uint64 sourceBookId, ) = ledger.frozenBooks(frozenBookId);
		return sourceBookId == bookId;
	}

	/// @dev The source share namespace may be a prepared pool without its own game.
	function createChildUniverse(IQuestionLedger source, uint256 outcomeIndex) external {
		uint248 targetUniverse = zoltar.getChildUniverseId(source.universeId(), outcomeIndex);
		// Share migration must not depend on someone else having deployed the branch.
		if (address(zoltar.getRepToken(targetUniverse)) == address(0))
			zoltar.deployChild(source.universeId(), outcomeIndex);
		ISecurityPoolNative securityPool = ISecurityPoolNative(source.securityPoolFactory().securityPoolOf(source));
		securityPool.prepareQuestionUniverse(targetUniverse);
		address game = securityPool.sourceGame(targetUniverse, source.questionId());
		if (game != address(0)) source = EscalationGame(game).questionLedger();
		// A target that forked before this question was materialized there cannot
		// activate a live question. Its prepared, forked ledger is all that shares
		// need in order to migrate on through that universe.
		if (zoltar.getForkTime(targetUniverse) != 0) {
			(IQuestionLedger child, ISecurityPoolNative authority, , ) = _prepareSecurityPoolQuestion(source, targetUniverse);
			if (
				child.systemState() == SystemState.Operational ||
				!_canActivateInForkedUniverse(authority, targetUniverse, source.questionId())
			) return;
		}
		materializeSecurityPoolQuestion(source, targetUniverse);
	}

	function _canActivateInForkedUniverse(ISecurityPoolNative securityPool, uint248 targetUniverse, uint256 questionId) private view returns (bool) {
		(SecurityPoolReporterLedger.Question memory state, bool finalClaim) = SecurityPoolReporterLedger(securityPool.reporterLedger(targetUniverse)).question(targetUniverse, questionId);
		return
			(finalClaim && state.balanceAttoRep != 0) ||
			_hasProtectedQuestionCash(securityPool, targetUniverse, questionId);
	}

	/// @dev Returns the effective source: an existing ledger's immutable parent, otherwise
	/// the caller's canonical source after proving the target descends from its universe.
	function _prepareSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) private returns (IQuestionLedger child, ISecurityPoolNative securityPool, address sourceGame, IQuestionLedger) {
		ISecurityPoolFactory factory = source.securityPoolFactory();
		bytes32 origin = factory.getQuestionLedgerOriginId(source);
		require(address(factory.getQuestionLedger(origin, source.universeId())) == address(source), 'Source pool is not canonical');
		address authority = factory.securityPoolOf(source);
		require(authority != address(0) && source.securityPoolCustody() != address(0), 'Source is not a bound security pool question');
		require(zoltar.getForkTime(source.universeId()) != 0, 'Source universe has not forked');
		securityPool = ISecurityPoolNative(authority);
		securityPool.prepareQuestionUniverse(targetUniverse);
		child = factory.getQuestionLedger(origin, targetUniverse);
		// An already operational child returns before its parent is checked, so prove its factory first.
		if (address(child) != address(0))
			require(address(child.securityPoolFactory()) == address(factory), 'Child pool is not from the source factory');
		if (address(child) != address(0)) {
			if (child.systemState() == SystemState.Operational) return (child, securityPool, address(0), source);
			// The forker deployed this child from a proven canonical parent, so any caller
			// completes the prepared ledger whatever ancestor source it names.
			source = child.parent();
		} else {
			_requireDescendant(source.universeId(), targetUniverse);
		}
		SecurityPoolReporterLedger reporters = SecurityPoolReporterLedger(securityPool.reporterLedger(targetUniverse));
		reporters.checkpoint(targetUniverse);
		(SecurityPoolReporterLedger.Question memory reporterState, bool finalClaim) = reporters.question(targetUniverse, source.questionId());
		require(!finalClaim || reporterState.balanceAttoRep != 0, 'Question finalized in source universe');
		sourceGame = reporterState.sourceGame;
		require(sourceGame == address(0) || sourceGame == address(source.escalationGame()), 'Use last live reporter source');
		if (address(child) != address(0)) return (child, securityPool, sourceGame, source);
		factory.prepareSecurityPoolPriceFeed(source, targetUniverse);
		child = factory.deployChildQuestionLedger(source, source.shareToken(), targetUniverse, source.questionId(), source.statoblastSecurityMultiplierBps());
		_requireChildProvenance(factory, source, child, targetUniverse);
		source.authorizeChildQuestionLedger(child);
		securityPool.registerChildQuestionLedger(child);
		if (zoltar.getForkTime(targetUniverse) != 0) child.setSystemState(SystemState.PoolForked);
		return (child, securityPool, sourceGame, source);
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
	function _requireChildProvenance(ISecurityPoolFactory factory, IQuestionLedger source, IQuestionLedger child, uint248 targetUniverse) private view {
		require(address(child.securityPoolFactory()) == address(factory), 'Child pool is not from the source factory');
		require(address(child.parent()) == address(source) && child.universeId() == targetUniverse && address(child.shareToken()) == address(source.shareToken()), 'Child pool does not continue the source');
	}

	function getQuestionOutcome(IQuestionLedger pool) public view returns (BinaryOutcomes.BinaryOutcome) {
		if (pool.systemState() != SystemState.Operational) return BinaryOutcomes.BinaryOutcome.None;
		EscalationGame game = pool.escalationGame();
		if (address(game) != address(0)) return game.getFinalQuestionResolution();
		ISecurityPoolNative securityPool = ISecurityPoolNative(pool.securityPoolFactory().securityPoolOf(pool));
		(bool isFixed, uint256 fixedValue) = securityPool.inheritedFixedOutcome(pool.universeId(), pool.questionId());
		require(!isFixed || fixedValue < uint256(BinaryOutcomes.BinaryOutcome.None), 'Unsupported inherited reporter outcome');
		if (!isFixed) return BinaryOutcomes.BinaryOutcome.None;
		uint48 finalAfter = EscalationGameRepCustody.fixedQuestionFinalAfter(address(securityPool), pool.universeId(), pool.questionId());
		if (finalAfter == 0)
			finalAfter = securityPool.securityPoolTimeForNative(pool.universeId(), 0) + Constants.FORK_RESPONSE_DELAY;
		return
			securityPool.securityPoolTime(pool.universeId()) > finalAfter
				? BinaryOutcomes.BinaryOutcome(fixedValue)
				: BinaryOutcomes.BinaryOutcome.None;
	}

	function _continueReporterGame(ISecurityPoolNative securityPool, IQuestionLedger source, IQuestionLedger child, EscalationGame game) private returns (bool complete) {
		require(game.getFinalQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'Final reporter game cannot export live carry');
		if (address(child.escalationGame()) == address(0)) _initializeReporterGame(securityPool, source, child, game);
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

	function _initializeReporterGame(ISecurityPoolNative securityPool, IQuestionLedger source, IQuestionLedger child, EscalationGame game) private {
		uint48 securityPoolTimeAnchor = securityPool.securityPoolTimeForNative(child.universeId(), 0);
		uint256 sourceStart = game.forkContinuation() ? game.forkResumedAt() : game.activationTime();
		require(sourceStart != 0 && sourceStart <= type(uint48).max, 'Source reporter clock is invalid');
		uint256 securityPoolStartTime = securityPool.securityPoolTimeForNative(source.universeId(), uint48(sourceStart));
		int256 elapsed = game.forkContinuation() ? game.forkElapsedAtStart() : int256(0);
		// Preserve pre-activation time too: dropping a negative offset makes the
		// game finalize before its inherited settlement and reporter schedules.
		elapsed += int256(uint256(securityPoolTimeAnchor)) - int256(securityPoolStartTime);
		if (elapsed > int256(ESCALATION_TIME_LENGTH)) elapsed = int256(ESCALATION_TIME_LENGTH);
		(bool fixedOutcome, uint256 outcome) = securityPool.inheritedFixedOutcome(child.universeId(), child.questionId());
		require(!fixedOutcome || outcome < uint256(BinaryOutcomes.BinaryOutcome.None), 'Unsupported inherited reporter outcome');
		child.setAwaitingForkContinuation(true);
		child.initializeForkedEscalationGame(game.startBondAttoRep(), game.nonDecisionThresholdAttoRep(), elapsed, fixedOutcome ? BinaryOutcomes.BinaryOutcome(outcome) : BinaryOutcomes.BinaryOutcome.None);
	}
}
