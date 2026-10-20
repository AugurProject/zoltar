// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';

interface IPortfolioForkAuthority {
	function forkController() external view returns (address);
}

/// @notice Actual ETH custody for the portfolio's virtual question and branch settlement books.
/// @dev The immutable portfolio authenticates native callbacks, decides fee policy and supplies
/// its monotonic logical clock. Every returned earned fee is transferred to that authority;
/// it must credit old underwriting weights before changing commitments or accepted prices.
contract SecurityPoolPortfolioSettlement {
	address public immutable portfolio;
	SecurityPoolSettlementBook public ledger;
	bool private entered;

	struct QuestionSource {
		uint248 universeId;
		uint256 questionId;
		bool registered;
	}

	struct Snapshot {
		uint256 outcomeSupplyAttoShares;
		uint256 questionCashAttoEth;
		uint256 demandAttoEth;
		uint256 earnedFeesAttoEth;
		uint48 timestamp;
	}

	mapping(uint248 => uint64) public bookIds;
	mapping(address => QuestionSource) public questions;
	mapping(uint248 => mapping(uint256 => address)) public poolsByQuestion;
	mapping(uint248 => uint256) public availableForkCashAttoEth;

	constructor(address authority) {
		require(authority != address(0), 'Invalid settlement authority');
		portfolio = authority;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	modifier onlyForkAuthority() {
		require(msg.sender == portfolio || (portfolio.code.length != 0 && msg.sender == IPortfolioForkAuthority(portfolio).forkController()), 'Only portfolio fork authority');
		_;
	}

	modifier nonReentrant() {
		require(!entered, 'Settlement reentry');
		entered = true;
		_;
		entered = false;
	}

	function initialize(SecurityPoolSettlementBook book) external onlyPortfolio {
		require(address(ledger) == address(0) && address(book) != address(0), 'Settlement ledger initialized');
		require(book.portfolio() == address(this), 'Incorrect settlement ledger authority');
		ledger = book;
	}

	function registerUniverse(uint248 universeId, uint48 timestamp) external onlyPortfolio returns (uint64 bookId) {
		require(bookIds[universeId] == 0, 'Settlement universe registered');
		bookId = ledger.createBook(timestamp);
		ledger.setFeeAccrualEnabled(bookId, false, timestamp);
		bookIds[universeId] = bookId;
	}

	function registerQuestion(address pool, uint248 universeId, uint256 questionId) external onlyPortfolio {
		require(pool != address(0) && !questions[pool].registered, 'Settlement question registered');
		require(poolsByQuestion[universeId][questionId] == address(0), 'Settlement question already canonical');
		_bookId(universeId);
		questions[pool] = QuestionSource(universeId, questionId, true);
		poolsByQuestion[universeId][questionId] = pool;
	}

	function mint(address pool, uint256 minimumShares, uint48 timestamp) external payable onlyPortfolio nonReentrant returns (uint256 shares, Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		shares = ledger.mint(bookId, source.questionId, msg.value, minimumShares, timestamp);
		snapshot = _snapshot(source, _collectFees(bookId));
	}

	function redeem(address pool, address recipient, uint256 shares, uint256 minimumCashAttoEth, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 cashAttoEth, Snapshot memory snapshot) {
		require(recipient != address(0), 'Invalid settlement recipient');
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		(cashAttoEth, ) = ledger.redeem(bookId, source.questionId, shares, minimumCashAttoEth, timestamp);
		snapshot = _snapshot(source, _collectFees(bookId));
		_sendEth(recipient, cashAttoEth);
	}

	function checkpointQuestion(address pool, uint48 timestamp) external onlyPortfolio nonReentrant returns (Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		(, , , , bool isSealed) = ledger.totals(bookId);
		if (!isSealed) ledger.freezeMatured(bookId, timestamp);
		return _snapshot(source, _collectFees(bookId));
	}

	function replaceFeeStream(address pool, uint96 rateAttoEthPerSecond, uint48 end, uint48 timestamp) external onlyPortfolio nonReentrant returns (Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		ledger.replaceFeeStream(bookId, source.questionId, rateAttoEthPerSecond, end, timestamp);
		return _snapshot(source, _collectFees(bookId));
	}

	/// @notice Reporting first stops its time fee, then installs a bound irreversible deadline.
	function scheduleFinality(address pool, uint48 finalAfter, uint48 timestamp) external onlyPortfolio nonReentrant returns (Snapshot memory snapshot) {
		QuestionSource memory source = _question(pool);
		uint64 bookId = _bookId(source.universeId);
		ledger.replaceFeeStream(bookId, source.questionId, 0, 0, timestamp);
		ledger.scheduleFinality(bookId, source.questionId, finalAfter, timestamp);
		return _snapshot(source, _collectFees(bookId));
	}

	function checkpointUniverse(uint248 universeId, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 earnedFeesAttoEth, uint256 demandAttoEth) {
		uint64 bookId = _bookId(universeId);
		(, , , , bool isSealed) = ledger.totals(bookId);
		if (!isSealed) ledger.freezeMatured(bookId, timestamp);
		earnedFeesAttoEth = _collectFees(bookId);
		(demandAttoEth, , , , ) = ledger.totals(bookId);
	}

	function setFeesEnabled(uint248 universeId, bool enabled, uint48 timestamp) external onlyPortfolio nonReentrant returns (uint256 earnedFeesAttoEth, uint256 demandAttoEth) {
		uint64 bookId = _bookId(universeId);
		ledger.setFeeAccrualEnabled(bookId, enabled, timestamp);
		earnedFeesAttoEth = _collectFees(bookId);
		(demandAttoEth, , , , ) = ledger.totals(bookId);
	}

	function feeTimestamp(uint248 universeId) external view returns (uint48) {
		return ledger.feeTimestamp(_bookId(universeId));
	}

	function setFeeClock(uint248 universeId, uint48 nativeTimestamp) external onlyForkAuthority nonReentrant {
		ledger.setFeeClock(_bookId(universeId), nativeTimestamp);
	}

	function recapitalize(uint248 universeId, uint48 timestamp) external payable onlyForkAuthority nonReentrant returns (uint256 earnedFeesAttoEth, uint256 demandAttoEth) {
		uint64 bookId = _bookId(universeId);
		ledger.recapitalize(bookId, msg.value, timestamp);
		earnedFeesAttoEth = _collectFees(bookId);
		(demandAttoEth, , , , ) = ledger.totals(bookId);
	}

	function sealUniverse(uint248 universeId, uint48 timestamp) external onlyForkAuthority nonReentrant returns (uint256 cashAttoEth, uint256 units, uint256 earnedFeesAttoEth) {
		uint64 bookId = _bookId(universeId);
		ledger.sealForFork(bookId, timestamp);
		(cashAttoEth, units, , , ) = ledger.totals(bookId);
		availableForkCashAttoEth[universeId] = cashAttoEth;
		earnedFeesAttoEth = _collectFees(bookId);
	}

	/// @notice Fund one child from its assigned parent cash and newly contributed auction ETH.
	/// @dev Contributions cannot spend the parent's already frozen final claims or earned fees.
	function createChildUniverse(uint248 sourceUniverseId, uint248 childUniverseId, uint256 parentContributionAttoEth) external payable onlyForkAuthority nonReentrant returns (uint64 bookId) {
		require(bookIds[childUniverseId] == 0, 'Settlement universe registered');
		uint256 available = availableForkCashAttoEth[sourceUniverseId];
		require(parentContributionAttoEth <= available, 'Fork settlement cash insufficient');
		availableForkCashAttoEth[sourceUniverseId] = available - parentContributionAttoEth;
		bookId = ledger.createChildBook(_bookId(sourceUniverseId), parentContributionAttoEth + msg.value);
		(, , , uint48 timestamp, ) = ledger.totals(bookId);
		ledger.setFeeAccrualEnabled(bookId, false, timestamp);
		bookIds[childUniverseId] = bookId;
	}

	/// @notice A fork fixes its triggering question even before a native child pool exists.
	function fixInheritedQuestionFinality(uint248 universeId, uint256 questionId, uint48 finalAfter) external onlyForkAuthority nonReentrant {
		uint64 bookId = _bookId(universeId);
		(SecurityPoolSettlementBook.Question memory state, uint64 frozenBookId) = ledger.question(bookId, questionId);
		if (frozenBookId != 0 || state.outcomeSupplyAttoShares == 0) return;
		(, , , uint48 timestamp, ) = ledger.totals(bookId);
		ledger.replaceFeeStream(bookId, questionId, 0, 0, timestamp);
		ledger.scheduleFinality(bookId, questionId, finalAfter, timestamp);
	}

	/// @notice Transfer an explicit part of unassigned source cash to the portfolio's recovery book.
	function withdrawForkRecoveryCash(uint248 universeId, uint256 cashAttoEth) external onlyForkAuthority nonReentrant {
		require(cashAttoEth <= availableForkCashAttoEth[universeId], 'Fork settlement cash insufficient');
		availableForkCashAttoEth[universeId] -= cashAttoEth;
		_sendEth(msg.sender, cashAttoEth);
	}

	function snapshotQuestion(address pool) external view returns (Snapshot memory) {
		return _snapshot(_question(pool), 0);
	}

	function quoteRedemption(address pool, uint256 shares) external view returns (uint256 cashAttoEth) {
		QuestionSource memory source = _question(pool);
		(cashAttoEth, ) = ledger.quoteRedemption(_bookId(source.universeId), source.questionId, shares);
	}

	function quoteMint(address pool, uint256 cashAttoEth) external view returns (uint256) {
		QuestionSource memory source = _question(pool);
		return ledger.quoteMint(_bookId(source.universeId), source.questionId, cashAttoEth);
	}

	function _snapshot(QuestionSource memory source, uint256 fees) private view returns (Snapshot memory snapshot) {
		uint64 bookId = _bookId(source.universeId);
		(SecurityPoolSettlementBook.Question memory state, uint64 frozenBookId) = ledger.question(bookId, source.questionId);
		if (frozenBookId != 0) {
			(, , uint64 sourceBookId) = ledger.frozenBooks(frozenBookId);
			if (sourceBookId != bookId) {
				(snapshot.demandAttoEth, , , snapshot.timestamp, ) = ledger.totals(bookId);
				snapshot.earnedFeesAttoEth = fees;
				return snapshot;
			}
		}
		snapshot.outcomeSupplyAttoShares = state.outcomeSupplyAttoShares;
		if (state.outcomeSupplyAttoShares != 0)
			(snapshot.questionCashAttoEth, ) = ledger.quoteRedemption(bookId, source.questionId, state.outcomeSupplyAttoShares);
		(snapshot.demandAttoEth, , , snapshot.timestamp, ) = ledger.totals(bookId);
		snapshot.earnedFeesAttoEth = fees;
	}

	function _collectFees(uint64 bookId) private returns (uint256 cashAttoEth) {
		(, , cashAttoEth, , ) = ledger.totals(bookId);
		if (cashAttoEth == 0) return 0;
		ledger.collectFees(bookId, cashAttoEth);
		_sendEth(portfolio, cashAttoEth);
	}

	function _question(address pool) private view returns (QuestionSource memory source) {
		source = questions[pool];
		require(source.registered, 'Unknown settlement question');
	}

	function _bookId(uint248 universeId) private view returns (uint64 bookId) {
		bookId = bookIds[universeId];
		require(bookId != 0, 'Unknown settlement universe');
	}

	function _sendEth(address recipient, uint256 cashAttoEth) private {
		if (cashAttoEth == 0) return;
		(bool sent, ) = payable(recipient).call{value: cashAttoEth}('');
		require(sent, 'Settlement ETH transfer failed');
	}
}
