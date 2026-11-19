// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolSettlementState } from './SecurityPoolSettlementState.sol';
import { SecurityPoolSettlementMath as SettlementMath } from './SecurityPoolSettlementMath.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Cash-index pricing and representable-domain checks for settlement claim weights.
abstract contract SecurityPoolSettlementPricing is SecurityPoolSettlementState {
	uint256 public constant EXCHANGE_RATE_SCALE = 1e18;
	uint256 public constant UNIT_SCALE = SettlementMath.SCALE;
	uint256 internal constant RECOVERY_SCALE = 1 << 128;
	uint256 public immutable minimumOutcomeExchangeRate;

	constructor(uint256 minimumExchangeRate) {
		require(minimumExchangeRate > 0 && minimumExchangeRate <= EXCHANGE_RATE_SCALE, 'Invalid minimum exchange rate');
		minimumOutcomeExchangeRate = minimumExchangeRate;
	}
	function scaledQuestion(uint64 bookId, uint256 questionId) public view virtual returns (Question memory, uint64);
	function _scaledRecovery(uint64 bookId, Book storage book, uint256 questionId, Question memory state) internal view virtual returns (uint256);

	/// @notice Units remain claim weights; principal and scaled rates are cash equivalents.
	function question(uint64 bookId, uint256 questionId) external view returns (Question memory state, uint64 frozenBookId) {
		(state, frozenBookId) = scaledQuestion(bookId, questionId);
		Book storage book = _book(bookId);
		uint256 units = frozenBookId == 0 ? book.units : frozenBooks[frozenBookId].units;
		uint256 net = frozenBookId == 0 ? _netCash(bookId, book) : frozenBooks[frozenBookId].cashAttoEth * UNIT_SCALE;
		state.units = _descaled(state.units);
		state.feePrincipalAttoEth = SettlementMath.rawValue(state.feePrincipalAttoEth, net, units, Math.Rounding.Ceil);
		state.feeRateAttoEthPerSecond = SettlementMath.scaledValue(state.feeRateAttoEthPerSecond, net, units);
	}
	function requiredCash(uint64 bookId) public view returns (uint256) {
		Book storage book = _book(bookId);
		FundingTarget storage target = fundingTargets[bookId];
		return SettlementMath.requiredCash(book.units, target.numerator, target.denominator, feeRemainders[bookId]);
	}
	function isCashFunded(uint64 bookId) public view returns (bool) {
		return _book(bookId).cashAttoEth >= requiredCash(bookId);
	}
	function requiredForkCash(uint64 bookId) public view returns (uint256) {
		Book storage book = _book(bookId);
		FundingTarget memory target = _childTarget(bookId, book);
		return SettlementMath.requiredCash(book.units, target.numerator, target.denominator, 0);
	}
	function _childTarget(uint64 bookId, Book storage book) internal view returns (FundingTarget memory) {
		return
			book.units != 0 && isCashFunded(bookId)
				? FundingTarget(book.cashAttoEth * UNIT_SCALE, book.units)
				: fundingTargets[bookId];
	}
	function quoteMint(uint64 bookId, uint256 questionId, uint256 cashAttoEth) public view returns (uint256 outcomeShares) {
		Book storage book = _activeBook(bookId);
		require(isCashFunded(bookId), 'Settlement in runoff');
		(Question memory state, uint64 frozenBookId) = scaledQuestion(bookId, questionId);
		require(frozenBookId == 0 && state.finalAfter == 0, 'Settlement mint closed');
		uint256 addedUnits = _mintUnits(bookId, book, cashAttoEth);
		if (state.outcomeSupplyAttoShares == 0) {
			require(state.units == 0, 'Outcome accounting mismatch');
			return cashAttoEth;
		}
		uint256 value = SettlementMath.scaledValue(state.units, _netCash(bookId, book), book.units);
		require(state.units > 0 && Math.mulDiv(value, EXCHANGE_RATE_SCALE / UNIT_SCALE, state.outcomeSupplyAttoShares) >= minimumOutcomeExchangeRate, 'Outcome exchange below minimum');
		return Math.mulDiv(addedUnits, state.outcomeSupplyAttoShares, state.units);
	}
	function quoteMintPrincipal(uint64 bookId, uint256 questionId, uint256 cashAttoEth) external view returns (uint256) {
		(Book storage book, uint256 principal, , ) = _quoteMintPrincipal(bookId, questionId, cashAttoEth);
		return
			book.units == 0
				? cashAttoEth
				: SettlementMath.rawValue(principal, _netCash(bookId, book), book.units, Math.Rounding.Ceil);
	}
	function validateMintFeePrecision(uint64 bookId, uint256 questionId, uint256 cashAttoEth, uint256 annualBps) external view {
		if (annualBps == 0 || cashAttoEth == 0) return;
		(Book storage book, , uint256 principal, uint256 addedUnits) = _quoteMintPrincipal(bookId, questionId, cashAttoEth);
		SettlementMath.validateFeePrecision(principal, _netCash(bookId, book) + cashAttoEth * UNIT_SCALE, book.units + addedUnits, annualBps);
	}
	/// @dev The minted principal increment and the question's resulting principal, which must stay below the REP precision bound.
	function _quoteMintPrincipal(uint64 bookId, uint256 questionId, uint256 cashAttoEth) private view returns (Book storage book, uint256 increment, uint256 principal, uint256 addedUnits) {
		uint256 shares = quoteMint(bookId, questionId, cashAttoEth);
		book = _book(bookId);
		(Question memory state, ) = scaledQuestion(bookId, questionId);
		addedUnits = _mintUnits(bookId, book, cashAttoEth);
		increment = SettlementMath.principal(state.feePrincipalAttoEth, state.outcomeSupplyAttoShares, shares, addedUnits);
		principal = state.feePrincipalAttoEth + increment;
		require(principal < RECOVERY_SCALE, 'Settlement principal exceeds precision bound');
	}
	function quoteMintRecoveryRep(uint64 bookId, uint256 questionId, uint256 cashAttoEth) public view returns (uint256) {
		uint256 addedShares = quoteMint(bookId, questionId, cashAttoEth);
		(Question memory state, ) = scaledQuestion(bookId, questionId);
		return _mintRecoveryRep(bookId, _book(bookId), questionId, state, addedShares);
	}
	function _mintRecoveryRep(uint64 bookId, Book storage book, uint256 questionId, Question memory state, uint256 addedShares) internal view returns (uint256) {
		if (state.outcomeSupplyAttoShares == 0) return 0;
		uint256 entitlement = _mintEntitlement(bookId, book, questionId, state);
		// A quotient of at least 2^256 would require at least 2^128 attoREP.
		(uint256 high, ) = Math.mul512(entitlement, addedShares);
		require(high < state.outcomeSupplyAttoShares, 'Recovery REP exceeds precision bound');
		uint256 scaled = Math.mulDiv(entitlement, addedShares, state.outcomeSupplyAttoShares);
		uint256 recoveryAttoRep = scaled / RECOVERY_SCALE;
		if (scaled % RECOVERY_SCALE != 0 || mulmod(entitlement, addedShares, state.outcomeSupplyAttoShares) != 0)
			recoveryAttoRep++;
		require(recoveryAttoRep < RECOVERY_SCALE - book.recoveryAttoRep, 'Recovery REP exceeds precision bound');
		return recoveryAttoRep;
	}
	function _mintEntitlement(uint64 bookId, Book storage book, uint256 questionId, Question memory state) internal view returns (uint256) {
		return
			state.units == book.units
				? book.recoveryAttoRep * RECOVERY_SCALE
				: _scaledRecovery(bookId, book, questionId, state);
	}
	function _mintUnits(uint64 bookId, Book storage book, uint256 cash) internal view returns (uint256 added) {
		require(cash < RECOVERY_SCALE - book.cashAttoEth, 'Settlement cash exceeds precision bound');
		added = SettlementMath.mintUnits(cash, book.units, _netCash(bookId, book));
		require(added < RECOVERY_SCALE - book.units, 'Settlement units exceed precision bound');
	}
	/// @dev Reported units: full-precision claim weights rounded up to whole units.
	function _descaled(uint256 scaledUnits) internal pure returns (uint256) {
		return Math.ceilDiv(scaledUnits, UNIT_SCALE);
	}
	function _netCash(uint64 bookId, Book storage book) internal view returns (uint256) {
		return SettlementMath.netCash(book.cashAttoEth, feeRemainders[bookId]);
	}
	function _feeBudget(uint64 bookId, Book storage book, Question memory state) internal view returns (uint256) {
		return
			SettlementMath.feeBudget(state.units, state.outcomeSupplyAttoShares, minimumOutcomeExchangeRate, _netCash(bookId, book), book.units);
	}
	function _missingCash(uint64 bookId, Book storage book) internal view returns (uint256) {
		uint256 required = requiredCash(bookId);
		return required > book.cashAttoEth ? required - book.cashAttoEth : 0;
	}
	function _book(uint64 bookId) internal view returns (Book storage book) {
		require(bookId != 0 && bookId <= lastBookId, 'Unknown settlement book');
		return books[bookId];
	}
	function _activeBook(uint64 bookId) internal view returns (Book storage book) {
		book = _book(bookId);
		require(!book.isSealed, 'Settlement book sealed');
	}
}
