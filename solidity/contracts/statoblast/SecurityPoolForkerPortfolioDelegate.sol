// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolPortfolioNative } from './interfaces/ISecurityPoolPortfolioNative.sol';
import { SecurityPoolForkEventEmitter } from './SecurityPoolEventEmitter.sol';
import { EscalationForkSnapshot, SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ESCALATION_TIME_LENGTH } from './EscalationGameTypes.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';

/// @notice Materialize one question directly from its last live source game.
/// @dev Portfolio assets already migrated at branch level. No per-question truth
/// auction, vault migration, ancestor walk, or reporter-token transfer occurs here.
contract SecurityPoolForkerPortfolioDelegate is SecurityPoolForkEventEmitter {
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
		}
		child.updateSettlementCollateral();
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
		(child, ) = factory.deployChildSecurityPool(source, source.shareToken(), targetUniverse, source.questionId(), source.statoblastSecurityMultiplierBps(), SecurityPoolUtils.calculateRetentionRate(0, 0), 0);
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

	function _forkOccurredBeforeEscalationSettled(EscalationGame game, uint256 forkTime) private view returns (bool) {
		return
			address(game) != address(0) &&
			(game.getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None ||
				game.getEscalationGameEndDate() >= forkTime);
	}

	function _getEscalationElapsedAtFork(EscalationGame escalationGame, uint256 forkTime) private view returns (uint256 elapsedAtFork) {
		if (escalationGame.forkContinuation()) {
			elapsedAtFork = escalationGame.forkElapsedAtStart();
			uint256 resumedAt = escalationGame.forkResumedAt();
			if (resumedAt != 0) {
				if (forkTime > resumedAt) {
					elapsedAtFork += forkTime - resumedAt;
				}
			}
		} else {
			uint256 activationTime = escalationGame.activationTime();
			if (forkTime <= activationTime) return 0;
			elapsedAtFork = forkTime - activationTime;
		}
		if (elapsedAtFork > ESCALATION_TIME_LENGTH) {
			elapsedAtFork = ESCALATION_TIME_LENGTH;
		}
	}

	function snapshotNativeEscalationAtFork(ISecurityPool securityPool, EscalationGame escalationGame, uint256 forkTime) external {
		SecurityPoolForkerForkData storage data = forkDataByPool[securityPool];
		if (!_forkOccurredBeforeEscalationSettled(escalationGame, forkTime)) return;
		require(!escalationGame.forkContinuation() || escalationGame.forkCarrySnapshotInitialized(), 'Fork snapshot incomplete');
		EscalationForkSnapshot storage snapshot = escalationForkSnapshotByPool[securityPool];
		// Keep this unreachable initialization guard data-free for the EIP-170 size limit.
		if (snapshot.initialized) revert();
		(
			bytes32[64][3] memory carryPeaks,
			uint256[3] memory carryLeafCounts,
			uint256[3] memory carryTotalsAttoRep,
			bytes32[3] memory nullifierRoots
		) = escalationGame.getForkCarrySnapshot();
		uint256[3] memory resolutionBalancesAttoRep = escalationGame.getOutcomeBalancesAttoRep();
		bytes32[3] memory carryRoots = escalationGame.getForkCarryRoots();
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			for (uint8 peakIndex = 0; peakIndex < 64; peakIndex++) {
				snapshot.carryPeaks[outcomeIndex][peakIndex] = carryPeaks[outcomeIndex][peakIndex];
			}
			snapshot.carryLeafCounts[outcomeIndex] = carryLeafCounts[outcomeIndex];
			snapshot.carryTotalsAttoRep[outcomeIndex] = carryTotalsAttoRep[outcomeIndex];
			snapshot.resolutionBalancesAttoRep[outcomeIndex] = resolutionBalancesAttoRep[outcomeIndex];
			snapshot.nullifierRoots[outcomeIndex] = nullifierRoots[outcomeIndex];
		}
		snapshot.initialized = true;
		data.escalationSnapshotId = keccak256(abi.encode(address(escalationGame), carryRoots, nullifierRoots, carryLeafCounts, carryTotalsAttoRep, resolutionBalancesAttoRep));
		data.unresolvedEscalationAtFork = true;
		data.escalationStartBondAtForkAttoRep = escalationGame.startBondAttoRep();
		data.escalationNonDecisionThresholdAtForkAttoRep = escalationGame.nonDecisionThresholdAttoRep();
		data.escalationElapsedAtFork = _getEscalationElapsedAtFork(escalationGame, forkTime);
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
		uint256 elapsed = game.forkContinuation() ? game.forkElapsedAtStart() : 0;
		if (logicalAnchor > logicalStart) elapsed += logicalAnchor - logicalStart;
		if (elapsed > ESCALATION_TIME_LENGTH) elapsed = ESCALATION_TIME_LENGTH;
		(bool fixedOutcome, uint256 outcome) = portfolio.inheritedFixedOutcome(child.universeId(), child.questionId());
		require(!fixedOutcome || outcome < uint256(BinaryOutcomes.BinaryOutcome.None), 'Unsupported inherited reporter outcome');
		child.setAwaitingForkContinuation(true);
		child.initializeForkedEscalationGame(game.startBondAttoRep(), game.nonDecisionThresholdAttoRep(), elapsed, fixedOutcome ? BinaryOutcomes.BinaryOutcome(outcome) : BinaryOutcomes.BinaryOutcome.None);
	}
}
