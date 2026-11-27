// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolSettlementPricing } from './SecurityPoolSettlementPricing.sol';
import { SecurityPoolSettlementMath as SettlementMath } from './SecurityPoolSettlementMath.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolQuestionMap } from './SecurityPoolQuestionMap.sol';
import { SecurityPoolSettlementWriter } from './SecurityPoolSettlementState.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { SecurityPoolMaturityMap } from './SecurityPoolMaturityMap.sol';
import { DelegateCall } from './DelegateCall.sol';
import { SecurityPoolFrozenHistory } from './SecurityPoolFrozenHistory.sol';

/// @notice Central collateral settlement accounting with distinct internal units and outcome supply.
/// @dev This contract records liabilities; its authority holds and transfers the configured ERC-20 collateral.
/// Every reported funding delta must be atomically backed by that custody. The authority also
/// authenticates complete-set or winning-outcome burns and supplies irreversible finality.
/// Finality uses a security pool clock paused during forks; fee deadlines retain native calendar time.
/// A fork copies immutable roots, including ALL inherited outcome liabilities, in constant work.
contract SecurityPoolSettlementBook is SecurityPoolSettlementPricing {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;
	using SecurityPoolMaturityMap for SecurityPoolMaturityMap.Store;
	using SecurityPoolQuestionMap for SecurityPoolQuestionMap.Store;
	using SecurityPoolFrozenHistory for SecurityPoolFrozenHistory.Store;

	/// @notice Exclusive bound of every fee-stream end (about year 2242). Streams stop charging after it.
	uint48 public constant FEE_END_LIMIT = uint48(1) << 33;
	address public immutable securityPool;
	SecurityPoolSettlementWriter private immutable writer;
	/// @notice Fee-stream ends round down to a multiple of this bucket duration in seconds.
	/// @dev The largest bucket number is (FEE_END_LIMIT - 1) / feeEndGranularity.
	/// The production daily cadence has at most 17 branch levels.
	uint48 public immutable feeEndGranularity;

	event SettlementBookRepaired(uint64 indexed bookId, uint256 cashAttoEth);
	event BookCreated(uint64 indexed bookId, uint64 indexed sourceBookId, uint256 cashAttoEth, uint256 units);
	event SettlementMinted(uint64 indexed bookId, uint256 indexed questionId, uint256 cashAttoEth, uint256 outcomeShares);
	event SettlementRedeemed(uint64 indexed bookId, uint256 indexed questionId, uint256 outcomeShares, uint256 units, uint256 cashAttoEth);
	event FinalityScheduled(uint64 indexed bookId, uint256 indexed questionId, uint48 finalAfter);
	event FinalClaimsFrozen(uint64 indexed bookId, uint64 indexed frozenBookId, uint48 securityPoolTimestamp, uint256 units, uint256 cashAttoEth);
	event FeeStreamReplaced(uint64 indexed bookId, uint256 indexed questionId, uint96 rateAttoEthPerSecond, uint48 end);
	event AggregateFeesAccrued(uint64 indexed bookId, uint48 securityPoolTimestamp, uint256 cashAttoEth);

	constructor(address authority, uint256 minimumExchangeRate, uint48 endGranularity) SecurityPoolSettlementPricing(minimumExchangeRate) {
		require(authority != address(0), 'Invalid settlement authority');
		require(endGranularity != 0 && endGranularity <= FEE_END_LIMIT >> 1, 'Invalid fee end granularity');
		securityPool = authority;
		writer = new SecurityPoolSettlementWriter();
		feeEndGranularity = endGranularity;
	}

	modifier onlySecurityPool() {
		_requireSecurityPool();
		_;
	}

	function _requireSecurityPool() private view {
		require(msg.sender == securityPool, 'Only security pool');
	}

	function createBook(uint48 securityPoolTimestamp) external onlySecurityPool returns (uint64 bookId) {
		require(securityPoolTimestamp <= block.timestamp, 'Future settlement clock');
		bookId = ++lastBookId;
		fundingTargets[bookId] = FundingTarget(1, 1);
		books[bookId].securityPoolTimestamp = securityPoolTimestamp;
		books[bookId].feesEnabled = true;
		_setFeeMode(books[bookId], true);
		emit BookCreated(bookId, 0, 0, 0);
	}

	/// @notice Seal a source at fork time after protecting claims already final strictly before it.
	/// @dev Sealed sources allow frozen claims and fee collection, but no active-unit redemptions.
	function sealForFork(uint64 bookId, uint48 securityPoolTimestamp) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, securityPoolTimestamp);
		book.isSealed = true;
	}

	/// @notice Create a child with independently supplied collateral and every source outcome liability.
	/// @dev Source fee escrow and finalized claims remain source obligations and are not duplicated.
	/// Inherit claim weights and snapshot roots from the sealed source book.
	/// The supplied cash and recovery REP set the balances available to the child.
	function createChildBook(uint64 sourceBookId, uint256 fundedCashAttoEth, uint256 recoveryAttoRep) external onlySecurityPool returns (uint64 bookId) {
		Book storage source = _book(sourceBookId);
		require(source.isSealed, 'Settlement source not sealed');
		require(fundedCashAttoEth <= requiredForkCash(sourceBookId), 'Child cash exceeds liabilities');
		require(recoveryAttoRep == 0 || source.units != 0, 'Recovery REP has no claimants');
		require(recoveryAttoRep >= source.recoveryAttoRep && recoveryAttoRep < RECOVERY_SCALE, 'Invalid child recovery REP');
		bookId = ++lastBookId;
		Book storage child = books[bookId];
		fundingTargets[bookId] = _childTarget(sourceBookId, source);
		child.cashAttoEth = fundedCashAttoEth;
		child.recoveryAttoRep = recoveryAttoRep;
		child.units = source.units;
		child.questionRoot = source.questionRoot;
		child.finalityRoot = source.finalityRoot;
		child.frozenRoot = source.frozenRoot;
		child.securityPoolTimestamp = source.securityPoolTimestamp;
		child.feeRateRoot = source.feeRateRoot;
		child.feeModeRoot = source.feeModeRoot;
		child.feesEnabled = source.feesEnabled;
		child.minimumFinalAfter = source.securityPoolTimestamp;
		child.feeTimeOffset = source.feeTimeOffset;
		child.finalizedUnitsPrefix = source.finalizedUnitsPrefix;
		recoveryStates[bookId] = recoveryStates[sourceBookId];
		// Only newly surrendered backing changes the index. Inherited claim REP
		// retains its old question ownership, including previous partial burns.
		// Each question owns the increment on its units at the fork; recording the
		// fork fee time keeps later child fees from shrinking that share.
		if (recoveryAttoRep > source.recoveryAttoRep) {
			uint256 increment = Math.mulDiv(recoveryAttoRep - source.recoveryAttoRep, RECOVERY_SCALE, source.units);
			RecoveryState storage recovery = recoveryStates[bookId];
			uint48 forkTime = _feeTimestamp(source);
			uint256 weight;
			unchecked {
				recovery.index += increment;
				weight = increment * _fundedSeconds(source, forkTime);
			}
			// MaturityMap ignores key zero, so a fork at fee time zero is keyed one later.
			_addPrefix(bookId, false, forkTime + 1, increment, weight);
		}
		_setFeeMode(child, isCashFunded(bookId) && source.feesEnabled);
		emit BookCreated(bookId, sourceBookId, fundedCashAttoEth, _descaled(source.units));
	}

	/// @notice Full-precision claim weights for fork recovery and conservation checks.
	function scaledUnits(uint64 bookId) external view returns (uint256) {
		return _book(bookId).units;
	}

	function scaledQuestion(uint64 bookId, uint256 questionId) public view override returns (Question memory state, uint64 frozenBookId) {
		Book storage book = _book(bookId);
		StoredQuestionState storage stored = questionStates[uint64(questionMap.get(book.questionRoot, questionId))];
		state = _materializeFees(book, stored.question);
		frozenBookId = _frozenBookId(book, stored);
	}

	/// @notice Whether sealing at the fork clock preserves this question as a live source liability.
	function hasLiveForkRecoveryRight(uint64 bookId, uint256 questionId, uint48 forkTimestamp) external view returns (bool) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		// A zero-unit final question has no funded FrozenBook. Its immutable
		// source cutoff still closes recovery rights to separate premium cash.
		uint48 cutoff = book.isSealed ? book.securityPoolTimestamp : forkTimestamp;
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
	/// while fees are disabled. Its security pool finality clock and inherited claims do not advance.
	function setFeeClock(uint64 bookId, uint48 nativeTimestamp) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		require(!book.feesEnabled, 'Pause fees before clock change');
		require(nativeTimestamp >= _feeTimestamp(book), 'Fee clock cannot go backwards');
		book.feeTimeOffset = nativeTimestamp - book.securityPoolTimestamp;
		_setFeeMode(book, false);
	}

	function totals(uint64 bookId)
		external
		view
		returns (
			uint256 cashAttoEth,
			uint256 units,
			uint256 feeCashAttoEth,
			uint48 securityPoolTimestamp,
			bool isSealed
		)
	{
		Book storage book = _book(bookId);
		return (
			book.cashAttoEth,
			_descaled(book.units),
			book.feeCashAttoEth,
			book.securityPoolTimestamp,
			book.isSealed
		);
	}

	/// @notice Donate the active cash deficit while preserving all recovery REP.
	function topUp(uint64 bookId, uint256 cashAttoEth) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		require(cashAttoEth != 0 && cashAttoEth == _missingCash(bookId, book), 'Settlement deficit must be exact');
		book.cashAttoEth += cashAttoEth;
		_syncFeeMode(bookId, book);
		emit SettlementBookRepaired(bookId, cashAttoEth);
	}

	function mintWithRecoveryRep(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 recoveryAttoRep, uint48 securityPoolTimestamp) external onlySecurityPool returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, securityPoolTimestamp);
		require(cashAttoEth > 0, 'Zero settlement funding');
		outcomeShares = quoteMint(bookId, questionId, cashAttoEth);
		(Question memory state, ) = scaledQuestion(bookId, questionId);
		require(outcomeShares > 0, 'Insufficient outcome shares');
		require(recoveryAttoRep == _mintRecoveryRep(bookId, book, questionId, state, outcomeShares), 'Recovery REP funding mismatch');
		uint256 entitlement = _mintEntitlement(bookId, book, questionId, state);
		// The quote keeps the funded custody below the REP precision bound.
		book.recoveryAttoRep += recoveryAttoRep;
		uint256 addedUnits = _mintUnits(bookId, book, cashAttoEth);
		state.feePrincipalAttoEth += SettlementMath.principal(state.feePrincipalAttoEth, state.outcomeSupplyAttoShares, outcomeShares, addedUnits);
		require(state.feePrincipalAttoEth < RECOVERY_SCALE, 'Principal above precision bound');
		state.units += addedUnits;
		state.outcomeSupplyAttoShares += outcomeShares;
		book.cashAttoEth += cashAttoEth;
		book.units += addedUnits;
		SettlementMath.netCash(book.cashAttoEth, feeRemainders[bookId]);
		require(book.units < RECOVERY_SCALE, 'Units exceed precision bound');
		uint256 correction;
		unchecked {
			correction = entitlement + recoveryAttoRep * RECOVERY_SCALE - state.units * recoveryStates[bookId].index;
		}
		_writeQuestionWithRecovery(bookId, questionId, state, correction, 0);
		emit SettlementMinted(bookId, questionId, cashAttoEth, outcomeShares);
	}

	/// @notice Burn authenticated complete sets or winning outcomes and return their funded cash.
	function redeem(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint48 securityPoolTimestamp) public onlySecurityPool returns (uint256 cashAttoEth, uint256 unitsBurned, uint256 recoveryAttoRep) {
		Book storage book = _book(bookId);
		if (!book.isSealed) _accrueFees(bookId, book, securityPoolTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		if (!book.isSealed && frozenBookId == 0) frozenBookId = _finalizeQuestion(bookId, book, questionId, state);
		require(outcomeShares > 0 && outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		uint256 scaledRecovery = _scaledRecovery(bookId, book, questionId, state);
		recoveryAttoRep = _quoteRecovery(book, state, frozenBookId, outcomeShares, scaledRecovery);
		unitsBurned = SettlementMath.unitsForRedeemedShares(state.units, state.outcomeSupplyAttoShares, outcomeShares);
		// Charge cash, recovery REP, and units to the book that backs the claim.
		// Finalized claims draw from the frozen book owned by this source book.
		if (frozenBookId == 0) {
			require(!book.isSealed, 'Use child settlement book');
			cashAttoEth = SettlementMath.cashForUnits(book.cashAttoEth, book.units, feeRemainders[bookId], unitsBurned);
			book.cashAttoEth -= cashAttoEth;
			book.recoveryAttoRep -= recoveryAttoRep;
			book.units -= unitsBurned;
			_clearEmptyBook(bookId, book);
		} else {
			FrozenBook storage frozen = frozenBooks[frozenBookId];
			require(frozen.sourceBookId == bookId, 'Use source final claim');
			cashAttoEth = SettlementMath.cashForUnits(frozen.cashAttoEth, frozen.units, 0, unitsBurned);
			frozen.cashAttoEth -= cashAttoEth;
			frozen.recoveryAttoRep -= recoveryAttoRep;
			frozen.units -= unitsBurned;
		}
		state.units -= unitsBurned;
		state.feePrincipalAttoEth = Math.mulDiv(state.feePrincipalAttoEth, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares);
		if (state.feeRateAttoEthPerSecond != 0) {
			uint256 remainingRate = Math.mulDiv(state.feeRateAttoEthPerSecond, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares);
			// One net write: the stream keeps its end, so its key is changed once instead of removed and re-added.
			_changeFeeRate(bookId, state.feeEnd, state.feeRateAttoEthPerSecond - remainingRate, DECREASE_BALANCE);
			state.feeRateAttoEthPerSecond = remainingRate;
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
		_writeQuestionWithRecovery(bookId, questionId, state, correction, 0);
		_syncFeeMode(bookId, book);
		unitsBurned = _descaled(unitsBurned);
		emit SettlementRedeemed(bookId, questionId, outcomeShares, unitsBurned, cashAttoEth);
	}

	/// @notice Effective stream after applying the shared horizon, budget and end grid.
	function normalizeFeeStream(uint96 rate, uint48 end, uint48 clock, uint256 budget) public view returns (uint96, uint48) {
		if (rate == 0) return (0, 0);
		uint256 last = Math.min(Math.min(end, FEE_END_LIMIT - 1), uint256(clock) + budget / rate);
		last -= last % feeEndGranularity;
		if (last <= clock) return (0, 0);
		return (rate, uint48(last));
	}

	/// @notice Replace one prospective collateral fee stream after checkpointing every old stream.
	/// @dev Clamp the end to the fee budget above the backing floor and FEE_END_LIMIT, then round it
	/// down to feeEndGranularity. Runoff pauses accrual globally; pausing never extends the absolute
	/// end, so skipped intervals cannot be charged after recap.
	function replaceFeeStream(uint64 bookId, uint256 questionId, uint96 rateAttoEthPerSecond, uint48 end, uint48 securityPoolTimestamp) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, securityPoolTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		require(frozenBookId == 0, 'Final claim fees closed');
		uint48 feeClockTimestamp = _feeTimestamp(book);
		require(rateAttoEthPerSecond == 0 || (state.finalAfter == 0 && end > feeClockTimestamp), 'Invalid question fee interval');
		(rateAttoEthPerSecond, end) = normalizeFeeStream(rateAttoEthPerSecond, end, feeClockTimestamp, _feeBudget(bookId, book, state));
		uint48 nextEnd = rateAttoEthPerSecond == 0 ? 0 : end;
		uint256 previousRate = state.feeRateAttoEthPerSecond;
		// An unchanged end receives one net write; only a moved stream is removed and re-added.
		if (state.feeEnd == nextEnd)
			_changeFeeRate(bookId, nextEnd, rateAttoEthPerSecond > previousRate ? rateAttoEthPerSecond - previousRate : previousRate - rateAttoEthPerSecond, rateAttoEthPerSecond > previousRate);
		else {
			_changeFeeRate(bookId, state.feeEnd, previousRate, DECREASE_BALANCE);
			_changeFeeRate(bookId, nextEnd, rateAttoEthPerSecond, INCREASE_BALANCE);
		}
		state.feeRateAttoEthPerSecond = rateAttoEthPerSecond;
		state.feeStart = feeClockTimestamp;
		state.feeEnd = nextEnd;
		_writeQuestion(bookId, book, questionId, state);
		emit FeeStreamReplaced(bookId, questionId, rateAttoEthPerSecond, state.feeEnd);
	}

	function collectFees(uint64 bookId, uint256 cashAttoEth) external onlySecurityPool {
		Book storage book = _book(bookId);
		require(cashAttoEth <= book.feeCashAttoEth, 'Fee escrow insufficient');
		book.feeCashAttoEth -= cashAttoEth;
	}

	/// @notice Stop at the last valid price security pool timestamp before advancing through a stale-price period.
	function setFeeAccrualEnabled(uint64 bookId, bool enabled, uint48 securityPoolTimestamp) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, securityPoolTimestamp);
		require(!enabled || _feeTimestamp(book) <= block.timestamp, 'Fee activation is in the future');
		book.feesEnabled = enabled;
		_syncFeeMode(bookId, book);
	}

	/// @notice Schedule a bound outcome's irreversible deadline; ordinary question end is insufficient.
	/// @dev The authority must replace/cancel this schedule atomically whenever reporting changes it.
	function scheduleFinality(uint64 bookId, uint256 questionId, uint48 finalAfter, uint48 securityPoolTimestamp) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, securityPoolTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		require(frozenBookId == 0 && !_isMature(book, state.finalAfter, book.securityPoolTimestamp), 'Final claim immutable');
		require(finalAfter == 0 || finalAfter >= securityPoolTimestamp, 'Finality already elapsed');
		require(finalAfter == 0 || state.feeRateAttoEthPerSecond == 0 || state.feeEnd <= _feeTimestamp(book), 'Stop fees before finality');
		state.finalAfter = finalAfter;
		_writeQuestion(bookId, book, questionId, state);
		emit FinalityScheduled(bookId, questionId, state.finalAfter);
	}

	/// @notice Checkpoint time fees only. Unrelated maturities stay pending.
	function checkpointFees(uint64 bookId, uint48 securityPoolTimestamp) external onlySecurityPool {
		_accrueFees(bookId, _activeBook(bookId), securityPoolTimestamp);
	}

	/// @notice Reserve one question's finalized claim without waiting for a redemption.
	function finalizeQuestion(uint64 bookId, uint256 questionId, uint48 securityPoolTimestamp) external onlySecurityPool {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, securityPoolTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		if (frozenBookId == 0) _finalizeQuestion(bookId, book, questionId, state);
	}

	function freezeMatured(uint64 bookId, uint48 securityPoolTimestamp) external onlySecurityPool returns (uint64 frozenBookId) {
		Book storage book = _activeBook(bookId);
		return _freezeMatured(bookId, book, securityPoolTimestamp);
	}

	function quoteRedemption(uint64 bookId, uint256 questionId, uint256 outcomeShares) public view returns (uint256 cashAttoEth, uint256 unitsBurned) {
		return _quoteRedemption(bookId, questionId, outcomeShares, _book(bookId).securityPoolTimestamp);
	}

	/// @notice Executable collateral proceeds after fees through the supplied redemption clock.
	function quoteRedemptionAt(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint48 securityPoolTimestamp) external view returns (uint256, uint256) {
		return quoteRedemptionThrough(bookId, questionId, outcomeShares, securityPoolTimestamp, securityPoolTimestamp);
	}
	/// @notice Project fees only through the effective capital price checkpoint, retaining the current finality clock.
	function quoteRedemptionThrough(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint48 securityPoolTimestamp, uint48 feeThrough) public view returns (uint256, uint256) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		if (book.isSealed && frozenBookId == 0) return (0, 0);
		if (frozenBookId != 0 || book.isSealed)
			return _quoteRedemption(bookId, questionId, outcomeShares, securityPoolTimestamp);
		require(securityPoolTimestamp >= book.securityPoolTimestamp && securityPoolTimestamp <= block.timestamp, 'Invalid settlement clock');
		uint256 cash = book.cashAttoEth;
		uint256 units = book.units;
		uint256 remainder = feeRemainders[bookId];
		uint48 previousFeeTime = _feeTimestamp(book);
		uint48 nextFeeTime =
			uint48(Math.max(book.securityPoolTimestamp, Math.min(securityPoolTimestamp, feeThrough))) +
				book.feeTimeOffset;
		if (feeModes[uint64(tree.floor(book.feeModeRoot, previousFeeTime))].funded && nextFeeTime > previousFeeTime) {
			uint256 fees = _feeIntegral(book, nextFeeTime) - _feeIntegral(book, previousFeeTime);
			(uint256 cashFees, uint256 nextRemainder) = SettlementMath.feeCash(fees, _netCash(bookId, book), units, remainder);
			cash -= cashFees;
			units -= fees;
			remainder = nextRemainder;
			uint48 end = uint48(Math.min(nextFeeTime, state.feeEnd));
			if (end > previousFeeTime) state.units -= state.feeRateAttoEthPerSecond * (end - previousFeeTime);
		}
		if (state.outcomeSupplyAttoShares == 0) return (0, 0);
		require(outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		uint256 burned = SettlementMath.unitsForRedeemedShares(state.units, state.outcomeSupplyAttoShares, outcomeShares);
		if (_isMature(book, state.finalAfter, securityPoolTimestamp)) {
			uint256 reserved = SettlementMath.cashForUnits(cash, units, remainder, state.units);
			return (SettlementMath.cashForUnits(reserved, state.units, 0, burned), _descaled(burned));
		}
		return (SettlementMath.cashForUnits(cash, units, remainder, burned), _descaled(burned));
	}

	function _quoteRedemption(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint48 securityPoolTimestamp) private view returns (uint256 cashAttoEth, uint256 unitsBurned) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		// Losing outcome tokens may remain after every payable claim is burned.
		if (state.outcomeSupplyAttoShares == 0) return (0, 0);
		require(outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		if (outcomeShares == 0) return (0, 0);
		unitsBurned = SettlementMath.unitsForRedeemedShares(state.units, state.outcomeSupplyAttoShares, outcomeShares);
		if (frozenBookId == 0) {
			if (!book.isSealed && _isMature(book, state.finalAfter, securityPoolTimestamp)) {
				uint256 reserved = SettlementMath.cashForUnits(book.cashAttoEth, book.units, feeRemainders[bookId], state.units);
				cashAttoEth = SettlementMath.cashForUnits(reserved, state.units, 0, unitsBurned);
			} else
				cashAttoEth = SettlementMath.cashForUnits(book.cashAttoEth, book.units, feeRemainders[bookId], unitsBurned);
			return (cashAttoEth, _descaled(unitsBurned));
		}
		FrozenBook storage frozen = frozenBooks[frozenBookId];
		if (frozen.sourceBookId != bookId) return (0, 0);
		return (SettlementMath.cashForUnits(frozen.cashAttoEth, frozen.units, 0, unitsBurned), _descaled(unitsBurned));
	}

	/// @notice Quote REP directly from outcome-share ownership, before rounding collateral claim units.
	function quoteRecoveryRep(uint64 bookId, uint256 questionId, uint256 outcomeShares) external view returns (uint256) {
		(, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		if (_book(bookId).isSealed && frozenBookId == 0) return 0;
		return historicalRecoveryRep(bookId, questionId, outcomeShares);
	}

	/// @notice Historical allocation retained for sealed-source fork accounting.
	function historicalRecoveryRep(uint64 bookId, uint256 questionId, uint256 outcomeShares) public view returns (uint256) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
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

	function _scaledRecovery(uint64 bookId, Book storage book, uint256 questionId, Question memory state) internal view override returns (uint256 scaledRecoveryEntitlement) {
		StoredQuestionState storage snapshot = questionStates[uint64(questionMap.get(book.questionRoot, questionId))];
		RecoveryState storage recovery = recoveryStates[bookId];
		Question storage stored = snapshot.question;
		// Allocate current units at the branch's index, then carry the snapshot's
		// correction and the fees that remained lazy since the snapshot. A fee unit
		// charged after a fork was part of the question at that fork, so it keeps
		// that fork's increment; child fees never shrink an inherited REP share.
		// These are residues modulo 2^256; wrapping is intentional.
		uint256 lazyFeeUnits;
		uint256 lazyFeeIndex = snapshot.recoveryIndex;
		uint256 earlierFeeCredit;
		unchecked {
			lazyFeeUnits = stored.units - state.units;
		}
		if (lazyFeeUnits != 0 && recovery.forkRoot != 0) {
			uint48 start = stored.feeStart;
			(uint256 increments, uint256 weights) = maturities.prefix(recovery.forkRoot, start + 1);
			(lazyFeeIndex, earlierFeeCredit) = maturities.prefix(recovery.forkRoot, uint48(Math.min(_feeTimestamp(book), stored.feeEnd)) + 1);
			// Forks after the snapshot and before the cut: fee units charged before each
			// such fork did not hold its increment. They were charged at the unchanged
			// funded-second rate, so rate * sum(increment * (forkSeconds - startSeconds)).
			// Prefix sums are residues modulo 2^256, so their differences are exact.
			unchecked {
				earlierFeeCredit =
					stored.feeRateAttoEthPerSecond *
					(earlierFeeCredit - weights - _fundedSeconds(book, start) * (lazyFeeIndex - increments));
			}
		}
		unchecked {
			scaledRecoveryEntitlement =
				state.units * recovery.index +
				snapshot.recoveryCorrection +
				lazyFeeUnits * lazyFeeIndex -
				earlierFeeCredit;
		}
	}

	function recoveryRep(uint64 bookId) external view returns (uint256) {
		return _book(bookId).recoveryAttoRep;
	}

	function _accrueFees(uint64 bookId, Book storage book, uint48 securityPoolTimestamp) private {
		require(securityPoolTimestamp >= book.securityPoolTimestamp && securityPoolTimestamp <= block.timestamp, 'Invalid settlement clock');
		uint48 previousFeeTime = _feeTimestamp(book);
		uint48 nextFeeTime = securityPoolTimestamp + book.feeTimeOffset;
		if (feeModes[uint64(tree.floor(book.feeModeRoot, previousFeeTime))].funded && nextFeeTime > previousFeeTime) {
			uint256 fees = _feeIntegral(book, nextFeeTime) - _feeIntegral(book, previousFeeTime);
			(uint256 cashFees, uint256 remainder) = SettlementMath.feeCash(fees, _netCash(bookId, book), book.units, feeRemainders[bookId]);
			book.units -= fees;
			feeRemainders[bookId] = remainder;
			book.cashAttoEth -= cashFees;
			book.feeCashAttoEth += cashFees;
			if (cashFees != 0) emit AggregateFeesAccrued(bookId, securityPoolTimestamp, cashFees);
		}
		book.securityPoolTimestamp = securityPoolTimestamp;
	}

	function _isMature(Book storage book, uint48 deadline, uint48 securityPoolTimestamp) private view returns (bool) {
		return deadline != 0 && deadline < securityPoolTimestamp && book.minimumFinalAfter < securityPoolTimestamp;
	}

	function _finalizeQuestion(uint64 bookId, Book storage book, uint256 questionId, Question memory state) private returns (uint64 frozenBookId) {
		if (!_isMature(book, state.finalAfter, book.securityPoolTimestamp) || state.units == 0) return 0;
		uint256 entitlement = _scaledRecovery(bookId, book, questionId, state);
		frozenBookId = _reserveClaim(bookId, book, state.units, entitlement);
		uint256 correction;
		unchecked {
			correction = entitlement - state.units * recoveryStates[bookId].index;
		}
		_writeQuestionWithRecovery(bookId, questionId, state, correction, frozenBookId);
	}

	function _freezeMatured(uint64 bookId, Book storage book, uint48 securityPoolTimestamp) private returns (uint64 frozenBookId) {
		_accrueFees(bookId, book, securityPoolTimestamp);
		if (securityPoolTimestamp <= book.minimumFinalAfter) return 0;
		(uint256 prefix, uint256 correctionPrefix) = maturities.prefix(book.finalityRoot, securityPoolTimestamp - 1);
		uint256 units;
		// Only pending deadlines can change. All newly matured scheduled units
		// fit the live book, so a modular prefix difference is their exact amount.
		unchecked {
			units = prefix - book.finalizedUnitsPrefix;
		}
		book.finalizedUnitsPrefix = prefix;
		if (units == 0) return 0;
		RecoveryState storage recovery = recoveryStates[bookId];
		uint256 scaledRecovery;
		unchecked {
			scaledRecovery = units * recovery.index + correctionPrefix - recovery.finalizedPrefix;
		}
		recovery.finalizedPrefix = correctionPrefix;
		frozenBookId = _reserveClaim(bookId, book, units, scaledRecovery);
		book.frozenRoot = frozenHistory.append(book.frozenRoot, securityPoolTimestamp - 1, frozenBookId);
	}

	function _reserveClaim(uint64 bookId, Book storage book, uint256 units, uint256 scaledRecovery) private returns (uint64 frozenBookId) {
		uint256 cashAttoEth = SettlementMath.cashForUnits(book.cashAttoEth, book.units, feeRemainders[bookId], units);
		uint256 recoveryAttoRep = units == book.units ? book.recoveryAttoRep : scaledRecovery / RECOVERY_SCALE;
		book.cashAttoEth -= cashAttoEth;
		book.recoveryAttoRep -= recoveryAttoRep;
		book.units -= units;
		_clearEmptyBook(bookId, book);
		frozenBookId = ++lastFrozenBookId;
		frozenBooks[frozenBookId] = FrozenBook(cashAttoEth, units, bookId, recoveryAttoRep);
		_syncFeeMode(bookId, book);
		emit FinalClaimsFrozen(bookId, frozenBookId, book.securityPoolTimestamp, _descaled(units), cashAttoEth);
	}

	/// @notice Remaining collateral that may fund fees, excluding the rounded-up backing floor.
	function scaledAvailableFeeBudget(uint64 bookId, uint256 questionId) public view returns (uint256) {
		Book storage book = _book(bookId);
		(Question memory state, ) = scaledQuestion(bookId, questionId);
		return _feeBudget(bookId, book, state);
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
		(uint256 endedRate, uint256 weightedEnds) = maturities.prefix(book.feeRateRoot, nativeTimestamp / feeEndGranularity);
		return (maturities.total(book.feeRateRoot) - endedRate) * nativeTimestamp + weightedEnds;
	}

	/// @dev Keys are bucket numbers; units are rates and corrections are rate * end in native seconds.
	/// Normalized ends are positive multiples of feeEndGranularity, so every key is nonzero and every
	/// stream in a bucket shares its end. Residues cannot wrap: each bucket rate and the rate total stay
	/// at most uint208.max, and every end is below 2^33, so the end-weighted total stays below 2^241.
	function _changeFeeRate(uint64 bookId, uint48 end, uint256 rate, bool increase) private {
		if (rate == 0) return;
		uint256 weighted = rate * end;
		unchecked {
			_addPrefix(bookId, true, end / feeEndGranularity, increase ? rate : 0 - rate, increase ? weighted : 0 - weighted);
		}
	}

	/// @dev The writer holds the MaturityMap update code, which keeps the book under the runtime size limit.
	function _addPrefix(uint64 bookId, bool feeRoot, uint48 key, uint256 units, uint256 correction) private {
		DelegateCall.invoke(address(writer), abi.encodeCall(SecurityPoolSettlementWriter.addPrefix, (bookId, feeRoot, key, units, correction)));
	}

	function _fundedSeconds(Book storage book, uint48 nativeTimestamp) private view returns (uint256) {
		uint64 modeId = uint64(tree.floor(book.feeModeRoot, nativeTimestamp));
		require(modeId != 0, 'Fee clock predates settlement');
		FeeMode storage mode = feeModes[modeId];
		return mode.fundedSeconds + (mode.funded ? nativeTimestamp - mode.nativeTimestamp : 0);
	}

	function _clearEmptyBook(uint64 bookId, Book storage book) private {
		if (book.units != 0) return;
		feeRemainders[bookId] = 0;
		fundingTargets[bookId] = FundingTarget(1, 1);
	}

	function _syncFeeMode(uint64 bookId, Book storage book) private {
		FeeMode storage mode = feeModes[uint64(tree.floor(book.feeModeRoot, _feeTimestamp(book)))];
		bool funded = isCashFunded(bookId) && book.feesEnabled;
		if (mode.funded != funded) _setFeeMode(book, funded);
	}

	function _setFeeMode(Book storage book, bool funded) private {
		uint48 feeClockTimestamp = _feeTimestamp(book);
		uint256 elapsed = book.feeModeRoot == 0 ? 0 : _fundedSeconds(book, feeClockTimestamp);
		feeModes[++lastFeeModeId] = FeeMode(elapsed, feeClockTimestamp, funded);
		book.feeModeRoot = tree.set(book.feeModeRoot, feeClockTimestamp, lastFeeModeId);
	}

	function _feeTimestamp(Book storage book) private view returns (uint48) {
		return book.securityPoolTimestamp + book.feeTimeOffset;
	}

	function _writeQuestion(uint64 bookId, Book storage book, uint256 questionId, Question memory state) private {
		(Question memory previous, ) = scaledQuestion(bookId, questionId);
		uint256 correction;
		unchecked {
			correction =
				_scaledRecovery(bookId, book, questionId, previous) - state.units * recoveryStates[bookId].index;
		}
		_writeQuestionWithRecovery(bookId, questionId, state, correction, 0);
	}

	function _writeQuestionWithRecovery(uint64 bookId, uint256 questionId, Question memory state, uint256 correction, uint64 frozenBookId) private {
		DelegateCall.invoke(address(writer), abi.encodeCall(SecurityPoolSettlementWriter.writeQuestion, (bookId, questionId, state, correction, frozenBookId)));
	}
}
