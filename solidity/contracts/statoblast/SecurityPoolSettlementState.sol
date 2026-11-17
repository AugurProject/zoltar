// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolQuestionMap } from './SecurityPoolQuestionMap.sol';
import { SecurityPoolPersistentMap } from './SecurityPoolPersistentMap.sol';
import { SecurityPoolFrozenHistory } from './SecurityPoolFrozenHistory.sol';

/// @dev Shared settlement types and storage; accounting behavior remains in the book.
abstract contract SecurityPoolSettlementState {
	uint64 public lastBookId;
	uint64 public lastFrozenBookId;
	uint64 internal lastQuestionStateId;
	uint64 internal lastFeeModeId;
	SecurityPoolPersistentMap.Store internal tree;
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
		uint64 finalityRoot;
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
	}
	mapping(uint64 => StoredQuestionState) internal questionStates;
	mapping(uint64 => FeeMode) internal feeModes;
	mapping(uint64 => RecoveryState) internal recoveryStates;
	mapping(uint64 => uint256) internal feeRemainders;
	mapping(uint64 => FundingTarget) internal fundingTargets;
}
