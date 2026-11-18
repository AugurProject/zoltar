// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolQuestionMap } from './SecurityPoolQuestionMap.sol';
import { SecurityPoolPersistentMap, SecurityPoolMaturityMap } from './SecurityPoolPersistentMap.sol';
import { SecurityPoolFrozenHistory } from './SecurityPoolFrozenHistory.sol';

/// @dev Shared settlement types and storage; accounting behavior remains in the book.
abstract contract SecurityPoolSettlementState {
	using SecurityPoolFrozenHistory for SecurityPoolFrozenHistory.Store;
	uint64 public lastBookId;
	uint64 public lastFrozenBookId;
	uint64 internal lastQuestionStateId;
	uint64 internal lastFeeModeId;
	SecurityPoolPersistentMap.Store internal tree;
	SecurityPoolMaturityMap.Store internal maturities;
	SecurityPoolQuestionMap.Store internal questionMap;
	SecurityPoolFrozenHistory.Store internal frozenHistory;

	bool internal constant INCREASE_BALANCE = true;
	bool internal constant DECREASE_BALANCE = false;
	// cashAttoEth is a liability backed by settlement custody; units allocate that cash.
	// securityPoolSettlementBook.test.ts covers unit conservation, fork copies and both clocks.
	// Only a fully cash-backed book accrues fees. Finality uses portfolio time.
	struct Book {
		uint256 cashAttoEth;
		uint256 units;
		uint256 feeCashAttoEth;
		uint64 questionRoot;
		uint64 finalityRoot;
		uint64 frozenRoot;
		uint48 portfolioTimestamp;
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
	// Principal and rates are claim-unit weights internally; question() converts them to cash.
	// finalAfter is portfolio time and remains independent of the native fee deadline.
	struct Question {
		uint256 units;
		uint256 outcomeSupplyAttoShares;
		uint48 finalAfter;
		uint256 feeRateAttoEthPerSecond;
		uint48 feeStart;
		uint48 feeEnd;
		uint256 feePrincipalAttoEth;
	}

	struct FundingTarget {
		uint256 numerator;
		uint256 denominator;
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
	/// Fork roots key each index increment by its native fork fee time: the
	/// increment itself and that increment times the funded seconds at the fork.
	/// They price lazily materialized fees at the index each fee unit held.
	struct RecoveryState {
		uint256 index;
		uint64 forkIncrementRoot;
		uint64 forkWeightRoot;
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
		uint64 frozenBookId;
	}
	mapping(uint64 => StoredQuestionState) internal questionStates;
	mapping(uint64 => FeeMode) internal feeModes;
	mapping(uint64 => RecoveryState) internal recoveryStates;
	mapping(uint64 => uint256) internal feeRemainders;
	mapping(uint64 => FundingTarget) internal fundingTargets;

	function _frozenBookId(Book storage book, StoredQuestionState storage stored) internal view returns (uint64) {
		uint64 frozenBookId = stored.frozenBookId;
		if (frozenBookId != 0 || stored.question.finalAfter == 0) return frozenBookId;
		return uint64(frozenHistory.ceiling(book.frozenRoot, stored.question.finalAfter));
	}
}

/// @dev Writes immutable question snapshots from the settlement book's storage context.
contract SecurityPoolSettlementWriter is SecurityPoolSettlementState {
	using SecurityPoolMaturityMap for SecurityPoolMaturityMap.Store;
	using SecurityPoolQuestionMap for SecurityPoolQuestionMap.Store;

	address private immutable host = msg.sender;

	function writeQuestion(uint64 bookId, uint256 questionId, Question memory state, uint256 correction, uint64 frozenBookId) external {
		require(address(this) == host, 'Only settlement book context');
		Book storage book = books[bookId];
		StoredQuestionState storage stored = questionStates[uint64(questionMap.get(book.questionRoot, questionId))];
		Question storage previous = stored.question;
		if (_frozenBookId(book, stored) == 0) {
			// All scheduled questions have stopped accruing fees. Their stored
			// units therefore equal the units already in the deadline index.
			unchecked {
				if (frozenBookId != 0) {
					book.finalityRoot = maturities.add(book.finalityRoot, previous.finalAfter, 0 - previous.units, 0 - stored.recoveryCorrection);
				} else if (previous.finalAfter == state.finalAfter) {
					book.finalityRoot = maturities.add(book.finalityRoot, state.finalAfter, state.units - previous.units, correction - stored.recoveryCorrection);
				} else {
					uint64 root = maturities.add(book.finalityRoot, previous.finalAfter, 0 - previous.units, 0 - stored.recoveryCorrection);
					book.finalityRoot = maturities.add(root, state.finalAfter, state.units, correction);
				}
			}
		}
		uint64 stateId = ++lastQuestionStateId;
		questionStates[stateId] = StoredQuestionState(state, correction, recoveryStates[bookId].index, frozenBookId == 0 ? stored.frozenBookId : frozenBookId);
		book.questionRoot = questionMap.set(book.questionRoot, questionId, stateId);
	}
}
