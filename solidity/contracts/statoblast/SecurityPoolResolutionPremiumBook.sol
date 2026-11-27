// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolQuestionMap } from './SecurityPoolQuestionMap.sol';
import { SecurityPoolMaturityMap } from './SecurityPoolMaturityMap.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { Constants } from '../Constants.sol';

/// @notice Question-owned reporting premiums earn only until their funded finality.
/// @dev Custody stays with Services. Prefix integrals settle all expired streams
/// without visiting questions. Forks copy roots and preserve exact funded units.
contract SecurityPoolResolutionPremiumBook {
	using SecurityPoolMaturityMap for SecurityPoolMaturityMap.Store;
	using SecurityPoolQuestionMap for SecurityPoolQuestionMap.Store;
	uint256 public constant UNIT_SCALE = 1e9;
	uint48 public constant MAXIMUM_REPORTING_WINDOW = Constants.RESOLUTION_PREMIUM_WINDOW;
	uint256 private constant MAXIMUM_INHERITED_UNITS_PER_CASH = 1e12;
	// Rates are units per second and security pool times fit uint48, so rate integrals stay within
	// uint256 while rates fit uint208. A child prices new premium at its inherited units per
	// cash, at most about 1e21 below the dust limit; this domain still holds about 2^138 attoETH.
	uint256 private constant MAXIMUM_BOOK_UNITS = type(uint208).max;
	address public immutable services;
	uint256 public totalCash;
	SecurityPoolMaturityMap.Store private tree;
	SecurityPoolQuestionMap.Store private questionMap;
	uint64 private lastQuestionId;
	// Cash is held by Services; units allocate it. Every timestamp in this book uses security pool time.
	// securityPoolResolutionPremiumBook.test.ts checks funding, refunds and fork conservation.
	struct Book {
		uint256 cash;
		uint256 units;
		uint256 assignedCash;
		uint256 recoveredUnits;
		uint256 refundedPrefix;
		uint64 questionRoot;
		uint64 rateRoot;
		uint64 tailRoot;
		uint48 securityPoolTimestamp;
		uint48 minimumFinalAfter;
		uint48 refundedBefore;
		bool exists;
		bool isSealed;
	}
	struct Question {
		uint256 units;
		uint208 rate;
		uint48 securityPoolStartTime;
		uint48 securityPoolEndTime;
		uint48 securityPoolFundedEndTime;
	}
	// Conversion prices stay fixed between changes to the funding basket. Earned
	// fractions remain earned across checkpoints; unused premiums own rounding dust.
	// Funding and cancellation start a new epoch: fractions still below one cash
	// unit then belong to the remaining premium basket. Each child starts its own
	// epoch at the cash allocation chosen for that branch.
	struct ConversionEpoch {
		uint256 cash;
		uint256 units;
		uint256 earnedUnits;
		uint256 unusedUnits;
		uint256 earnedCash;
		uint256 unusedCash;
	}
	mapping(uint248 => ConversionEpoch) private conversionEpochs;
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
	function totals(uint248 universe) external view returns (uint256 cash, uint256 units, uint48 securityPoolTimestamp, bool isSealed) {
		Book storage book = books[universe];
		return (book.cash, Math.ceilDiv(book.units, UNIT_SCALE), book.securityPoolTimestamp, book.isSealed);
	}
	function minimumFinalAfter(uint248 universe) external view returns (uint48) {
		return books[universe].minimumFinalAfter;
	}
	function register(uint248 universe, uint48 securityPoolTimestamp) external onlyServices {
		require(!books[universe].exists, 'Premium universe exists');
		books[universe].exists = true;
		books[universe].securityPoolTimestamp = securityPoolTimestamp;
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
		require(state.securityPoolEndTime == 0, 'Reporting premium already active');
		units = book.units == 0 ? cash * UNIT_SCALE : Math.mulDiv(cash, book.units, book.cash, Math.Rounding.Ceil);
		state.units += units;
		book.units += units;
		require(book.units <= MAXIMUM_BOOK_UNITS, 'Premium unit domain exceeded');
		book.cash += cash;
		delete conversionEpochs[universe];
		totalCash += cash;
		_write(book, id, state);
		units = Math.ceilDiv(units, UNIT_SCALE);
	}
	/// @dev Every mutation follows a global checkpoint at the old capital weights.
	function schedule(uint248 universe, uint256 id, uint48 finalAfterSecurityPoolTime) external onlyServices {
		Book storage book = books[universe];
		require(!book.isSealed, 'Premium universe sealed');
		Question memory state = _question(book, id);
		if (state.units == 0) return;
		uint48 previousEnd = state.securityPoolEndTime;
		if (previousEnd == 0) {
			// Scaled units preserve fractional premium rates within the uint208 domain.
			// The original funded deadline stays fixed when reporting is extended;
			// any fractional rate tail earns in full at that deadline.
			uint256 rate = state.units / MAXIMUM_REPORTING_WINDOW;
			require(rate <= type(uint208).max, 'Premium rate exceeds question domain');
			state.rate = uint208(rate);
			require(uint256(book.securityPoolTimestamp) + MAXIMUM_REPORTING_WINDOW <= type(uint48).max, 'Premium clock exhausted');
			state.securityPoolFundedEndTime = book.securityPoolTimestamp + MAXIMUM_REPORTING_WINDOW;
		}
		uint256 maximumEnd = state.securityPoolFundedEndTime;
		// A report cannot extend the original prepaid funding horizon. Once it ends,
		// keep its scheduled refund and allow reporting to continue without a premium.
		if (previousEnd != 0 && maximumEnd <= book.securityPoolTimestamp) return;
		uint48 newEnd = uint48(finalAfterSecurityPoolTime == 0 ? maximumEnd : Math.min(finalAfterSecurityPoolTime, maximumEnd));
		require(newEnd >= book.securityPoolTimestamp, 'Premium finality already elapsed');
		if (newEnd == previousEnd) return;
		_removeSchedule(book, state);
		state.securityPoolStartTime = book.securityPoolTimestamp;
		state.securityPoolEndTime = newEnd;
		_changeRate(book, state.securityPoolEndTime, state.rate, true);
		uint256 tail = state.units - uint256(state.rate) * (state.securityPoolEndTime - state.securityPoolStartTime);
		if (state.securityPoolEndTime == state.securityPoolFundedEndTime)
			_changeTail(book, state.securityPoolEndTime, tail, true);
		else _changeRefund(book, state.securityPoolEndTime, tail, true);
		_write(book, id, state);
	}
	function cancel(uint248 universe, uint256 id) external onlyServices returns (uint256 unusedCash) {
		Book storage book = books[universe];
		if (book.isSealed) return 0;
		Question memory state = _question(book, id);
		if (state.units == 0) return 0;
		_removeSchedule(book, state);
		unusedCash = _takeUnits(book, state.units);
		delete conversionEpochs[universe];
		_write(book, id, Question({units: 0, rate: 0, securityPoolStartTime: 0, securityPoolEndTime: 0, securityPoolFundedEndTime: 0}));
	}
	function checkpoint(uint248 universe, uint48 securityPoolTimestamp) external onlyServices returns (uint256 earnedCash, uint256 unusedCash) {
		Book storage book = books[universe];
		if (book.isSealed) return (0, 0);
		require(book.exists && securityPoolTimestamp >= book.securityPoolTimestamp && securityPoolTimestamp <= block.timestamp, 'Invalid premium clock');
		uint256 earned = _integral(book, securityPoolTimestamp) - _integral(book, book.securityPoolTimestamp);
		(uint256 tailThrough, ) = tree.prefix(book.tailRoot, securityPoolTimestamp);
		(uint256 tailPreviouslyEarned, ) = tree.prefix(book.tailRoot, book.securityPoolTimestamp);
		unchecked {
			// Full-window tails belong to earned income, including a one-unit premium.
			earned += tailThrough - tailPreviouslyEarned;
		}
		uint256 unused;
		if (securityPoolTimestamp > book.minimumFinalAfter) {
			(, uint256 prefix) = tree.prefix(book.tailRoot, securityPoolTimestamp - 1);
			unchecked {
				unused = prefix - book.refundedPrefix;
			}
			book.refundedPrefix = prefix;
			book.refundedBefore = securityPoolTimestamp;
		}
		(earnedCash, unusedCash) = _takeCheckpointUnits(book, conversionEpochs[universe], earned, unused);
		book.securityPoolTimestamp = securityPoolTimestamp;
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
			books[child] = Book({cash: 0, units: 0, assignedCash: 0, recoveredUnits: 0, refundedPrefix: 0, questionRoot: 0, rateRoot: 0, tailRoot: 0, securityPoolTimestamp: parent.securityPoolTimestamp, minimumFinalAfter: parent.securityPoolTimestamp, refundedBefore: parent.refundedBefore, exists: true, isSealed: false});
			return cash;
		}
		books[child] = Book({cash: cash, units: parent.units, assignedCash: 0, recoveredUnits: 0, refundedPrefix: parent.refundedPrefix, questionRoot: parent.questionRoot, rateRoot: parent.rateRoot, tailRoot: parent.tailRoot, securityPoolTimestamp: parent.securityPoolTimestamp, minimumFinalAfter: parent.securityPoolTimestamp, refundedBefore: parent.refundedBefore, exists: true, isSealed: false});
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
		// Differences of cumulative floors conserve every unit across partial claims;
		// flooring each claim independently would leave rounding dust unallocated.
		uint256 units =
			Math.mulDiv(questionUnits, afterShares, supply) - Math.mulDiv(questionUnits, beforeShares, supply);
		uint256 neutral = book.cash - book.assignedCash;
		// Apply the same cumulative allocation to the fixed neutral cash basket.
		cash =
			Math.mulDiv(neutral, book.recoveredUnits + units, book.units) -
			Math.mulDiv(neutral, book.recoveredUnits, book.units);
		book.recoveredUnits += units;
		totalCash -= cash;
	}
	function _question(Book storage book, uint256 id) private view returns (Question memory state) {
		state = questions[uint64(questionMap.get(book.questionRoot, id))];
		if (state.securityPoolEndTime == 0) return state;
		// A child response window cannot restore units already refunded in any ancestor.
		if (state.securityPoolEndTime < book.refundedBefore)
			return
				Question({units: 0, rate: 0, securityPoolStartTime: 0, securityPoolEndTime: 0, securityPoolFundedEndTime: 0});
		uint48 end = uint48(Math.min(book.securityPoolTimestamp, state.securityPoolEndTime));
		if (end == state.securityPoolFundedEndTime) state.units = 0;
		else if (end > state.securityPoolStartTime)
			state.units -= uint256(state.rate) * (end - state.securityPoolStartTime);
		state.securityPoolStartTime = book.securityPoolTimestamp;
	}
	function _takeCheckpointUnits(Book storage book, ConversionEpoch storage epoch, uint256 earned, uint256 unused) private returns (uint256 earnedCash, uint256 unusedCash) {
		if (earned == 0 && unused == 0) return (0, 0);
		if (epoch.units == 0) {
			epoch.cash = book.cash;
			epoch.units = book.units;
		}
		epoch.earnedUnits += earned;
		epoch.unusedUnits += unused;
		uint256 nextEarnedCash = Math.mulDiv(epoch.cash, epoch.earnedUnits, epoch.units);
		// Only terminal reconciliation awards raw rounding dust. Paying it early
		// could exhaust cash while live question units still need funding prices.
		uint256 nextUnusedCash =
			earned + unused == book.units
				? epoch.cash - nextEarnedCash
				: Math.mulDiv(epoch.cash, epoch.unusedUnits, epoch.units);
		earnedCash = nextEarnedCash - epoch.earnedCash;
		unusedCash = nextUnusedCash - epoch.unusedCash;
		epoch.earnedCash = nextEarnedCash;
		epoch.unusedCash = nextUnusedCash;
		book.units -= earned + unused;
		book.cash -= earnedCash + unusedCash;
		totalCash -= earnedCash + unusedCash;
	}

	function _takeUnits(Book storage book, uint256 units) private returns (uint256 cash) {
		cash = units == book.units ? book.cash : Math.mulDiv(book.cash, units, book.units);
		book.units -= units;
		book.cash -= cash;
		totalCash -= cash;
	}
	function _removeSchedule(Book storage book, Question memory state) private {
		if (state.securityPoolEndTime == 0) return;
		_changeRate(book, state.securityPoolEndTime, state.rate, false);
		uint256 duration =
			state.securityPoolEndTime > state.securityPoolStartTime
				? state.securityPoolEndTime - state.securityPoolStartTime
				: 0;
		uint256 tail = state.units - uint256(state.rate) * duration;
		if (state.securityPoolEndTime == state.securityPoolFundedEndTime)
			_changeTail(book, state.securityPoolEndTime, tail, false);
		else _changeRefund(book, state.securityPoolEndTime, tail, false);
	}
	function _integral(Book storage book, uint48 securityPoolTimestamp) private view returns (uint256) {
		(uint256 endedRate, uint256 weightedEnds) = tree.prefix(book.rateRoot, securityPoolTimestamp);
		return (tree.total(book.rateRoot) - endedRate) * securityPoolTimestamp + weightedEnds;
	}

	function _changeRate(Book storage book, uint48 end, uint208 rate, bool increase) private {
		if (rate == 0) return;
		if (!increase) {
			(uint256 prior, ) = tree.get(book.rateRoot, end);
			require(prior >= rate, 'Premium deadline rate too low');
		}
		uint256 weighted = uint256(rate) * end;
		unchecked {
			book.rateRoot = tree.add(book.rateRoot, end, increase ? rate : 0 - uint256(rate), increase ? weighted : 0 - weighted);
		}
		require(tree.total(book.rateRoot) <= type(uint208).max, 'Premium rate domain exceeded');
	}

	function _changeTail(Book storage book, uint48 end, uint256 units, bool increase) private {
		if (units == 0) return;
		if (!increase) {
			(uint256 prior, ) = tree.get(book.tailRoot, end);
			require(prior >= units, 'Premium deadline tail too low');
		}
		unchecked {
			book.tailRoot = tree.add(book.tailRoot, end, increase ? units : 0 - units, 0);
		}
	}

	function _changeRefund(Book storage book, uint48 end, uint256 units, bool increase) private {
		if (units == 0) return;
		if (!increase) {
			(, uint256 prior) = tree.get(book.tailRoot, end);
			require(prior >= units, 'Premium deadline refund too low');
		}
		unchecked {
			book.tailRoot = tree.add(book.tailRoot, end, 0, increase ? units : 0 - units);
		}
	}
	function _write(Book storage book, uint256 id, Question memory state) private {
		uint64 stateId = ++lastQuestionId;
		questions[stateId] = state;
		book.questionRoot = questionMap.set(book.questionRoot, id, stateId);
	}
}
