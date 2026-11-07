// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { SecurityPoolFrozenHistory } from './SecurityPoolFrozenHistory.sol';

/// @notice Central ETH settlement accounting with distinct internal units and outcome supply.
/// @dev This contract records liabilities; its authority holds and transfers the actual ETH.
/// Every reported funding delta must be atomically backed by that custody. The authority also
/// authenticates complete-set or winning-outcome burns and supplies irreversible finality.
/// Finality uses a logical clock paused during forks; fee deadlines retain native calendar time.
/// A fork copies immutable roots, including ALL inherited outcome liabilities, in constant work.
contract SecurityPoolSettlementBook {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;
	using SecurityPoolFrozenHistory for SecurityPoolFrozenHistory.Store;

	uint256 public constant EXCHANGE_RATE_SCALE = 1e18;
	uint256 private constant RECOVERY_SCALE = 1 << 128;
	uint48 public constant MINIMUM_FORK_RESPONSE = 3 days;
	address public immutable portfolio;
	uint256 public immutable minimumOutcomeExchangeRate;
	uint64 public lastBookId;
	uint64 public lastFrozenBookId;
	uint64 private lastQuestionStateId;
	uint64 private lastFeeModeId;
	SecurityPoolPersistentMap.Store private tree;
	SecurityPoolFrozenHistory.Store private frozenHistory;

	bool private constant INCREASE_BALANCE = true;
	bool private constant DECREASE_BALANCE = false;
	// cashAttoEth is a liability backed by settlement custody; units allocate that cash.
	// securityPoolSettlementBook.test.ts covers unit conservation, fork copies and both clocks.
	// Only a fully backed, REP-free book accrues fees. Finality uses logical time.
	struct Book {
		uint256 cashAttoEth;
		uint256 units;
		uint256 feeCashAttoEth;
		uint64 questionRoot;
		uint64 finalityRoot;
		uint64 frozenRoot;
		uint48 logicalTimestamp;
		bool isSealed;
		uint64 feeRateRoot;
		uint64 feeEndRoot;
		uint64 feeModeRoot;
		bool feesEnabled;
		uint48 minimumFinalAfter;
		uint48 feeTimeOffset;
		uint256 finalizedUnitsPrefix;
		uint256 recoveryAttoRep;
	}

	// units are cash-allocation weights, not outcome shares; feeStart/feeEnd are native time.
	// finalAfter is logical time and remains independent of the native fee deadline.
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
		uint256 recoveryAttoRep;
	}

	/// @dev Modular corrections keep a question's REP entitlement independent of
	/// rounded ETH units. Units and REP custody are each below 2^128, so the true
	/// scaled entitlement fits uint256 even when the cumulative index wraps.
	struct RecoveryState {
		uint256 index;
		uint64 finalityRoot;
		uint256 finalizedPrefix;
	}

	struct FeeMode {
		uint256 fundedSeconds;
		uint48 nativeTimestamp;
		bool funded;
	}

	mapping(uint64 => Book) public books;
	mapping(uint64 => FrozenBook) public frozenBooks;
	struct StoredQuestionState {
		Question question;
		uint256 recoveryCorrection;
		uint256 recoveryIndex;
	}
	mapping(uint64 => StoredQuestionState) private questionStates;
	mapping(uint64 => FeeMode) private feeModes;
	mapping(uint64 => RecoveryState) private recoveryStates;

	event BookCreated(uint64 indexed bookId, uint64 indexed sourceBookId, uint256 cashAttoEth, uint256 units);
	event SettlementMinted(uint64 indexed bookId, uint256 indexed questionId, uint256 cashAttoEth, uint256 outcomeShares);
	event SettlementRedeemed(uint64 indexed bookId, uint256 indexed questionId, uint256 outcomeShares, uint256 units, uint256 cashAttoEth);
	event FinalityScheduled(uint64 indexed bookId, uint256 indexed questionId, uint48 finalAfter);
	event FinalClaimsFrozen(uint64 indexed bookId, uint64 indexed frozenBookId, uint48 logicalTimestamp, uint256 units, uint256 cashAttoEth);
	event FeeStreamReplaced(uint64 indexed bookId, uint256 indexed questionId, uint96 rateAttoEthPerSecond, uint48 end);
	event AggregateFeesAccrued(uint64 indexed bookId, uint48 logicalTimestamp, uint256 cashAttoEth);

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

	function createBook(uint48 logicalTimestamp) external onlyPortfolio returns (uint64 bookId) {
		require(logicalTimestamp <= block.timestamp, 'Future settlement clock');
		bookId = ++lastBookId;
		books[bookId].logicalTimestamp = logicalTimestamp;
		books[bookId].feesEnabled = true;
		_setFeeMode(books[bookId], true);
		emit BookCreated(bookId, 0, 0, 0);
	}

	/// @notice Seal a source at fork time after protecting claims already final strictly before it.
	/// @dev Sealed sources allow frozen claims and fee collection, but no active-unit redemptions.
	function sealForFork(uint64 bookId, uint48 logicalTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, logicalTimestamp);
		book.isSealed = true;
	}

	/// @notice Create a child with independently supplied ETH and every source outcome liability.
	/// @dev Source fee escrow and finalized claims remain source obligations and are not duplicated.
	function createChildBook(uint64 sourceBookId, uint256 fundedCashAttoEth, uint256 recoveryAttoRep) external onlyPortfolio returns (uint64 bookId) {
		Book storage source = _book(sourceBookId);
		require(source.isSealed, 'Settlement source not sealed');
		require(fundedCashAttoEth <= source.units, 'Child cash exceeds liabilities');
		require(recoveryAttoRep == 0 || source.units != 0, 'Recovery REP has no claimants');
		require(recoveryAttoRep >= source.recoveryAttoRep && recoveryAttoRep < RECOVERY_SCALE, 'Invalid child recovery REP');
		bookId = ++lastBookId;
		Book storage child = books[bookId];
		child.cashAttoEth = fundedCashAttoEth;
		child.recoveryAttoRep = recoveryAttoRep;
		child.units = source.units;
		child.questionRoot = source.questionRoot;
		child.finalityRoot = source.finalityRoot;
		child.frozenRoot = source.frozenRoot;
		child.logicalTimestamp = source.logicalTimestamp;
		child.feeRateRoot = source.feeRateRoot;
		child.feeEndRoot = source.feeEndRoot;
		child.feeModeRoot = source.feeModeRoot;
		child.feesEnabled = source.feesEnabled;
		child.minimumFinalAfter = source.logicalTimestamp + MINIMUM_FORK_RESPONSE;
		child.feeTimeOffset = source.feeTimeOffset;
		child.finalizedUnitsPrefix = source.finalizedUnitsPrefix;
		recoveryStates[bookId] = recoveryStates[sourceBookId];
		// Only newly surrendered backing changes the index. Inherited claim REP
		// retains its old question ownership, including previous partial burns.
		if (recoveryAttoRep > source.recoveryAttoRep) {
			uint256 increment = Math.mulDiv(recoveryAttoRep - source.recoveryAttoRep, RECOVERY_SCALE, source.units);
			unchecked {
				recoveryStates[bookId].index += increment;
			}
		}
		_setFeeMode(child, fundedCashAttoEth == source.units && recoveryAttoRep == 0 && source.feesEnabled);
		emit BookCreated(bookId, sourceBookId, fundedCashAttoEth, source.units);
	}

	/// @notice Return economic outcome supply, including inherited shares not materialized locally.
	function question(uint64 bookId, uint256 questionId) public view returns (Question memory state, uint64 frozenBookId) {
		Book storage book = _book(bookId);
		state = questionStates[uint64(tree.get(book.questionRoot, questionId))].question;
		state = _materializeFees(book, state);
		if (state.finalAfter != 0) frozenBookId = uint64(frozenHistory.ceiling(book.frozenRoot, state.finalAfter));
	}

	/// @notice Whether sealing at the fork clock preserves this question as a live source liability.
	function hasLiveForkRecoveryRight(uint64 bookId, uint256 questionId, uint48 forkTimestamp) external view returns (bool) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		// A zero-unit final question has no funded FrozenBook. Its immutable
		// source cutoff still closes recovery rights to separate premium cash.
		uint48 cutoff = book.isSealed ? book.logicalTimestamp : forkTimestamp;
		return
			frozenBookId == 0 &&
			state.outcomeSupplyAttoShares != 0 &&
			(cutoff <= book.minimumFinalAfter || state.finalAfter == 0 || state.finalAfter >= cutoff);
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
		book.feeTimeOffset = nativeTimestamp - book.logicalTimestamp;
		_setFeeMode(book, false);
	}

	function totals(uint64 bookId)
		external
		view
		returns (uint256 cashAttoEth, uint256 units, uint256 feeCashAttoEth, uint48 logicalTimestamp, bool isSealed)
	{
		Book storage book = _book(bookId);
		return (book.cashAttoEth, book.units, book.feeCashAttoEth, book.logicalTimestamp, book.isSealed);
	}

	function quoteMint(uint64 bookId, uint256 questionId, uint256 cashAttoEth) external view returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		require(book.cashAttoEth == book.units && book.recoveryAttoRep == 0, 'Settlement in runoff');
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0 && state.finalAfter == 0, 'Settlement mint closed');
		if (state.outcomeSupplyAttoShares == 0) return cashAttoEth;
		require(state.units > 0 && Math.mulDiv(state.units, EXCHANGE_RATE_SCALE, state.outcomeSupplyAttoShares) >= minimumOutcomeExchangeRate, 'Outcome exchange below minimum');
		return Math.mulDiv(cashAttoEth, state.outcomeSupplyAttoShares, state.units);
	}

	function mint(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 minimumShares, uint48 logicalTimestamp) public onlyPortfolio returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, logicalTimestamp);
		require(book.cashAttoEth == book.units && book.recoveryAttoRep == 0, 'Settlement in runoff');
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
		require(book.units < RECOVERY_SCALE, 'Settlement units exceed precision bound');
		_writeQuestion(bookId, book, questionId, state);
		emit SettlementMinted(bookId, questionId, cashAttoEth, outcomeShares);
	}

	/// @notice Burn authenticated complete sets or winning outcomes and return their funded cash.
	function redeem(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint256 minimumCashAttoEth, uint48 logicalTimestamp) public onlyPortfolio returns (uint256 cashAttoEth, uint256 unitsBurned, uint256 recoveryAttoRep) {
		Book storage book = _book(bookId);
		if (!book.isSealed) _freezeMatured(bookId, book, logicalTimestamp);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(outcomeShares > 0 && outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		uint256 scaledRecovery = _scaledRecovery(bookId, book, questionId, state);
		recoveryAttoRep = _quoteRecovery(book, state, frozenBookId, outcomeShares, scaledRecovery);
		unitsBurned =
			outcomeShares == state.outcomeSupplyAttoShares
				? state.units
				: Math.mulDiv(state.units, outcomeShares, state.outcomeSupplyAttoShares);
		if (frozenBookId == 0) {
			require(!book.isSealed, 'Use child settlement book');
			cashAttoEth = _cashForUnits(book.cashAttoEth, book.units, unitsBurned);
			book.cashAttoEth -= cashAttoEth;
			book.recoveryAttoRep -= recoveryAttoRep;
			book.units -= unitsBurned;
			_changeFinalityUnits(book, state.finalAfter, unitsBurned, DECREASE_BALANCE);
		} else {
			FrozenBook storage frozen = frozenBooks[frozenBookId];
			require(frozen.sourceBookId == bookId, 'Use source final claim');
			cashAttoEth = _cashForUnits(frozen.cashAttoEth, frozen.units, unitsBurned);
			frozen.cashAttoEth -= cashAttoEth;
			frozen.recoveryAttoRep -= recoveryAttoRep;
			frozen.units -= unitsBurned;
		}
		require(cashAttoEth >= minimumCashAttoEth, 'Insufficient settlement cash');
		state.units -= unitsBurned;
		state.feePrincipalAttoEth = Math.mulDiv(state.feePrincipalAttoEth, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares);
		if (state.feeRateAttoEthPerSecond != 0) {
			_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond, DECREASE_BALANCE);
			state.feeRateAttoEthPerSecond = uint96(Math.mulDiv(state.feeRateAttoEthPerSecond, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares));
			_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond, INCREASE_BALANCE);
		}
		state.outcomeSupplyAttoShares -= outcomeShares;
		uint256 correction;
		if (state.outcomeSupplyAttoShares != 0) {
			unchecked {
				correction =
					scaledRecovery -
					recoveryAttoRep * RECOVERY_SCALE -
					state.units * recoveryStates[bookId].index;
			}
		}
		_writeQuestionWithRecovery(bookId, book, questionId, state, correction);
		_syncFeeMode(book);
		emit SettlementRedeemed(bookId, questionId, outcomeShares, unitsBurned, cashAttoEth);
	}

	/// @notice Replace one prospective collateral fee stream after checkpointing every old stream.
	/// @dev Clamp the end to the fee budget above the backing floor. Runoff pauses accrual globally;
	/// pausing never extends the absolute end, so skipped intervals cannot be charged after recap.
	function replaceFeeStream(uint64 bookId, uint256 questionId, uint96 rateAttoEthPerSecond, uint48 end, uint48 logicalTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, logicalTimestamp);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0, 'Final claim fees closed');
		uint48 feeClockTimestamp = _feeTimestamp(book);
		require(rateAttoEthPerSecond == 0 || (state.finalAfter == 0 && end > feeClockTimestamp), 'Invalid question fee interval');
		if (rateAttoEthPerSecond != 0) {
			uint256 duration = Math.min(end - feeClockTimestamp, _feeBudget(state) / rateAttoEthPerSecond);
			if (duration == 0) rateAttoEthPerSecond = 0;
			else end = feeClockTimestamp + uint48(duration);
		}
		_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond, DECREASE_BALANCE);
		state.feeRateAttoEthPerSecond = rateAttoEthPerSecond;
		state.feeStart = feeClockTimestamp;
		state.feeEnd = rateAttoEthPerSecond == 0 ? 0 : end;
		_changeFeeRate(book, state.feeEnd, rateAttoEthPerSecond, INCREASE_BALANCE);
		_writeQuestion(bookId, book, questionId, state);
		emit FeeStreamReplaced(bookId, questionId, rateAttoEthPerSecond, state.feeEnd);
	}

	function collectFees(uint64 bookId, uint256 cashAttoEth) external onlyPortfolio {
		Book storage book = _book(bookId);
		require(cashAttoEth <= book.feeCashAttoEth, 'Fee escrow insufficient');
		book.feeCashAttoEth -= cashAttoEth;
	}

	/// @notice Stop at the last valid price logicalTimestamp before advancing through a stale-price period.
	function setFeeAccrualEnabled(uint64 bookId, bool enabled, uint48 logicalTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, logicalTimestamp);
		require(!enabled || _feeTimestamp(book) <= block.timestamp, 'Fee activation is in the future');
		book.feesEnabled = enabled;
		_syncFeeMode(book);
	}

	/// @notice Schedule a bound outcome's irreversible deadline; ordinary question end is insufficient.
	/// @dev The authority must replace/cancel this schedule atomically whenever reporting changes it.
	function scheduleFinality(uint64 bookId, uint256 questionId, uint48 finalAfter, uint48 logicalTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, logicalTimestamp);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		require(frozenBookId == 0, 'Final claim immutable');
		require(finalAfter == 0 || finalAfter >= logicalTimestamp, 'Finality already elapsed');
		require(finalAfter == 0 || state.feeRateAttoEthPerSecond == 0 || state.feeEnd <= _feeTimestamp(book), 'Stop fees before finality');
		_changeFinalityUnits(book, state.finalAfter, state.units, DECREASE_BALANCE);
		state.finalAfter = finalAfter;
		_changeFinalityUnits(book, state.finalAfter, state.units, INCREASE_BALANCE);
		_writeQuestion(bookId, book, questionId, state);
		emit FinalityScheduled(bookId, questionId, state.finalAfter);
	}

	function freezeMatured(uint64 bookId, uint48 logicalTimestamp) external onlyPortfolio returns (uint64 frozenBookId) {
		Book storage book = _activeBook(bookId);
		return _freezeMatured(bookId, book, logicalTimestamp);
	}

	function quoteRedemption(uint64 bookId, uint256 questionId, uint256 outcomeShares) public view returns (uint256 cashAttoEth, uint256 unitsBurned) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		// Losing outcome tokens may remain after every payable claim is burned.
		if (state.outcomeSupplyAttoShares == 0) return (0, 0);
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

	/// @notice Quote REP directly from outcome-share ownership, before rounding ETH units.
	function quoteRecoveryRep(uint64 bookId, uint256 questionId, uint256 outcomeShares) external view returns (uint256) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = question(bookId, questionId);
		if (state.outcomeSupplyAttoShares == 0) return 0;
		require(outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		if (outcomeShares == 0 || (frozenBookId != 0 && frozenBooks[frozenBookId].sourceBookId != bookId)) return 0;
		return
			_quoteRecovery(book, state, frozenBookId, outcomeShares, _scaledRecovery(bookId, book, questionId, state));
	}

	function _quoteRecovery(Book storage book, Question memory state, uint64 frozenBookId, uint256 shares, uint256 scaledRecovery) private view returns (uint256) {
		uint256 units = frozenBookId == 0 ? book.units : frozenBooks[frozenBookId].units;
		uint256 recovery = frozenBookId == 0 ? book.recoveryAttoRep : frozenBooks[frozenBookId].recoveryAttoRep;
		// At most attoREP rounding dust is accumulated per allocation/payment.
		// The final claim receives that dust, never another question's entitlement.
		if (shares == state.outcomeSupplyAttoShares && state.units == units) return recovery;
		return Math.mulDiv(scaledRecovery, shares, state.outcomeSupplyAttoShares) / RECOVERY_SCALE;
	}

	function _scaledRecovery(uint64 bookId, Book storage book, uint256 questionId, Question memory state) private view returns (uint256 scaledRecoveryEntitlement) {
		uint64 stateId = uint64(tree.get(book.questionRoot, questionId));
		StoredQuestionState storage snapshot = questionStates[stateId];
		unchecked {
			// Allocate current units at the branch's index, then carry the snapshot's
			// correction and fees that remained lazy at the snapshot's older index.
			// These are residues modulo 2^256; wrapping is intentional.
			uint256 currentUnitsEntitlement = state.units * recoveryStates[bookId].index;
			uint256 lazyFeeEntitlement = (snapshot.question.units - state.units) * snapshot.recoveryIndex;
			scaledRecoveryEntitlement = currentUnitsEntitlement + snapshot.recoveryCorrection + lazyFeeEntitlement;
		}
	}

	function recoveryRep(uint64 bookId) external view returns (uint256) {
		return _book(bookId).recoveryAttoRep;
	}

	function _freezeMatured(uint64 bookId, Book storage book, uint48 logicalTimestamp) private returns (uint64 frozenBookId) {
		require(logicalTimestamp >= book.logicalTimestamp && logicalTimestamp <= block.timestamp, 'Invalid settlement clock');
		uint48 previousFeeTime = _feeTimestamp(book);
		uint48 nextFeeTime = logicalTimestamp + book.feeTimeOffset;
		if (feeModes[uint64(tree.floor(book.feeModeRoot, previousFeeTime))].funded && nextFeeTime > previousFeeTime) {
			uint256 fees = _feeIntegral(book, nextFeeTime) - _feeIntegral(book, previousFeeTime);
			book.cashAttoEth -= fees;
			book.units -= fees;
			book.feeCashAttoEth += fees;
			if (fees != 0) emit AggregateFeesAccrued(bookId, logicalTimestamp, fees);
		}
		book.logicalTimestamp = logicalTimestamp;
		if (logicalTimestamp <= book.minimumFinalAfter) return 0;
		uint256 prefix = tree.prefixTotalModular(book.finalityRoot, logicalTimestamp - 1);
		uint256 units;
		// Only pending deadlines can change. All newly matured scheduled units
		// fit the live book, so a modular prefix difference is their exact amount.
		unchecked {
			units = prefix - book.finalizedUnitsPrefix;
		}
		book.finalizedUnitsPrefix = prefix;
		if (units == 0) return 0;
		uint256 cashAttoEth = _cashForUnits(book.cashAttoEth, book.units, units);
		RecoveryState storage recovery = recoveryStates[bookId];
		uint256 correctionPrefix = tree.prefixTotalModular(recovery.finalityRoot, logicalTimestamp - 1);
		uint256 scaledRecovery;
		unchecked {
			scaledRecovery = units * recovery.index + correctionPrefix - recovery.finalizedPrefix;
		}
		recovery.finalizedPrefix = correctionPrefix;
		uint256 recoveryAttoRep = units == book.units ? book.recoveryAttoRep : scaledRecovery / RECOVERY_SCALE;
		book.cashAttoEth -= cashAttoEth;
		book.recoveryAttoRep -= recoveryAttoRep;
		book.units -= units;
		frozenBookId = ++lastFrozenBookId;
		frozenBooks[frozenBookId] = FrozenBook(cashAttoEth, units, bookId, recoveryAttoRep);
		book.frozenRoot = frozenHistory.append(book.frozenRoot, logicalTimestamp - 1, frozenBookId);
		_syncFeeMode(book);
		emit FinalClaimsFrozen(bookId, frozenBookId, logicalTimestamp, units, cashAttoEth);
	}

	/// @notice Remaining collateral that may fund fees, excluding the rounded-up backing floor.
	function availableFeeBudget(uint64 bookId, uint256 questionId) external view returns (uint256) {
		(Question memory state, ) = question(bookId, questionId);
		return _feeBudget(state);
	}

	function _feeBudget(Question memory state) private view returns (uint256) {
		uint256 reserved = Math.mulDiv(state.outcomeSupplyAttoShares, minimumOutcomeExchangeRate, EXCHANGE_RATE_SCALE, Math.Rounding.Ceil);
		return state.units > reserved ? state.units - reserved : 0;
	}

	function _materializeFees(Book storage book, Question memory state) private view returns (Question memory) {
		if (state.feeRateAttoEthPerSecond == 0) return state;
		uint48 feeClockTimestamp = _feeTimestamp(book);
		uint48 end = feeClockTimestamp < state.feeEnd ? feeClockTimestamp : state.feeEnd;
		if (end > state.feeStart)
			state.units -=
				uint256(state.feeRateAttoEthPerSecond) *
				(_fundedSeconds(book, end) - _fundedSeconds(book, state.feeStart));
		state.feeStart = feeClockTimestamp;
		return state;
	}

	function _feeIntegral(Book storage book, uint48 nativeTimestamp) private view returns (uint256) {
		uint256 remainingRate = tree.total(book.feeRateRoot) - tree.prefixTotal(book.feeRateRoot, nativeTimestamp);
		return remainingRate * nativeTimestamp + tree.prefixTotal(book.feeEndRoot, nativeTimestamp);
	}

	function _changeFeeRate(Book storage book, uint48 end, uint96 rate, bool increase) private {
		if (rate == 0) return;
		uint256 previous = tree.get(book.feeRateRoot, end);
		uint256 next = increase ? previous + rate : previous - rate;
		book.feeRateRoot = tree.set(book.feeRateRoot, end, next, next);
		require(tree.total(book.feeRateRoot) <= type(uint208).max, 'Aggregate fee rate overflow');
		book.feeEndRoot = tree.set(book.feeEndRoot, end, next, next * end);
	}

	function _fundedSeconds(Book storage book, uint48 nativeTimestamp) private view returns (uint256) {
		uint64 modeId = uint64(tree.floor(book.feeModeRoot, nativeTimestamp));
		require(modeId != 0, 'Fee clock predates settlement');
		FeeMode storage mode = feeModes[modeId];
		return mode.fundedSeconds + (mode.funded ? nativeTimestamp - mode.nativeTimestamp : 0);
	}

	function _syncFeeMode(Book storage book) private {
		FeeMode storage mode = feeModes[uint64(tree.floor(book.feeModeRoot, _feeTimestamp(book)))];
		bool funded = book.cashAttoEth == book.units && book.recoveryAttoRep == 0 && book.feesEnabled;
		if (mode.funded != funded) _setFeeMode(book, funded);
	}

	function _setFeeMode(Book storage book, bool funded) private {
		uint48 feeClockTimestamp = _feeTimestamp(book);
		uint256 elapsed = book.feeModeRoot == 0 ? 0 : _fundedSeconds(book, feeClockTimestamp);
		uint64 modeId = ++lastFeeModeId;
		feeModes[modeId] = FeeMode(elapsed, feeClockTimestamp, funded);
		book.feeModeRoot = tree.set(book.feeModeRoot, feeClockTimestamp, modeId, 0);
	}

	function _feeTimestamp(Book storage book) private view returns (uint48) {
		return book.logicalTimestamp + book.feeTimeOffset;
	}

	function _changeFinalityUnits(Book storage book, uint48 finalAfter, uint256 units, bool increase) private {
		if (finalAfter == 0 || units == 0) return;
		uint256 previous = tree.get(book.finalityRoot, finalAfter);
		uint256 next = increase ? previous + units : previous - units;
		book.finalityRoot = tree.setModular(book.finalityRoot, finalAfter, next, next);
	}

	function _writeQuestion(uint64 bookId, Book storage book, uint256 questionId, Question memory state) private {
		(Question memory previous, ) = question(bookId, questionId);
		uint256 correction;
		unchecked {
			correction =
				_scaledRecovery(bookId, book, questionId, previous) - state.units * recoveryStates[bookId].index;
		}
		_writeQuestionWithRecovery(bookId, book, questionId, state, correction);
	}

	function _writeQuestionWithRecovery(uint64 bookId, Book storage book, uint256 questionId, Question memory state, uint256 correction) private {
		uint64 previousId = uint64(tree.get(book.questionRoot, questionId));
		Question storage previous = questionStates[previousId].question;
		uint64 frozen =
			previous.finalAfter == 0 ? 0 : uint64(frozenHistory.ceiling(book.frozenRoot, previous.finalAfter));
		if (frozen == 0) {
			if (previous.finalAfter == state.finalAfter) {
				uint256 change;
				unchecked {
					change = correction - questionStates[previousId].recoveryCorrection;
				}
				_changeFinalityCorrection(bookId, state.finalAfter, change, INCREASE_BALANCE);
			} else {
				_changeFinalityCorrection(bookId, previous.finalAfter, questionStates[previousId].recoveryCorrection, DECREASE_BALANCE);
				_changeFinalityCorrection(bookId, state.finalAfter, correction, INCREASE_BALANCE);
			}
		}
		uint64 stateId = ++lastQuestionStateId;
		questionStates[stateId] = StoredQuestionState(state, correction, recoveryStates[bookId].index);
		book.questionRoot = tree.set(book.questionRoot, questionId, stateId, 0);
	}

	function _changeFinalityCorrection(uint64 bookId, uint48 finalAfter, uint256 correction, bool increase) private {
		if (finalAfter == 0 || correction == 0) return;
		RecoveryState storage recovery = recoveryStates[bookId];
		uint256 previous = tree.get(recovery.finalityRoot, finalAfter);
		uint256 next;
		unchecked {
			next = increase ? previous + correction : previous - correction;
		}
		recovery.finalityRoot = tree.setModular(recovery.finalityRoot, finalAfter, next, next);
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
