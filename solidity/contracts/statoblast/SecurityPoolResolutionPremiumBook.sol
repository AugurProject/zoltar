// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Question-owned reporting premiums earn only until their funded finality.
/// @dev Custody stays with Services. Prefix integrals settle all expired streams
/// without visiting questions. Forks copy roots and preserve exact funded units.
contract SecurityPoolResolutionPremiumBook {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;
	uint48 public constant MAXIMUM_REPORTING_WINDOW = 3 days + 7 weeks;
	address public immutable services;
	uint256 public totalCash;
	SecurityPoolPersistentMap.Store private tree;
	uint64 private lastQuestionId;
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
		uint48 timestamp;
		uint48 minimumFinalAfter;
		uint48 refundedBefore;
		bool exists;
		bool isSealed;
	}
	struct Question {
		uint256 units;
		uint96 rate;
		uint48 start;
		uint48 end;
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
	function totals(uint248 universe) external view returns (uint256 cash, uint256 units, uint48 timestamp, bool isSealed) {
		Book storage book = books[universe];
		return (book.cash, book.units, book.timestamp, book.isSealed);
	}
	function minimumFinalAfter(uint248 universe) external view returns (uint48) {
		return books[universe].minimumFinalAfter;
	}
	function register(uint248 universe, uint48 timestamp) external onlyServices {
		require(!books[universe].exists, 'Premium universe exists');
		books[universe].exists = true;
		books[universe].timestamp = timestamp;
	}
	function question(uint248 universe, uint256 id) external view returns (uint256 units, uint256 cash) {
		Book storage book = books[universe];
		units = _question(book, id).units;
		cash = units == 0 ? 0 : Math.mulDiv(book.cash, units, book.units);
	}
	function fund(uint248 universe, uint256 id, uint256 cash) external onlyServices returns (uint256 units) {
		Book storage book = books[universe];
		require(book.exists && !book.isSealed && cash != 0, 'Premium funding unavailable');
		require(book.units == 0 || book.cash != 0, 'Premium book unfunded');
		Question memory state = _question(book, id);
		require(state.end == 0, 'Reporting premium already active');
		units = book.units == 0 ? cash : Math.mulDiv(cash, book.units, book.cash, Math.Rounding.Ceil);
		state.units += units;
		book.units += units;
		require(book.units <= type(uint128).max, 'Premium unit domain exceeded');
		book.cash += cash;
		totalCash += cash;
		_write(book, id, state);
	}
	/// @dev Every mutation follows a global checkpoint at the old capital weights.
	function schedule(uint248 universe, uint256 id, uint48 finalAfter) external onlyServices {
		Book storage book = books[universe];
		require(!book.isSealed, 'Premium universe sealed');
		Question memory state = _question(book, id);
		if (state.units == 0) return;
		_removeSchedule(book, state);
		if (state.end == 0) {
			uint256 rate = state.units / MAXIMUM_REPORTING_WINDOW;
			require(rate <= type(uint96).max, 'Premium rate exceeds question domain');
			state.rate = uint96(rate);
		}
		state.start = book.timestamp;
		uint256 duration = state.rate == 0 ? MAXIMUM_REPORTING_WINDOW : state.units / state.rate;
		uint256 maximumEnd = Math.min(type(uint48).max, uint256(state.start) + duration);
		state.end = uint48(finalAfter == 0 ? maximumEnd : Math.min(finalAfter, maximumEnd));
		require(state.end >= state.start, 'Premium finality already elapsed');
		_changeRate(book, state.end, state.rate, true);
		_changeRefund(book, state.end, state.units - uint256(state.rate) * (state.end - state.start), true);
		_write(book, id, state);
	}
	function cancel(uint248 universe, uint256 id) external onlyServices returns (uint256 unusedCash) {
		Book storage book = books[universe];
		if (book.isSealed) return 0;
		Question memory state = _question(book, id);
		if (state.units == 0) return 0;
		_removeSchedule(book, state);
		unusedCash = _takeUnits(book, state.units);
		_write(book, id, Question(0, 0, 0, 0));
	}
	function checkpoint(uint248 universe, uint48 timestamp) external onlyServices returns (uint256 earnedCash, uint256 unusedCash) {
		Book storage book = books[universe];
		if (book.isSealed) return (0, 0);
		require(book.exists && timestamp >= book.timestamp && timestamp <= block.timestamp, 'Invalid premium clock');
		uint256 earned = _integral(book, timestamp) - _integral(book, book.timestamp);
		if (earned != 0) earnedCash = _takeUnits(book, earned);
		if (timestamp > book.minimumFinalAfter) {
			uint256 prefix = timestamp == 0 ? 0 : tree.prefixTotalModular(book.refundRoot, timestamp - 1);
			uint256 unused;
			unchecked {
				unused = prefix - book.refundedPrefix;
			}
			book.refundedPrefix = prefix;
			book.refundedBefore = timestamp;
			if (unused != 0) unusedCash = _takeUnits(book, unused);
		}
		book.timestamp = timestamp;
	}
	function freeze(uint248 universe) external onlyServices {
		require(books[universe].exists, 'Unknown premium source');
		books[universe].isSealed = true;
	}
	function choose(uint248 source, uint248 child, uint256 chosen, uint256 total) external onlyServices {
		Book storage parent = books[source];
		require(parent.isSealed && !books[child].exists && total != 0 && chosen <= total, 'Invalid premium choice');
		uint256 amount = Math.mulDiv(parent.cash, chosen, total);
		parent.assignedCash += amount - branchCash[child];
		branchCash[child] = amount;
	}
	function createChild(uint248 source, uint248 child) external onlyServices {
		Book storage parent = books[source];
		require(parent.isSealed && !books[child].exists, 'Invalid premium child');
		books[child] = Book(branchCash[child], parent.units, 0, 0, parent.refundedPrefix, parent.questionRoot, parent.rateRoot, parent.endRoot, parent.refundRoot, parent.timestamp, parent.timestamp + 3 days, parent.refundedBefore, true, false);
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
		state = questions[uint64(tree.get(book.questionRoot, id))];
		if (state.end == 0) return state;
		// A child response window cannot restore units already refunded in any ancestor.
		if (state.end < book.refundedBefore) return Question(0, 0, 0, 0);
		uint48 end = uint48(Math.min(book.timestamp, state.end));
		if (end > state.start) state.units -= uint256(state.rate) * (end - state.start);
		state.start = book.timestamp;
	}
	function _takeUnits(Book storage book, uint256 units) private returns (uint256 cash) {
		cash = units == book.units ? book.cash : Math.mulDiv(book.cash, units, book.units);
		book.units -= units;
		book.cash -= cash;
		totalCash -= cash;
	}
	function _removeSchedule(Book storage book, Question memory state) private {
		if (state.end == 0) return;
		_changeRate(book, state.end, state.rate, false);
		uint256 duration = state.end > state.start ? state.end - state.start : 0;
		_changeRefund(book, state.end, state.units - uint256(state.rate) * duration, false);
	}
	function _integral(Book storage book, uint48 timestamp) private view returns (uint256) {
		return
			(tree.total(book.rateRoot) - tree.prefixTotal(book.rateRoot, timestamp)) * timestamp +
			tree.prefixTotal(book.endRoot, timestamp);
	}
	function _changeRate(Book storage book, uint48 end, uint96 rate, bool increase) private {
		if (rate == 0) return;
		uint256 previous = tree.get(book.rateRoot, end);
		uint256 next = increase ? previous + rate : previous - rate;
		book.rateRoot = tree.set(book.rateRoot, end, next, next);
		require(tree.total(book.rateRoot) <= type(uint208).max, 'Premium rate domain exceeded');
		book.endRoot = tree.set(book.endRoot, end, next, next * end);
	}
	function _changeRefund(Book storage book, uint48 end, uint256 units, bool increase) private {
		if (units == 0) return;
		uint256 previous = tree.get(book.refundRoot, end);
		uint256 next = increase ? previous + units : previous - units;
		book.refundRoot = tree.setModular(book.refundRoot, end, next, next);
	}
	function _write(Book storage book, uint256 id, Question memory state) private {
		uint64 stateId = ++lastQuestionId;
		questions[stateId] = state;
		book.questionRoot = tree.set(book.questionRoot, id, stateId, 0);
	}
}
