// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolReporterLedger } from './interfaces/ISecurityPoolReporterLedger.sol';

interface IReporterPortfolioClock {
	function forkController() external view returns (address);
	function logicalTime(uint248 universeId) external view returns (uint48);
	function forkLogicalTime(uint248 universeId) external view returns (uint48);
}

interface IReporterGameIdentity {
	function securityPool() external view returns (ISecurityPool);
	function repToken() external view returns (address);
}

/// @notice Disjoint reporter custody with immutable per-question roots shared by fork children.
/// @dev One ledger stores every portfolio universe, so root copies never traverse ancestors.
/// Games finalized strictly before a fork retain parent REP; only live escrow migrates.
contract SecurityPoolReporterLedger is ISecurityPoolReporterLedger {
	using SafeERC20Ops for IERC20;
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;

	struct Book {
		uint256 liveAttoRep;
		uint256 finalAttoRep;
		uint64 questionRoot;
		uint64 finalityRoot;
		uint64 frozenRoot;
		uint48 timestamp;
		bool exists;
		bool isSealed;
		uint48 minimumFinalAfter;
	}

	struct Question {
		uint256 balanceAttoRep;
		address sourceGame;
		uint248 scheduledUniverseId;
		uint48 finalAfter;
		bool winnerHaircutPaidByFork;
	}

	struct Game {
		uint248 universeId;
		uint256 questionId;
		bool registered;
	}

	address public immutable portfolio;
	Zoltar public immutable zoltar;
	SecurityPoolPersistentMap.Store private tree;
	uint64 private lastQuestionStateId;
	mapping(uint248 => Book) public books;
	mapping(uint64 => Question) private questions;
	mapping(address => Game) public games;
	mapping(uint248 => mapping(uint256 => address)) public registeredGames;

	event GameRegistered(uint248 indexed universeId, uint256 indexed questionId, address indexed game);
	event ReporterBalanceChanged(uint248 indexed universeId, uint256 indexed questionId, uint256 balanceAttoRep);
	event ReporterForkFrozen(uint248 indexed universeId, uint256 migrationAttoRep, uint256 protectedParentAttoRep);
	event ReporterChildCreated(uint248 indexed sourceUniverseId, uint248 indexed childUniverseId, uint256 escrowAttoRep);
	event ReporterFinalityScheduled(address indexed game, uint48 finalAfter);

	constructor(address authority, Zoltar protocol) {
		require(authority != address(0) && address(protocol).code.length != 0, 'Invalid reporter custody authority');
		portfolio = authority;
		zoltar = protocol;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio reporter authority');
		_;
	}

	modifier onlyForkAuthority() {
		require(msg.sender == portfolio || msg.sender == IReporterPortfolioClock(portfolio).forkController(), 'Only portfolio fork authority');
		_;
	}

	function registerUniverse(uint248 universeId) external onlyPortfolio {
		require(!books[universeId].exists, 'Reporter universe already exists');
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Reporter universe is missing');
		books[universeId].exists = true;
	}

	function registerGame(uint256 questionId, address game) external onlyPortfolio {
		ISecurityPool pool = IReporterGameIdentity(game).securityPool();
		uint248 universeId = pool.universeId();
		require(pool.questionId() == questionId && address(pool.escalationGame()) == game, 'Reporter game is not canonical');
		require(address(pool.zoltar()) == address(zoltar), 'Reporter game uses another protocol');
		require(IReporterGameIdentity(game).repToken() == address(zoltar.getRepToken(universeId)), 'Reporter game uses another REP token');
		Book storage book = _book(universeId);
		address existing = registeredGames[universeId][questionId];
		require(existing == address(0) || existing == game, 'Reporter game already bound');
		if (existing == game) return;
		if (!book.isSealed) _freezeMatured(universeId, book, _logicalTime(universeId));
		(Question memory state, bool finalClaim) = _question(universeId, questionId);
		require(!finalClaim || state.balanceAttoRep != 0, 'Use source reporter claim');
		require((!book.isSealed && zoltar.getForkTime(universeId) == 0) || (finalClaim && state.balanceAttoRep != 0), 'Reporter universe sealed');
		state.sourceGame = game;
		_writeQuestion(book, questionId, state);
		games[game] = Game(universeId, questionId, true);
		registeredGames[universeId][questionId] = game;
		emit GameRegistered(universeId, questionId, game);
	}

	/// @notice The last materialized source game and exact escrow needed by a lazy child.
	function question(uint248 universeId, uint256 questionId) external view returns (Question memory state, bool finalClaim) {
		return _question(universeId, questionId);
	}

	function balanceOfGame(address game) external view returns (uint256) {
		Game memory identity = games[game];
		if (!identity.registered) {
			ISecurityPool pool = IReporterGameIdentity(game).securityPool();
			identity = Game(pool.universeId(), pool.questionId(), false);
		}
		(Question memory state, ) = _question(identity.universeId, identity.questionId);
		return state.balanceAttoRep;
	}

	/// @dev The canonical game first transfers actual REP, then credits exactly that deposit.
	function depositForGame(address game, uint256 amountAttoRep) external {
		Game memory identity = _authorizedGame(game);
		Book storage book = _book(identity.universeId);
		require(!book.isSealed && zoltar.getForkTime(identity.universeId) == 0, 'Reporter universe is forked');
		_freezeMatured(identity.universeId, book, _logicalTime(identity.universeId));
		(Question memory state, bool finalClaim) = _question(identity.universeId, identity.questionId);
		require(!finalClaim, 'Reporter claim is final');
		require(IERC20(address(zoltar.getRepToken(identity.universeId))).balanceOf(address(this)) >= book.liveAttoRep + book.finalAttoRep + amountAttoRep, 'Reporter deposit is not funded');
		_changeFinality(book, state.finalAfter, amountAttoRep, true);
		state.balanceAttoRep += amountAttoRep;
		book.liveAttoRep += amountAttoRep;
		_writeQuestion(book, identity.questionId, state);
		emit ReporterBalanceChanged(identity.universeId, identity.questionId, state.balanceAttoRep);
	}

	function transferFromGame(address game, address recipient, uint256 amountAttoRep) external {
		Game memory identity = _authorizedGame(game);
		require(recipient != address(0) && recipient != address(this), 'Invalid reporter recipient');
		Book storage book = _book(identity.universeId);
		if (!book.isSealed) {
			uint256 forkTime = zoltar.getForkTime(identity.universeId);
			if (forkTime == 0) _freezeMatured(identity.universeId, book, _logicalTime(identity.universeId));
			else _sealFork(identity.universeId, book, forkTime);
		}
		(Question memory state, bool finalClaim) = _question(identity.universeId, identity.questionId);
		require(!book.isSealed || finalClaim, 'Use child reporter escrow');
		require(amountAttoRep <= state.balanceAttoRep, 'Reporter escrow is insufficient');
		state.balanceAttoRep -= amountAttoRep;
		if (finalClaim) book.finalAttoRep -= amountAttoRep;
		else {
			book.liveAttoRep -= amountAttoRep;
			_changeFinality(book, state.finalAfter, amountAttoRep, false);
		}
		_writeQuestion(book, identity.questionId, state);
		emit ReporterBalanceChanged(identity.universeId, identity.questionId, state.balanceAttoRep);
		IERC20(address(zoltar.getRepToken(identity.universeId))).safeTransfer(recipient, amountAttoRep);
	}

	/// @dev Games update this when reporting changes the unique leader or response deadline.
	function scheduleFinality(address game, uint48 finalAfter) external {
		require(msg.sender == portfolio || msg.sender == game, 'Only canonical reporter game');
		Game memory identity = games[game];
		require(identity.registered, 'Reporter game is not registered');
		Book storage book = _book(identity.universeId);
		require(!book.isSealed && zoltar.getForkTime(identity.universeId) == 0, 'Reporter universe is forked');
		_freezeMatured(identity.universeId, book, _logicalTime(identity.universeId));
		(Question memory state, bool finalClaim) = _question(identity.universeId, identity.questionId);
		require(!finalClaim, 'Reporter finality is immutable');
		// Deadlines are expressed in the portfolio clock, which pauses across forks.
		require(finalAfter == 0 || finalAfter >= _logicalTime(identity.universeId), 'Reporter finality already elapsed');
		_changeFinality(book, state.finalAfter, state.balanceAttoRep, false);
		state.finalAfter = finalAfter;
		state.scheduledUniverseId = identity.universeId;
		_changeFinality(book, finalAfter, state.balanceAttoRep, true);
		_writeQuestion(book, identity.questionId, state);
		emit ReporterFinalityScheduled(game, finalAfter);
	}

	/// @notice Finalize elapsed reporter deadlines without starting any migration work.
	function checkpoint(uint248 universeId) external {
		Book storage book = _book(universeId);
		if (!book.isSealed) _freezeMatured(universeId, book, _logicalTime(universeId));
	}

	function freezeFork(uint248 universeId) external onlyForkAuthority {
		Book storage book = _book(universeId);
		if (book.isSealed) return;
		_sealFork(universeId, book, zoltar.getForkTime(universeId));
	}

	/// @notice Charge admission only to the actual triggering question, then freeze the aggregate.
	function triggerFork(uint248 universeId, uint256 questionId) external onlyPortfolio {
		Book storage book = _book(universeId);
		require(!book.isSealed && zoltar.getForkTime(universeId) == 0, 'Reporter universe already forked');
		_freezeMatured(universeId, book, _logicalTime(universeId));
		(Question memory state, bool finalClaim) = _question(universeId, questionId);
		uint256 threshold = zoltar.getForkThresholdAttoRep(universeId);
		require(!finalClaim && state.balanceAttoRep >= threshold, 'Triggering question lacks fork admission REP');
		uint256 haircut = threshold / zoltar.forkBurnDivisor();
		state.balanceAttoRep -= haircut;
		state.winnerHaircutPaidByFork = true;
		book.liveAttoRep -= haircut;
		_changeFinality(book, state.finalAfter, haircut, false);
		_writeQuestion(book, questionId, state);
		IERC20(address(zoltar.getRepToken(universeId))).safeApprove(address(zoltar), threshold);
		zoltar.forkUniverse(universeId, questionId);
		_sealFork(universeId, book, zoltar.getForkTime(universeId));
	}

	/// @notice Duplicate all live reporter balances into one branch with one native migration.
	function createChild(uint248 sourceUniverseId, uint256 outcomeIndex) external onlyForkAuthority returns (uint248 childUniverseId) {
		Book storage source = _book(sourceUniverseId);
		require(source.isSealed, 'Reporter source is not sealed');
		childUniverseId = zoltar.getChildUniverseId(sourceUniverseId, outcomeIndex);
		require(!books[childUniverseId].exists, 'Reporter child already exists');
		if (source.liveAttoRep != 0) {
			uint256[] memory outcomes = new uint256[](1);
			outcomes[0] = outcomeIndex;
			zoltar.splitMigrationRep(sourceUniverseId, source.liveAttoRep, outcomes);
		} else if (address(zoltar.getRepToken(childUniverseId)) == address(0))
			zoltar.deployChild(sourceUniverseId, outcomeIndex);
		books[childUniverseId] = Book(source.liveAttoRep, 0, source.questionRoot, source.finalityRoot, source.frozenRoot, source.timestamp, true, false, source.timestamp + 3 days);
		(, uint256 forkQuestionId, , , ) = zoltar.universes(sourceUniverseId);
		(Question memory fixedQuestion, bool alreadyFinal) = _question(childUniverseId, forkQuestionId);
		if (!alreadyFinal && fixedQuestion.balanceAttoRep != 0) {
			Book storage child = books[childUniverseId];
			_changeFinality(child, fixedQuestion.finalAfter, fixedQuestion.balanceAttoRep, false);
			fixedQuestion.finalAfter = child.minimumFinalAfter;
			fixedQuestion.scheduledUniverseId = childUniverseId;
			_changeFinality(child, fixedQuestion.finalAfter, fixedQuestion.balanceAttoRep, true);
			_writeQuestion(child, forkQuestionId, fixedQuestion);
		}
		emit ReporterChildCreated(sourceUniverseId, childUniverseId, source.liveAttoRep);
	}

	function _sealFork(uint248 universeId, Book storage book, uint256 forkTime) private {
		require(forkTime != 0 && forkTime <= type(uint48).max, 'Reporter fork is missing');
		uint48 logicalForkTime = IReporterPortfolioClock(portfolio).forkLogicalTime(universeId);
		_freezeMatured(universeId, book, logicalForkTime);
		book.isSealed = true;
		uint256 prepared = zoltar.getMigrationRepBalanceAttoRep(address(this), universeId);
		require(prepared <= book.liveAttoRep, 'Reporter migration exceeds live inventory');
		uint256 remaining = book.liveAttoRep - prepared;
		if (remaining != 0) {
			IERC20(address(zoltar.getRepToken(universeId))).safeApprove(address(zoltar), remaining);
			zoltar.addRepToMigrationBalance(universeId, remaining);
		}
		emit ReporterForkFrozen(universeId, book.liveAttoRep, book.finalAttoRep);
	}

	function _question(uint248 universeId, uint256 questionId) private view returns (Question memory state, bool finalClaim) {
		state = questions[uint64(tree.get(books[universeId].questionRoot, questionId))];
		uint256 finalizingUniversePlusOne =
			state.finalAfter == 0 ? 0 : tree.ceiling(books[universeId].frozenRoot, state.finalAfter);
		finalClaim = finalizingUniversePlusOne != 0;
		if (finalClaim && finalizingUniversePlusOne - 1 != universeId) state.balanceAttoRep = 0;
	}

	function _logicalTime(uint248 universeId) private view returns (uint48) {
		return IReporterPortfolioClock(portfolio).logicalTime(universeId);
	}

	function _freezeMatured(uint248 universeId, Book storage book, uint48 timestamp) private {
		require(timestamp >= book.timestamp, 'Reporter clock moved backwards');
		book.timestamp = timestamp;
		if (timestamp == 0 || timestamp <= book.minimumFinalAfter) return;
		(uint64 matured, uint64 pending) = tree.split(book.finalityRoot, timestamp - 1);
		book.finalityRoot = pending;
		uint256 amountAttoRep = tree.total(matured);
		if (amountAttoRep == 0) return;
		book.liveAttoRep -= amountAttoRep;
		book.finalAttoRep += amountAttoRep;
		book.frozenRoot = tree.set(book.frozenRoot, timestamp - 1, uint256(universeId) + 1, 0);
	}

	function _changeFinality(Book storage book, uint48 finalAfter, uint256 amountAttoRep, bool increase) private {
		if (finalAfter == 0 || amountAttoRep == 0) return;
		uint256 prior = tree.get(book.finalityRoot, finalAfter);
		uint256 next = increase ? prior + amountAttoRep : prior - amountAttoRep;
		book.finalityRoot = tree.set(book.finalityRoot, finalAfter, next, next);
	}

	function _writeQuestion(Book storage book, uint256 questionId, Question memory state) private {
		uint64 id = ++lastQuestionStateId;
		questions[id] = state;
		book.questionRoot = tree.set(book.questionRoot, questionId, id, 0);
	}

	function _authorizedGame(address game) private view returns (Game memory identity) {
		require(msg.sender == game, 'Only canonical reporter game');
		identity = games[game];
		require(identity.registered, 'Reporter game is not registered');
	}

	function _book(uint248 universeId) private view returns (Book storage book) {
		book = books[universeId];
		require(book.exists, 'Reporter universe is not registered');
	}
}
