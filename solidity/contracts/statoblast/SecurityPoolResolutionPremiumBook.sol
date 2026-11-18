// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolQuestionMap } from './SecurityPoolQuestionMap.sol';
import { SecurityPoolTimestampMap } from './SecurityPoolTimestampMap.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Question-owned reporting premiums earn only until their funded finality.
/// @dev Custody stays with Services. Prefix integrals settle all expired streams
/// without visiting questions. Forks copy roots and preserve exact funded units.
contract SecurityPoolResolutionPremiumBook {
	using SecurityPoolTimestampMap for SecurityPoolTimestampMap.Store;
	using SecurityPoolQuestionMap for SecurityPoolQuestionMap.Store;
	uint256 public constant UNIT_SCALE = 1e9;
	uint48 public constant MAXIMUM_REPORTING_WINDOW = 3 days + 7 weeks;
	uint256 private constant MAXIMUM_INHERITED_UNITS_PER_CASH = 1e12;
	address public immutable services;
	uint256 public totalCash;
	SecurityPoolTimestampMap.Store private tree;
	SecurityPoolQuestionMap.Store private questionMap;
	uint64 private lastQuestionId;
	// Cash is held by Services; units allocate it. Every timestamp in this book uses portfolio time.
	// securityPoolResolutionPremiumBook.test.ts checks funding, refunds and fork conservation.
	struct Book {
		uint256 cash;
		uint256 units;
		uint256 assignedCash;
		uint256 recoveredUnits;
		uint256 refundedPrefix;
		uint64 questionRoot;
		uint64 rateRoot;
		uint64 endRoot;
		uint64 refundRoot;
		uint64 tailRoot;
		uint48 portfolioTimestamp;
		uint48 minimumFinalAfter;
		uint48 refundedBefore;
		bool exists;
		bool isSealed;
	}
	struct Question {
		uint256 units;
		uint128 rate;
		uint48 portfolioStartTime;
		uint48 portfolioEndTime;
		uint48 portfolioFundedEndTime;
	}
	mapping(uint248 => Book) private books;
	mapping(uint64 => Question) private questions;
	mapping(uint248 => uint256) public branchCash;
	mapping(uint248 => mapping(uint256 => uint256)) public recoveredShares;
	constructor(address authority) {
		services = authority;
	}
	modifier onlyServices() {
		require(msg.sender == services, 'Only premium services');
		_;
	}
	function totals(uint248 universe) external view returns (uint256 cash, uint256 units, uint48 portfolioTimestamp, bool isSealed) {
		Book storage book = books[universe];
		return (book.cash, Math.ceilDiv(book.units, UNIT_SCALE), book.portfolioTimestamp, book.isSealed);
	}
	function minimumFinalAfter(uint248 universe) external view returns (uint48) {
		return books[universe].minimumFinalAfter;
	}
	function register(uint248 universe, uint48 portfolioTimestamp) external onlyServices {
		require(!books[universe].exists, 'Premium universe exists');
		books[universe].exists = true;
		books[universe].portfolioTimestamp = portfolioTimestamp;
	}
	function question(uint248 universe, uint256 id) external view returns (uint256 units, uint256 cash) {
		Book storage book = books[universe];
		uint256 scaledUnits = _question(book, id).units;
		units = Math.ceilDiv(scaledUnits, UNIT_SCALE);
		cash = scaledUnits == 0 ? 0 : Math.mulDiv(book.cash, scaledUnits, book.units);
	}
	function fund(uint248 universe, uint256 id, uint256 cash) external onlyServices returns (uint256 units) {
		Book storage book = books[universe];
		require(book.exists && !book.isSealed && cash != 0, 'Premium funding unavailable');
		require(book.units == 0 || book.cash != 0, 'Premium book unfunded');
		Question memory state = _question(book, id);
		require(state.portfolioEndTime == 0, 'Reporting premium already active');
		units = book.units == 0 ? cash * UNIT_SCALE : Math.mulDiv(cash, book.units, book.cash, Math.Rounding.Ceil);
		state.units += units;
		book.units += units;
		require(book.units <= type(uint128).max, 'Premium unit domain exceeded');
		book.cash += cash;
		totalCash += cash;
		_write(book, id, state);
		units = Math.ceilDiv(units, UNIT_SCALE);
	}
	/// @dev Every mutation follows a global checkpoint at the old capital weights.
	function schedule(uint248 universe, uint256 id, uint48 finalAfterPortfolioTime) external onlyServices {
		Book storage book = books[universe];
		require(!book.isSealed, 'Premium universe sealed');
		Question memory state = _question(book, id);
		if (state.units == 0) return;
		_removeSchedule(universe, book, state);
		if (state.portfolioEndTime == 0) {
			// Scaled units preserve fractional premium rates within the uint128 domain.
			// The original funded deadline stays fixed when reporting is extended;
			// any fractional rate tail earns in full at that deadline.
			uint256 rate = state.units / MAXIMUM_REPORTING_WINDOW;
			require(rate <= type(uint128).max, 'Premium rate exceeds question domain');
			state.rate = uint128(rate);
			require(uint256(book.portfolioTimestamp) + MAXIMUM_REPORTING_WINDOW <= type(uint48).max, 'Premium clock exhausted');
			state.portfolioFundedEndTime = book.portfolioTimestamp + MAXIMUM_REPORTING_WINDOW;
		}
		state.portfolioStartTime = book.portfolioTimestamp;
		uint256 maximumEnd = state.portfolioFundedEndTime;
		state.portfolioEndTime = uint48(finalAfterPortfolioTime == 0 ? maximumEnd : Math.min(finalAfterPortfolioTime, maximumEnd));
		require(state.portfolioEndTime >= state.portfolioStartTime, 'Premium finality already elapsed');
		_changeRate(universe, book, state.portfolioEndTime, state.rate, true);
		uint256 tail = state.units - uint256(state.rate) * (state.portfolioEndTime - state.portfolioStartTime);
		if (state.portfolioEndTime == state.portfolioFundedEndTime)
			_changeTail(universe, book, state.portfolioEndTime, tail, true);
		else _changeRefund(universe, book, state.portfolioEndTime, tail, true);
		_write(book, id, state);
	}
	function cancel(uint248 universe, uint256 id) external onlyServices returns (uint256 unusedCash) {
		Book storage book = books[universe];
		if (book.isSealed) return 0;
		Question memory state = _question(book, id);
		if (state.units == 0) return 0;
		_removeSchedule(universe, book, state);
		unusedCash = _takeUnits(book, state.units);
		_write(book, id, Question(0, 0, 0, 0, 0));
	}
	function checkpoint(uint248 universe, uint48 portfolioTimestamp) external onlyServices returns (uint256 earnedCash, uint256 unusedCash) {
		Book storage book = books[universe];
		if (book.isSealed) return (0, 0);
		require(book.exists && portfolioTimestamp >= book.portfolioTimestamp && portfolioTimestamp <= block.timestamp, 'Invalid premium clock');
		uint256 earned = _integral(book, portfolioTimestamp) - _integral(book, book.portfolioTimestamp);
		unchecked {
			// Full-window tails belong to earned income, including a one-unit premium.
			earned +=
				tree.prefixTotalModular(book.tailRoot, portfolioTimestamp) -
				tree.prefixTotalModular(book.tailRoot, book.portfolioTimestamp);
		}
		if (earned != 0) earnedCash = _takeUnits(book, earned);
		if (portfolioTimestamp > book.minimumFinalAfter) {
			uint256 prefix =
				portfolioTimestamp == 0 ? 0 : tree.prefixTotalModular(book.refundRoot, portfolioTimestamp - 1);
			uint256 unused;
			unchecked {
				unused = prefix - book.refundedPrefix;
			}
			book.refundedPrefix = prefix;
			book.refundedBefore = portfolioTimestamp;
			if (unused != 0) unusedCash = _takeUnits(book, unused);
		}
		book.portfolioTimestamp = portfolioTimestamp;
	}
	function freeze(uint248 universe) external onlyServices {
		require(books[universe].exists, 'Unknown premium source');
		books[universe].isSealed = true;
		tree.seal(universe);
	}
	function choose(uint248 source, uint248 child, uint256 chosen, uint256 total) external onlyServices {
		Book storage parent = books[source];
		require(parent.isSealed && !books[child].exists && total != 0 && chosen <= total, 'Invalid premium choice');
		uint256 amount = Math.mulDiv(parent.cash, chosen, total);
		parent.assignedCash += amount - branchCash[child];
		branchCash[child] = amount;
	}
	/// @return dustCash Cash the caller must burn: a share too thin to carry the inherited units.
	function createChild(uint248 source, uint248 child) external onlyServices returns (uint256 dustCash) {
		Book storage parent = books[source];
		require(parent.isSealed && !books[child].exists, 'Invalid premium child');
		uint256 cash = branchCash[child];
		if (cash == 0 || parent.units / cash > MAXIMUM_INHERITED_UNITS_PER_CASH * UNIT_SCALE) {
			// Inherited units without cash are worth nothing, and a book holding only
			// such units could never price new funding. Units carrying only dust would
			// price new funding in so many units that, after a few thinly chosen forks,
			// the unit domain overflows and purchases revert. Either branch starts
			// empty. Its dust leaves the source's assigned cash and is burned: the
			// neutral cash that recovery divides must not change once choices close.
			parent.assignedCash -= cash;
			parent.cash -= cash;
			totalCash -= cash;
			branchCash[child] = 0;
			books[child] = Book(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, parent.portfolioTimestamp, parent.portfolioTimestamp + 3 days, parent.refundedBefore, true, false);
			return cash;
		}
		books[child] = Book(cash, parent.units, 0, 0, parent.refundedPrefix, parent.questionRoot, parent.rateRoot, parent.endRoot, parent.refundRoot, parent.tailRoot, parent.portfolioTimestamp, parent.portfolioTimestamp + 3 days, parent.refundedBefore, true, false);
	}
	function recover(uint248 source, uint256 id, uint256 shares, uint256 supply) external onlyServices returns (uint256 cash) {
		Book storage book = books[source];
		require(book.isSealed, 'Premium source not sealed');
		uint256 questionUnits = _question(book, id).units;
		if (questionUnits == 0 || shares == 0) return 0;
		uint256 beforeShares = recoveredShares[source][id];
		uint256 afterShares = beforeShares + shares;
		require(afterShares <= supply, 'Premium recovery exceeds supply');
		recoveredShares[source][id] = afterShares;
		uint256 units =
			Math.mulDiv(questionUnits, afterShares, supply) - Math.mulDiv(questionUnits, beforeShares, supply);
		uint256 neutral = book.cash - book.assignedCash;
		cash =
			Math.mulDiv(neutral, book.recoveredUnits + units, book.units) -
			Math.mulDiv(neutral, book.recoveredUnits, book.units);
		book.recoveredUnits += units;
		totalCash -= cash;
	}
	function _question(Book storage book, uint256 id) private view returns (Question memory state) {
		state = questions[uint64(questionMap.get(book.questionRoot, id))];
		if (state.portfolioEndTime == 0) return state;
		// A child response window cannot restore units already refunded in any ancestor.
		if (state.portfolioEndTime < book.refundedBefore) return Question(0, 0, 0, 0, 0);
		uint48 end = uint48(Math.min(book.portfolioTimestamp, state.portfolioEndTime));
		if (end == state.portfolioFundedEndTime) state.units = 0;
		else if (end > state.portfolioStartTime) state.units -= uint256(state.rate) * (end - state.portfolioStartTime);
		state.portfolioStartTime = book.portfolioTimestamp;
	}
	function _takeUnits(Book storage book, uint256 units) private returns (uint256 cash) {
		cash = units == book.units ? book.cash : Math.mulDiv(book.cash, units, book.units);
		book.units -= units;
		book.cash -= cash;
		totalCash -= cash;
	}
	function _removeSchedule(uint248 universe, Book storage book, Question memory state) private {
		if (state.portfolioEndTime == 0) return;
		_changeRate(universe, book, state.portfolioEndTime, state.rate, false);
		uint256 duration =
			state.portfolioEndTime > state.portfolioStartTime ? state.portfolioEndTime - state.portfolioStartTime : 0;
		uint256 tail = state.units - uint256(state.rate) * duration;
		if (state.portfolioEndTime == state.portfolioFundedEndTime)
			_changeTail(universe, book, state.portfolioEndTime, tail, false);
		else _changeRefund(universe, book, state.portfolioEndTime, tail, false);
	}
	function _integral(Book storage book, uint48 portfolioTimestamp) private view returns (uint256) {
		return
			(tree.total(book.rateRoot) - tree.prefixTotal(book.rateRoot, portfolioTimestamp)) * portfolioTimestamp +
			tree.prefixTotal(book.endRoot, portfolioTimestamp);
	}
	function _changeRate(uint248 universe, Book storage book, uint48 end, uint128 rate, bool increase) private {
		if (rate == 0) return;
		uint256 previous = tree.get(book.rateRoot, end);
		uint256 next = increase ? previous + rate : previous - rate;
		book.rateRoot = tree.set(universe, book.rateRoot, end, next, next);
		require(tree.total(book.rateRoot) <= type(uint208).max, 'Premium rate domain exceeded');
		book.endRoot = tree.set(universe, book.endRoot, end, next, next * end);
	}
	function _changeTail(uint248 universe, Book storage book, uint48 end, uint256 units, bool increase) private {
		if (units == 0) return;
		uint256 previous = tree.get(book.tailRoot, end);
		uint256 next = increase ? previous + units : previous - units;
		book.tailRoot = tree.setModular(universe, book.tailRoot, end, next, next);
	}

	function _changeRefund(uint248 universe, Book storage book, uint48 end, uint256 units, bool increase) private {
		if (units == 0) return;
		uint256 previous = tree.get(book.refundRoot, end);
		uint256 next = increase ? previous + units : previous - units;
		book.refundRoot = tree.setModular(universe, book.refundRoot, end, next, next);
	}
	function _write(Book storage book, uint256 id, Question memory state) private {
		uint64 stateId = ++lastQuestionId;
		questions[stateId] = state;
		book.questionRoot = questionMap.set(book.questionRoot, id, stateId);
	}
}
