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

/// @notice Central ETH settlement accounting with distinct internal units and outcome supply.
/// @dev This contract records liabilities; its authority holds and transfers the actual ETH.
/// Every reported funding delta must be atomically backed by that custody. The authority also
/// authenticates complete-set or winning-outcome burns and supplies irreversible finality.
/// Finality uses a portfolio clock paused during forks; fee deadlines retain native calendar time.
/// A fork copies immutable roots, including ALL inherited outcome liabilities, in constant work.
contract SecurityPoolSettlementBook is SecurityPoolSettlementPricing {
	using SecurityPoolPersistentMap for SecurityPoolPersistentMap.Store;
	using SecurityPoolMaturityMap for SecurityPoolMaturityMap.Store;
	using SecurityPoolQuestionMap for SecurityPoolQuestionMap.Store;
	using SecurityPoolFrozenHistory for SecurityPoolFrozenHistory.Store;

	/// @notice Exclusive bound of every fee-stream end (about year 2242). Streams stop charging after it.
	uint48 public constant FEE_END_LIMIT = uint48(1) << 33;
	address public immutable portfolio;
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
	event FinalClaimsFrozen(uint64 indexed bookId, uint64 indexed frozenBookId, uint48 portfolioTimestamp, uint256 units, uint256 cashAttoEth);
	event FeeStreamReplaced(uint64 indexed bookId, uint256 indexed questionId, uint96 rateAttoEthPerSecond, uint48 end);
	event AggregateFeesAccrued(uint64 indexed bookId, uint48 portfolioTimestamp, uint256 cashAttoEth);

	constructor(address authority, uint256 minimumExchangeRate, uint48 endGranularity) SecurityPoolSettlementPricing(minimumExchangeRate) {
		require(authority != address(0), 'Invalid settlement authority');
		require(endGranularity != 0 && endGranularity <= FEE_END_LIMIT >> 1, 'Invalid fee end granularity');
		portfolio = authority;
		writer = new SecurityPoolSettlementWriter();
		feeEndGranularity = endGranularity;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	function createBook(uint48 portfolioTimestamp) external onlyPortfolio returns (uint64 bookId) {
		require(portfolioTimestamp <= block.timestamp, 'Future settlement clock');
		bookId = ++lastBookId;
		fundingTargets[bookId] = FundingTarget(1, 1);
		books[bookId].portfolioTimestamp = portfolioTimestamp;
		books[bookId].feesEnabled = true;
		_setFeeMode(books[bookId], true);
		emit BookCreated(bookId, 0, 0, 0);
	}

	/// @notice Seal a source at fork time after protecting claims already final strictly before it.
	/// @dev Sealed sources allow frozen claims and fee collection, but no active-unit redemptions.
	function sealForFork(uint64 bookId, uint48 portfolioTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_freezeMatured(bookId, book, portfolioTimestamp);
		book.isSealed = true;
	}

	/// @notice Create a child with independently supplied ETH and every source outcome liability.
	/// @dev Source fee escrow and finalized claims remain source obligations and are not duplicated.
	function createChildBook(uint64 sourceBookId, uint256 fundedCashAttoEth, uint256 recoveryAttoRep) external onlyPortfolio returns (uint64 bookId) {
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
		child.portfolioTimestamp = source.portfolioTimestamp;
		child.feeRateRoot = source.feeRateRoot;
		child.feeEndRoot = source.feeEndRoot;
		child.feeModeRoot = source.feeModeRoot;
		child.feesEnabled = source.feesEnabled;
		child.minimumFinalAfter = source.portfolioTimestamp;
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
			recovery.forkIncrementRoot = _addModular(recovery.forkIncrementRoot, forkTime, increment);
			recovery.forkWeightRoot = _addModular(recovery.forkWeightRoot, forkTime, weight);
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
		uint48 cutoff = book.isSealed ? book.portfolioTimestamp : forkTimestamp;
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
	/// while fees are disabled. Its portfolio finality clock and inherited claims do not advance.
	function setFeeClock(uint64 bookId, uint48 nativeTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		require(!book.feesEnabled, 'Pause fees before clock change');
		require(nativeTimestamp >= _feeTimestamp(book), 'Fee clock cannot go backwards');
		book.feeTimeOffset = nativeTimestamp - book.portfolioTimestamp;
		_setFeeMode(book, false);
	}

	function totals(uint64 bookId)
		external
		view
		returns (uint256 cashAttoEth, uint256 units, uint256 feeCashAttoEth, uint48 portfolioTimestamp, bool isSealed)
	{
		Book storage book = _book(bookId);
		return (book.cashAttoEth, _descaled(book.units), book.feeCashAttoEth, book.portfolioTimestamp, book.isSealed);
	}

	/// @notice Donate the active cash deficit while preserving all recovery REP.
	function topUp(uint64 bookId, uint256 cashAttoEth) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		require(cashAttoEth != 0 && cashAttoEth == _missingCash(bookId, book), 'Supply the entire settlement deficit');
		book.cashAttoEth += cashAttoEth;
		_syncFeeMode(bookId, book);
		emit SettlementBookRepaired(bookId, cashAttoEth);
	}

	function mint(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 minimumShares, uint48 portfolioTimestamp) external onlyPortfolio returns (uint256) {
		return _mint(bookId, questionId, cashAttoEth, minimumShares, 0, portfolioTimestamp);
	}

	function mintWithRecoveryRep(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 minimumShares, uint256 recoveryAttoRep, uint48 portfolioTimestamp) external onlyPortfolio returns (uint256) {
		return _mint(bookId, questionId, cashAttoEth, minimumShares, recoveryAttoRep, portfolioTimestamp);
	}

	function _mint(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 minimumShares, uint256 recoveryAttoRep, uint48 portfolioTimestamp) private returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, portfolioTimestamp);
		require(cashAttoEth > 0, 'Zero settlement funding');
		outcomeShares = quoteMint(bookId, questionId, cashAttoEth);
		(Question memory state, ) = scaledQuestion(bookId, questionId);
		require(outcomeShares > 0 && outcomeShares >= minimumShares, 'Insufficient outcome shares');
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
	function redeem(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint256 minimumCashAttoEth, uint48 portfolioTimestamp) public onlyPortfolio returns (uint256 cashAttoEth, uint256 unitsBurned, uint256 recoveryAttoRep) {
		Book storage book = _book(bookId);
		if (!book.isSealed) _accrueFees(bookId, book, portfolioTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		if (!book.isSealed && frozenBookId == 0) frozenBookId = _finalizeQuestion(bookId, book, questionId, state);
		require(outcomeShares > 0 && outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		uint256 scaledRecovery = _scaledRecovery(bookId, book, questionId, state);
		recoveryAttoRep = _quoteRecovery(book, state, frozenBookId, outcomeShares, scaledRecovery);
		unitsBurned =
			outcomeShares == state.outcomeSupplyAttoShares
				? state.units
				: Math.mulDiv(state.units, outcomeShares, state.outcomeSupplyAttoShares);
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
		require(cashAttoEth >= minimumCashAttoEth, 'Insufficient settlement cash');
		state.units -= unitsBurned;
		state.feePrincipalAttoEth = Math.mulDiv(state.feePrincipalAttoEth, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares);
		if (state.feeRateAttoEthPerSecond != 0) {
			uint256 remainingRate = Math.mulDiv(state.feeRateAttoEthPerSecond, state.outcomeSupplyAttoShares - outcomeShares, state.outcomeSupplyAttoShares);
			// One net write: the stream keeps its end, so its key is changed once instead of removed and re-added.
			_changeFeeRate(book, state.feeEnd, state.feeRateAttoEthPerSecond - remainingRate, DECREASE_BALANCE);
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

	/// @notice Replace one prospective collateral fee stream after checkpointing every old stream.
	/// @dev Clamp the end to the fee budget above the backing floor and FEE_END_LIMIT, then round it
	/// down to feeEndGranularity. Runoff pauses accrual globally; pausing never extends the absolute
	/// end, so skipped intervals cannot be charged after recap.
	function replaceFeeStream(uint64 bookId, uint256 questionId, uint96 rateAttoEthPerSecond, uint48 end, uint48 portfolioTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, portfolioTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		require(frozenBookId == 0, 'Final claim fees closed');
		uint48 feeClockTimestamp = _feeTimestamp(book);
		require(rateAttoEthPerSecond == 0 || (state.finalAfter == 0 && end > feeClockTimestamp), 'Invalid question fee interval');
		if (rateAttoEthPerSecond != 0) {
			uint256 last = Math.min(Math.min(end, FEE_END_LIMIT - 1), feeClockTimestamp + _feeBudget(bookId, book, state) / rateAttoEthPerSecond);
			last -= last % feeEndGranularity;
			if (last <= feeClockTimestamp) rateAttoEthPerSecond = 0;
			else end = uint48(last);
		}
		uint48 nextEnd = rateAttoEthPerSecond == 0 ? 0 : end;
		uint256 previousRate = state.feeRateAttoEthPerSecond;
		// An unchanged end receives one net write; only a moved stream is removed and re-added.
		if (state.feeEnd == nextEnd)
			_changeFeeRate(book, nextEnd, rateAttoEthPerSecond > previousRate ? rateAttoEthPerSecond - previousRate : previousRate - rateAttoEthPerSecond, rateAttoEthPerSecond > previousRate);
		else {
			_changeFeeRate(book, state.feeEnd, previousRate, DECREASE_BALANCE);
			_changeFeeRate(book, nextEnd, rateAttoEthPerSecond, INCREASE_BALANCE);
		}
		state.feeRateAttoEthPerSecond = rateAttoEthPerSecond;
		state.feeStart = feeClockTimestamp;
		state.feeEnd = nextEnd;
		_writeQuestion(bookId, book, questionId, state);
		emit FeeStreamReplaced(bookId, questionId, rateAttoEthPerSecond, state.feeEnd);
	}

	function collectFees(uint64 bookId, uint256 cashAttoEth) external onlyPortfolio {
		Book storage book = _book(bookId);
		require(cashAttoEth <= book.feeCashAttoEth, 'Fee escrow insufficient');
		book.feeCashAttoEth -= cashAttoEth;
	}

	/// @notice Stop at the last valid price portfolio timestamp before advancing through a stale-price period.
	function setFeeAccrualEnabled(uint64 bookId, bool enabled, uint48 portfolioTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, portfolioTimestamp);
		require(!enabled || _feeTimestamp(book) <= block.timestamp, 'Fee activation is in the future');
		book.feesEnabled = enabled;
		_syncFeeMode(bookId, book);
	}

	/// @notice Schedule a bound outcome's irreversible deadline; ordinary question end is insufficient.
	/// @dev The authority must replace/cancel this schedule atomically whenever reporting changes it.
	function scheduleFinality(uint64 bookId, uint256 questionId, uint48 finalAfter, uint48 portfolioTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, portfolioTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		require(frozenBookId == 0 && !_isMature(book, state.finalAfter, book.portfolioTimestamp), 'Final claim immutable');
		require(finalAfter == 0 || finalAfter >= portfolioTimestamp, 'Finality already elapsed');
		require(finalAfter == 0 || state.feeRateAttoEthPerSecond == 0 || state.feeEnd <= _feeTimestamp(book), 'Stop fees before finality');
		state.finalAfter = finalAfter;
		_writeQuestion(bookId, book, questionId, state);
		emit FinalityScheduled(bookId, questionId, state.finalAfter);
	}

	/// @notice Checkpoint time fees only. Unrelated maturities stay pending.
	function checkpointFees(uint64 bookId, uint48 portfolioTimestamp) external onlyPortfolio {
		_accrueFees(bookId, _activeBook(bookId), portfolioTimestamp);
	}

	/// @notice Reserve one question's finalized claim without waiting for a redemption.
	function finalizeQuestion(uint64 bookId, uint256 questionId, uint48 portfolioTimestamp) external onlyPortfolio {
		Book storage book = _activeBook(bookId);
		_accrueFees(bookId, book, portfolioTimestamp);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		if (frozenBookId == 0) _finalizeQuestion(bookId, book, questionId, state);
	}

	function freezeMatured(uint64 bookId, uint48 portfolioTimestamp) external onlyPortfolio returns (uint64 frozenBookId) {
		Book storage book = _activeBook(bookId);
		return _freezeMatured(bookId, book, portfolioTimestamp);
	}

	function quoteRedemption(uint64 bookId, uint256 questionId, uint256 outcomeShares) public view returns (uint256 cashAttoEth, uint256 unitsBurned) {
		return _quoteRedemption(bookId, questionId, outcomeShares, _book(bookId).portfolioTimestamp);
	}

	/// @notice Quotes checkpointed balances using the supplied clock to determine whether a named reservation comes first.
	function quoteRedemptionAt(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint48 portfolioTimestamp) external view returns (uint256, uint256) {
		return _quoteRedemption(bookId, questionId, outcomeShares, portfolioTimestamp);
	}

	function _quoteRedemption(uint64 bookId, uint256 questionId, uint256 outcomeShares, uint48 portfolioTimestamp) private view returns (uint256 cashAttoEth, uint256 unitsBurned) {
		Book storage book = _book(bookId);
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		// Losing outcome tokens may remain after every payable claim is burned.
		if (state.outcomeSupplyAttoShares == 0) return (0, 0);
		require(outcomeShares <= state.outcomeSupplyAttoShares, 'Invalid outcome burn');
		if (outcomeShares == 0) return (0, 0);
		unitsBurned =
			outcomeShares == state.outcomeSupplyAttoShares
				? state.units
				: Math.mulDiv(state.units, outcomeShares, state.outcomeSupplyAttoShares);
		if (frozenBookId == 0) {
			if (!book.isSealed && _isMature(book, state.finalAfter, portfolioTimestamp)) {
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

	/// @notice Quote REP directly from outcome-share ownership, before rounding ETH units.
	function quoteRecoveryRep(uint64 bookId, uint256 questionId, uint256 outcomeShares) external view returns (uint256) {
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
		if (lazyFeeUnits != 0 && recovery.forkIncrementRoot != 0) {
			uint48 start = stored.feeStart;
			uint48 cut = uint48(Math.min(_feeTimestamp(book), stored.feeEnd));
			(uint256 increments, uint256 incrementsThroughCut) = _forkRange(recovery.forkIncrementRoot, start, cut);
			(uint256 weights, ) = _forkRange(recovery.forkWeightRoot, start, cut);
			lazyFeeIndex = incrementsThroughCut;
			// Forks after the snapshot and before the cut: fee units charged before each
			// such fork did not hold its increment. They were charged at the unchanged
			// funded-second rate, so rate * sum(increment * (forkSeconds - startSeconds)).
			uint256 startSeconds = _fundedSeconds(book, start);
			unchecked {
				earlierFeeCredit = stored.feeRateAttoEthPerSecond * (weights - startSeconds * increments);
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

	function _forkRange(uint64 root, uint48 start, uint48 cut) private view returns (uint256 range, uint256 throughCut) {
		throughCut = tree.prefixTotalModular(root, cut);
		unchecked {
			range = throughCut - tree.prefixTotalModular(root, start);
		}
	}

	/// @dev Each leaf value is its own weight; a zero residue deletes a leaf that adds nothing.
	function _addModular(uint64 root, uint48 key, uint256 residue) private returns (uint64) {
		unchecked {
			residue += tree.get(root, key);
		}
		return _setModular(root, key, residue, residue);
	}

	/// @dev Every modular trie write goes through this one call site, so the optimizer emits the
	/// trie update once instead of cloning it into individual callers.
	function _setModular(uint64 root, uint48 key, uint256 value, uint256 weight) private returns (uint64) {
		return tree.setModular(root, key, value, weight);
	}

	function recoveryRep(uint64 bookId) external view returns (uint256) {
		return _book(bookId).recoveryAttoRep;
	}

	function _accrueFees(uint64 bookId, Book storage book, uint48 portfolioTimestamp) private {
		require(portfolioTimestamp >= book.portfolioTimestamp && portfolioTimestamp <= block.timestamp, 'Invalid settlement clock');
		uint48 previousFeeTime = _feeTimestamp(book);
		uint48 nextFeeTime = portfolioTimestamp + book.feeTimeOffset;
		if (feeModes[uint64(tree.floor(book.feeModeRoot, previousFeeTime))].funded && nextFeeTime > previousFeeTime) {
			uint256 fees = _feeIntegral(book, nextFeeTime) - _feeIntegral(book, previousFeeTime);
			(uint256 cashFees, uint256 remainder) = SettlementMath.feeCash(fees, _netCash(bookId, book), book.units, feeRemainders[bookId]);
			book.units -= fees;
			feeRemainders[bookId] = remainder;
			book.cashAttoEth -= cashFees;
			book.feeCashAttoEth += cashFees;
			if (cashFees != 0) emit AggregateFeesAccrued(bookId, portfolioTimestamp, cashFees);
		}
		book.portfolioTimestamp = portfolioTimestamp;
	}

	function _isMature(Book storage book, uint48 deadline, uint48 portfolioTimestamp) private view returns (bool) {
		return deadline != 0 && deadline < portfolioTimestamp && book.minimumFinalAfter < portfolioTimestamp;
	}

	function _finalizeQuestion(uint64 bookId, Book storage book, uint256 questionId, Question memory state) private returns (uint64 frozenBookId) {
		if (!_isMature(book, state.finalAfter, book.portfolioTimestamp) || state.units == 0) return 0;
		uint256 entitlement = _scaledRecovery(bookId, book, questionId, state);
		frozenBookId = _reserveClaim(bookId, book, state.units, entitlement);
		uint256 correction;
		unchecked {
			correction = entitlement - state.units * recoveryStates[bookId].index;
		}
		_writeQuestionWithRecovery(bookId, questionId, state, correction, frozenBookId);
	}

	function _freezeMatured(uint64 bookId, Book storage book, uint48 portfolioTimestamp) private returns (uint64 frozenBookId) {
		_accrueFees(bookId, book, portfolioTimestamp);
		if (portfolioTimestamp <= book.minimumFinalAfter) return 0;
		(uint256 prefix, uint256 correctionPrefix) = maturities.prefix(book.finalityRoot, portfolioTimestamp - 1);
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
		book.frozenRoot = frozenHistory.append(book.frozenRoot, portfolioTimestamp - 1, frozenBookId);
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
		emit FinalClaimsFrozen(bookId, frozenBookId, book.portfolioTimestamp, _descaled(units), cashAttoEth);
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
		uint256 bucket = nativeTimestamp / feeEndGranularity;
		uint256 remainingRate = tree.total(book.feeRateRoot) - tree.prefixTotal(book.feeRateRoot, bucket);
		return remainingRate * nativeTimestamp + tree.prefixTotal(book.feeEndRoot, bucket);
	}

	/// @dev The fee maps share the modular trie update with the finality and fork maps, which keeps
	/// the book under the runtime size limit. Their aggregates cannot wrap: each change is at most a
	/// uint96 rate, the rate total stays at most uint208.max, and every end is below 2^33, so the
	/// end-weighted total stays below 2^241.
	function _changeFeeRate(Book storage book, uint48 end, uint256 rate, bool increase) private {
		if (rate == 0) return;
		// Index by bucket number, but weight the end aggregate in native seconds.
		uint48 bucket = end / feeEndGranularity;
		uint256 previous = tree.get(book.feeRateRoot, bucket);
		uint256 next = increase ? previous + rate : previous - rate;
		book.feeRateRoot = _setModular(book.feeRateRoot, bucket, next, next);
		require(tree.total(book.feeRateRoot) <= type(uint208).max, 'Aggregate fee rate overflow');
		book.feeEndRoot = _setModular(book.feeEndRoot, bucket, next, next * end);
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
		book.feeModeRoot = tree.set(book.feeModeRoot, feeClockTimestamp, lastFeeModeId, 0);
	}

	function _feeTimestamp(Book storage book) private view returns (uint48) {
		return book.portfolioTimestamp + book.feeTimeOffset;
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
