// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';

/// @notice Central ETH settlement accounting with distinct internal units and outcome supply.
/// @dev This contract records liabilities; its authority holds and transfers the actual ETH.
/// Every reported funding delta must be atomically backed by that custody. The authority also
/// authenticates complete-set or winning-outcome burns and supplies irreversible finality.
/// Finality uses a logical clock paused during forks; fee deadlines retain native calendar time.
/// A fork copies immutable roots, including ALL inherited outcome liabilities, in constant work.
contract SecurityPoolSettlementBook {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;

	uint256 public constant EXCHANGE_RATE_SCALE = 1e18;
	uint48 public constant MINIMUM_FORK_RESPONSE = 3 days;
	address public immutable portfolio;
	uint256 public immutable minimumOutcomeExchangeRate;
	uint64 public lastBookId;
	uint64 public lastFrozenBookId;
	uint64 private lastQuestionStateId;
	uint64 private lastFeeModeId;
	SecurityPoolPersistentMap.Store private tree;

	struct Book {
		uint256 cashAttoEth;
		uint256 units;
		uint256 feeCashAttoEth;
		uint64 questionRoot;
		uint64 finalityRoot;
		uint64 frozenRoot;
		uint48 timestamp;
		bool isSealed;
		uint64 feeRateRoot;
		uint64 feeEndRoot;
		uint64 feeModeRoot;
		bool feesEnabled;
		uint48 minimumFinalAfter;
		uint48 feeTimeOffset;
	}

	struct Question {
		uint256 units;
		uint256 outcomeSupplyAttoShares;
		uint48 finalAfter;
		uint96 feeRateAttoEthPerSecond;
		uint48 feeStart;
		uint48 feeEnd;
		uint256 feePrincipalAttoEth;
	}

	struct FrozenBook {
		uint256 cashAttoEth;
		uint256 units;
		uint64 sourceBookId;
	}

	struct FeeMode {
		uint256 fundedSeconds;
		uint48 timestamp;
		bool funded;
	}

	mapping(uint64 => Book) public books;
	mapping(uint64 => FrozenBook) public frozenBooks;
	mapping(uint64 => Question) private questionStates;
	mapping(uint64 => FeeMode) private feeModes;

	event BookCreated(uint64 indexed bookId, uint64 indexed sourceBookId, uint256 cashAttoEth, uint256 units);
	event SettlementMinted(uint64 indexed bookId, uint256 indexed questionId, uint256 cashAttoEth, uint256 outcomeShares);
	event SettlementRedeemed(uint64 indexed bookId, uint256 indexed questionId, uint256 outcomeShares, uint256 units, uint256 cashAttoEth);
	event FeesCharged(uint64 indexed bookId, uint256 indexed questionId, uint256 cashAttoEth);
	event FinalityScheduled(uint64 indexed bookId, uint256 indexed questionId, uint48 finalAfter);
	event FinalClaimsFrozen(uint64 indexed bookId, uint64 indexed frozenBookId, uint48 timestamp, uint256 units, uint256 cashAttoEth);
	event FeeStreamReplaced(uint64 indexed bookId, uint256 indexed questionId, uint96 rateAttoEthPerSecond, uint48 end);
	event AggregateFeesAccrued(uint64 indexed bookId, uint48 timestamp, uint256 cashAttoEth);

	constructor(address authority, uint256 minimumExchangeRate) {
		require(authority != address(0), 'Invalid settlement authority');
		require(minimumExchangeRate > 0 && minimumExchangeRate <= EXCHANGE_RATE_SCALE, 'Invalid minimum exchange rate');
		portfolio = authority;
		minimumOutcomeExchangeRate = minimumExchangeRate;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	function createBook(uint48 timestamp) external onlyPortfolio returns (uint64 bookId) {
		require(timestamp <= block.timestamp, 'Future settlement clock');
		bookId = ++lastBookId;
		books[bookId].timestamp = timestamp;
		books[bookId].feesEnabled = true;
		_setFeeMode(books[bookId], true);
		emit BookCreated(bookId, 0, 0, 0);
	}

	/// @notice Seal a source at fork time after protecting claims already final strictly before it.
	/// @dev Sealed sources allow frozen claims and fee collection, but no active-unit redemptions.
	function sealForFork(uint64 bookId, uint48 timestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		book.isSealed = true;
	}

	/// @notice Create a child with independently supplied ETH and every source outcome liability.
	/// @dev Source fee escrow and finalized claims remain source obligations and are not duplicated.
	function createChildBook(uint64 sourceBookId, uint256 fundedCashAttoEth) external onlyPortfolio returns (uint64 bookId) {
		Book storage source = _book(sourceBookId);
		require(source.isSealed, 'Settlement source not sealed');
		require(fundedCashAttoEth <= source.units, 'Child cash exceeds liabilities');
		bookId = ++lastBookId;
		Book storage child = books[bookId];
		child.cashAttoEth = fundedCashAttoEth;
		child.units = source.units;
		child.questionRoot = source.questionRoot;
		child.finalityRoot = source.finalityRoot;
		child.frozenRoot = source.frozenRoot;
		child.timestamp = source.timestamp;
		child.feeRateRoot = source.feeRateRoot;
		child.feeEndRoot = source.feeEndRoot;
		child.feeModeRoot = source.feeModeRoot;
		child.feesEnabled = source.feesEnabled;
		child.minimumFinalAfter = source.timestamp + MINIMUM_FORK_RESPONSE;
		child.feeTimeOffset = source.feeTimeOffset;
		_setFeeMode(child, fundedCashAttoEth == source.units && source.feesEnabled);
		emit BookCreated(bookId, sourceBookId, fundedCashAttoEth, source.units);
	}

	/// @notice Return economic outcome supply, including inherited shares not materialized locally.
	function question(uint64 bookId, uint256 questionId) public view returns (Question memory state, uint64 frozenBookId) {
		Book storage book = _book(bookId);
		state = questionStates[uint64(tree.get(book.questionRoot, questionId))];
		state = _materializeFees(book, state);
		if (state.finalAfter != 0) frozenBookId = uint64(tree.ceiling(book.frozenRoot, state.finalAfter));
	}

	/// @notice Whether sealing at the fork clock preserves this question as a live source liability.
	function hasLiveForkRecoveryRight(uint64 bookId, uint256 questionId, uint48 forkTimestamp) external view returns (bool) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		return
			frozenBookId == 0 &&
			state.outcomeSupplyAttoShares != 0 &&
			(book.isSealed ||
				forkTimestamp <= book.minimumFinalAfter ||
				state.finalAfter == 0 ||
				state.finalAfter >= forkTimestamp);
	}

	function feeTimestamp(uint64 bookId) external view returns (uint48) {
		return _feeTimestamp(_book(bookId));
	}

	/// @notice Skip an inactive fork window without extending any question's calendar deadline.
	/// @dev The child is prepared before its activation date, so this clock may be in the future
	/// while fees are disabled. Its logical finality clock and inherited claims do not advance.
	function setFeeClock(uint64 bookId, uint48 nativeTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		require(!book.feesEnabled, 'Pause fees before clock change');
		require(nativeTimestamp >= _feeTimestamp(book), 'Fee clock cannot go backwards');
		book.feeTimeOffset = nativeTimestamp - book.timestamp;
		_setFeeMode(book, false);
	}

	function totals(uint64 bookId)
		external
		view
		returns (uint256 cashAttoEth, uint256 units, uint256 feeCashAttoEth, uint48 timestamp, bool isSealed)
	{
		Book storage book = _book(bookId);
		return (book.cashAttoEth, book.units, book.feeCashAttoEth, book.timestamp, book.isSealed);
	}

	function quoteMint(uint64 bookId, uint256 questionId, uint256 cashAttoEth) external view returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		require(book.cashAttoEth == book.units, 'Settlement in runoff');
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0 && state.finalAfter == 0, 'Settlement mint closed');
		if (state.outcomeSupplyAttoShares == 0) return cashAttoEth;
		require(state.units > 0 && Math.mulDiv(state.units, EXCHANGE_RATE_SCALE, state.outcomeSupplyAttoShares) >= minimumOutcomeExchangeRate, 'Outcome exchange below minimum');
		return Math.mulDiv(cashAttoEth, state.outcomeSupplyAttoShares, state.units);
	}

	function mint(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 minimumShares, uint48 timestamp) external onlyPortfolio returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		require(book.cashAttoEth == book.units, 'Settlement in runoff');
		require(cashAttoEth > 0, 'Zero settlement funding');
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0 && state.finalAfter == 0, 'Settlement mint closed');
		if (state.outcomeSupplyAttoShares == 0) {
			require(state.units == 0, 'Outcome accounting mismatch');
			outcomeShares = cashAttoEth;
		} else {
			require(state.units > 0, 'Outcome exchange exhausted');
			require(Math.mulDiv(state.units, EXCHANGE_RATE_SCALE, state.outcomeSupplyAttoShares) >= minimumOutcomeExchangeRate, 'Outcome exchange below minimum');
			outcomeShares = Math.mulDiv(cashAttoEth, state.outcomeSupplyAttoShares, state.units);
		}
		require(outcomeShares > 0 && outcomeShares >= minimumShares, 'Insufficient outcome shares');
		state.feePrincipalAttoEth +=
			state.outcomeSupplyAttoShares == 0
				? cashAttoEth
				: Math.mulDiv(state.feePrincipalAttoEth, outcomeShares, state.outcomeSupplyAttoShares, Math.Rounding.Ceil);
		state.units += cashAttoEth;
		state.outcomeSupplyAttoShares += outcomeShares;
		book.cashAttoEth += cashAttoEth;
		book.units += cashAttoEth;
		_writeQuestion(book, questionId, state);
		emit SettlementMinted(bookId, questionId, cashAttoEth, outcomeShares);
	}

	/// @notice Burn authenticated complete sets or winning outcomes and return their funded cash.
	function redeem(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint256 minimumCashAttoEth, uint48 timestamp) external onlyPortfolio returns (uint256 cashAttoEth, uint256 unitsBurned) {
		Book storage book = _book(bookId);
		if (!book.isSealed) _freezeMatured(bookId, book, timestamp);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(outcomeShares > 0 && outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		unitsBurned =
			outcomeShares == state.outcomeSupplyAttoShares
				? state.units
				: Math.mulDiv(state.units, outcomeShares, state.outcomeSupplyAttoShares);
		if (frozenBookId == 0) {
			require(!book.isSealed, 'Use child settlement book');
			cashAttoEth = _cashForUnits(book.cashAttoEth, book.units, unitsBurned);
			book.cashAttoEth -= cashAttoEth;
			book.units -= unitsBurned;
			_changeFinalityUnits(book, state.finalAfter, unitsBurned, false);
		} else {
			FrozenBook storage frozen = frozenBooks[frozenBookId];
			require(frozen.sourceBookId == bookId, 'Use source final claim');
			cashAttoEth = _cashForUnits(frozen.cashAttoEth, frozen.units, unitsBurned);
			frozen.cashAttoEth -= cashAttoEth;
			frozen.units -= unitsBurned;
		}
		require(cashAttoEth >= minimumCashAttoEth, 'Insufficient settlement cash');
		state.units -= unitsBurned;
		state.feePrincipalAttoEth = Math.mulDiv(state.feePrincipalAttoEth, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares);
		if (state.feeRateAttoEthPerSecond != 0) {
			_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond, false);
			state.feeRateAttoEthPerSecond = uint96(Math.mulDiv(state.feeRateAttoEthPerSecond, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares));
			_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond, true);
		}
		state.outcomeSupplyAttoShares -= outcomeShares;
		_writeQuestion(book, questionId, state);
		_syncFeeMode(book);
		emit SettlementRedeemed(bookId, questionId, outcomeShares, unitsBurned, cashAttoEth);
	}

	/// @notice Replace one prospective collateral fee stream after checkpointing every old stream.
	/// @dev The full maximum budget must fit the question's units. Runoff pauses accrual globally;
	/// pausing never extends the absolute end, so skipped intervals cannot be charged after recap.
	function replaceFeeStream(uint64 bookId, uint256 questionId, uint96 rateAttoEthPerSecond, uint48 end, uint48 timestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0, 'Final claim fees closed');
		uint48 nativeTimestamp = _feeTimestamp(book);
		require(rateAttoEthPerSecond == 0 || (state.finalAfter == 0 && end > nativeTimestamp), 'Invalid question fee interval');
		require(rateAttoEthPerSecond == 0 || uint256(rateAttoEthPerSecond) * (end - nativeTimestamp) <= state.units, 'Question fees unfunded');
		_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond, false);
		state.feeRateAttoEthPerSecond = rateAttoEthPerSecond;
		state.feeStart = nativeTimestamp;
		state.feeEnd = rateAttoEthPerSecond == 0 ? 0 : end;
		_changeFeeRate(book, state.feeEnd, rateAttoEthPerSecond, true);
		_writeQuestion(book, questionId, state);
		emit FeeStreamReplaced(bookId, questionId, rateAttoEthPerSecond, state.feeEnd);
	}

	/// @notice Move collateral-funded fees to a disjoint liability, burning equal settlement units.
	function chargeFee(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint48 timestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		require(book.cashAttoEth == book.units, 'Runoff fees paused');
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0, 'Final claim fees closed');
		require(cashAttoEth <= state.units, 'Fee exceeds question units');
		state.units -= cashAttoEth;
		uint48 nativeTimestamp = _feeTimestamp(book);
		require(state.feeEnd <= nativeTimestamp || uint256(state.feeRateAttoEthPerSecond) * (state.feeEnd - nativeTimestamp) <= state.units, 'Question fees unfunded');
		book.units -= cashAttoEth;
		book.cashAttoEth -= cashAttoEth;
		book.feeCashAttoEth += cashAttoEth;
		_changeFinalityUnits(book, state.finalAfter, cashAttoEth, false);
		_writeQuestion(book, questionId, state);
		emit FeesCharged(bookId, questionId, cashAttoEth);
	}

	function collectFees(uint64 bookId, uint256 cashAttoEth) external onlyPortfolio {
		Book storage book = _book(bookId);
		require(cashAttoEth <= book.feeCashAttoEth, 'Fee escrow insufficient');
		book.feeCashAttoEth -= cashAttoEth;
	}

	/// @notice Stop at the last valid price timestamp before advancing through a stale-price period.
	function setFeeAccrualEnabled(uint64 bookId, bool enabled, uint48 timestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		require(!enabled || _feeTimestamp(book) <= block.timestamp, 'Fee activation is in the future');
		book.feesEnabled = enabled;
		_syncFeeMode(book);
	}

	/// @notice Voluntary, non-share-issuing cash restores existing claims, at most to par.
	function recapitalize(uint64 bookId, uint256 cashAttoEth, uint48 timestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		require(cashAttoEth > 0 && cashAttoEth <= book.units - book.cashAttoEth, 'Invalid settlement recapitalization');
		book.cashAttoEth += cashAttoEth;
		_syncFeeMode(book);
	}

	/// @notice Schedule a bound outcome's irreversible deadline; ordinary question end is insufficient.
	/// @dev The authority must replace/cancel this schedule atomically whenever reporting changes it.
	function scheduleFinality(uint64 bookId, uint256 questionId, uint48 finalAfter, uint48 timestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, timestamp);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0, 'Final claim immutable');
		require(finalAfter == 0 || finalAfter >= timestamp, 'Finality already elapsed');
		require(finalAfter == 0 || state.feeRateAttoEthPerSecond == 0 || state.feeEnd <= _feeTimestamp(book), 'Stop fees before finality');
		_changeFinalityUnits(book, state.finalAfter, state.units, false);
		state.finalAfter = finalAfter;
		_changeFinalityUnits(book, state.finalAfter, state.units, true);
		_writeQuestion(book, questionId, state);
		emit FinalityScheduled(bookId, questionId, state.finalAfter);
	}

	function freezeMatured(uint64 bookId, uint48 timestamp) external onlyPortfolio returns (uint64 frozenBookId) {
		Book storage book = _activeBook(bookId);
		return _freezeMatured(bookId, book, timestamp);
	}

	function quoteRedemption(uint64 bookId, uint256 questionId, uint256 outcomeShares) external view returns (uint256 cashAttoEth, uint256 unitsBurned) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		if (outcomeShares == 0) return (0, 0);
		unitsBurned =
			outcomeShares == state.outcomeSupplyAttoShares
				? state.units
				: Math.mulDiv(state.units, outcomeShares, state.outcomeSupplyAttoShares);
		if (frozenBookId == 0) return (_cashForUnits(book.cashAttoEth, book.units, unitsBurned), unitsBurned);
		FrozenBook storage frozen = frozenBooks[frozenBookId];
		if (frozen.sourceBookId != bookId) return (0, 0);
		return (_cashForUnits(frozen.cashAttoEth, frozen.units, unitsBurned), unitsBurned);
	}

	function _freezeMatured(uint64 bookId, Book storage book, uint48 timestamp) private returns (uint64 frozenBookId) {
		require(timestamp >= book.timestamp && timestamp <= block.timestamp, 'Invalid settlement clock');
		uint48 previousFeeTime = _feeTimestamp(book);
		uint48 nextFeeTime = timestamp + book.feeTimeOffset;
		if (feeModes[uint64(tree.floor(book.feeModeRoot, previousFeeTime))].funded && nextFeeTime > previousFeeTime) {
			uint256 fees = _feeIntegral(book, nextFeeTime) - _feeIntegral(book, previousFeeTime);
			book.cashAttoEth -= fees;
			book.units -= fees;
			book.feeCashAttoEth += fees;
			if (fees != 0) emit AggregateFeesAccrued(bookId, timestamp, fees);
		}
		book.timestamp = timestamp;
		if (timestamp <= book.minimumFinalAfter) return 0;
		(uint64 matured, uint64 pending) = tree.split(book.finalityRoot, timestamp - 1);
		book.finalityRoot = pending;
		uint256 units = tree.total(matured);
		if (units == 0) return 0;
		uint256 cashAttoEth = _cashForUnits(book.cashAttoEth, book.units, units);
		book.cashAttoEth -= cashAttoEth;
		book.units -= units;
		frozenBookId = ++lastFrozenBookId;
		frozenBooks[frozenBookId] = FrozenBook(cashAttoEth, units, bookId);
		book.frozenRoot = tree.set(book.frozenRoot, timestamp - 1, frozenBookId, 0);
		_syncFeeMode(book);
		emit FinalClaimsFrozen(bookId, frozenBookId, timestamp, units, cashAttoEth);
	}

	function _materializeFees(Book storage book, Question memory state) private view returns (Question memory) {
		if (state.feeRateAttoEthPerSecond == 0) return state;
		uint48 nativeTimestamp = _feeTimestamp(book);
		uint48 end = nativeTimestamp < state.feeEnd ? nativeTimestamp : state.feeEnd;
		if (end > state.feeStart)
			state.units -=
				uint256(state.feeRateAttoEthPerSecond) *
				(_fundedSeconds(book, end) - _fundedSeconds(book, state.feeStart));
		state.feeStart = nativeTimestamp;
		return state;
	}

	function _feeIntegral(Book storage book, uint48 timestamp) private view returns (uint256) {
		uint256 remainingRate = tree.total(book.feeRateRoot) - tree.prefixTotal(book.feeRateRoot, timestamp);
		return remainingRate * timestamp + tree.prefixTotal(book.feeEndRoot, timestamp);
	}

	function _changeFeeRate(Book storage book, uint48 end, uint96 rate, bool increase) private {
		if (rate == 0) return;
		uint256 previous = tree.get(book.feeRateRoot, end);
		uint256 next = increase ? previous + rate : previous - rate;
		book.feeRateRoot = tree.set(book.feeRateRoot, end, next, next);
		require(tree.total(book.feeRateRoot) <= type(uint208).max, 'Aggregate fee rate overflow');
		book.feeEndRoot = tree.set(book.feeEndRoot, end, next, next * end);
	}

	function _fundedSeconds(Book storage book, uint48 timestamp) private view returns (uint256) {
		uint64 modeId = uint64(tree.floor(book.feeModeRoot, timestamp));
		require(modeId != 0, 'Fee clock predates settlement');
		FeeMode storage mode = feeModes[modeId];
		return mode.fundedSeconds + (mode.funded ? timestamp - mode.timestamp : 0);
	}

	function _syncFeeMode(Book storage book) private {
		FeeMode storage mode = feeModes[uint64(tree.floor(book.feeModeRoot, _feeTimestamp(book)))];
		bool funded = book.cashAttoEth == book.units && book.feesEnabled;
		if (mode.funded != funded) _setFeeMode(book, funded);
	}

	function _setFeeMode(Book storage book, bool funded) private {
		uint48 nativeTimestamp = _feeTimestamp(book);
		uint256 elapsed = book.feeModeRoot == 0 ? 0 : _fundedSeconds(book, nativeTimestamp);
		uint64 modeId = ++lastFeeModeId;
		feeModes[modeId] = FeeMode(elapsed, nativeTimestamp, funded);
		book.feeModeRoot = tree.set(book.feeModeRoot, nativeTimestamp, modeId, 0);
	}

	function _feeTimestamp(Book storage book) private view returns (uint48) {
		return book.timestamp + book.feeTimeOffset;
	}

	function _changeFinalityUnits(Book storage book, uint48 finalAfter, uint256 units, bool increase) private {
		if (finalAfter == 0 || units == 0) return;
		uint256 previous = tree.get(book.finalityRoot, finalAfter);
		uint256 next = increase ? previous + units : previous - units;
		book.finalityRoot = tree.set(book.finalityRoot, finalAfter, next, next);
	}

	function _writeQuestion(Book storage book, uint256 questionId, Question memory state) private {
		uint64 stateId = ++lastQuestionStateId;
		questionStates[stateId] = state;
		book.questionRoot = tree.set(book.questionRoot, questionId, stateId, 0);
	}

	function _cashForUnits(uint256 cashAttoEth, uint256 units, uint256 redeemedUnits) private pure returns (uint256) {
		if (redeemedUnits == 0) return 0;
		return redeemedUnits == units ? cashAttoEth : Math.mulDiv(cashAttoEth, redeemedUnits, units);
	}

	function _book(uint64 bookId) private view returns (Book storage book) {
		require(bookId != 0 && bookId <= lastBookId, 'Unknown settlement book');
		return books[bookId];
	}

	function _activeBook(uint64 bookId) private view returns (Book storage book) {
		book = _book(bookId);
		require(!book.isSealed, 'Settlement book sealed');
	}
}
