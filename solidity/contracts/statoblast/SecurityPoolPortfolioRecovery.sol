// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';

/// @notice Aggregate recovery accounting for allocation-time ownership, without holding assets.
/// @dev A point-updated Fenwick tree lets each owner collect a balance-constant interval of allocations.
/// Other owners' activity and additional questions never create intervals for an existing owner.
contract SecurityPoolPortfolioRecovery {
	uint256 private constant PRECISION = 1e36;
	address public immutable portfolio;
	uint256 public positionCount;
	mapping(uint256 => Amounts) private tree;
	mapping(uint256 => DistributionCarry) private distributionCarries;
	mapping(uint256 => uint256) private generationEnds;
	mapping(uint256 => bool) private closedGenerations;
	mapping(address => Interval[]) private ownerIntervals;
	mapping(address => uint256) private openIntervals;
	mapping(address => Credits) public ownerCredits;

	struct Amounts {
		uint256 rep;
		uint256 eth;
	}

	struct DistributionCarry {
		uint256 denominator;
		uint256 rep;
		uint256 eth;
	}

	struct Credits {
		uint256 rep;
		uint256 eth;
		uint256 repRemainder;
		uint256 feeRemainder;
	}

	struct Interval {
		uint256 generation;
		uint256 startPosition;
		uint256 endPosition;
		uint256 shares;
		uint256 repIndex;
		uint256 feeIndex;
		bool open;
		bool active;
	}

	constructor() {
		portfolio = msg.sender;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	/// @notice Deploy immutable custody on behalf of the portfolio without embedding it in root runtime.
	function createPosition(ISecurityPool pool, SecurityPoolPortfolioQuote quoteHelper) external onlyPortfolio returns (SecurityPoolPortfolioPosition) {
		return new SecurityPoolPortfolioPosition(portfolio, pool, quoteHelper);
	}

	/// @notice Append a zero-valued point, retaining old recoveries in newly created tree ancestors.
	function appendPosition() external onlyPortfolio returns (uint256 positionId) {
		positionId = ++positionCount;
		Amounts memory previous = _range(positionId - _lowBit(positionId) + 1, positionId - 1);
		tree[positionId] = previous;
	}

	/// @notice Record one owner's new reserve balance. Its old interval still receives late recoveries.
	function setOwnerBalance(address owner, uint256 generation, uint256 shares) external onlyPortfolio {
		require(generation > 0 && !closedGenerations[generation], 'Generation is closed');
		require(shares <= PRECISION, 'Recovery share precision exceeded');
		uint256 openId = openIntervals[owner];
		if (openId > 0) {
			Interval storage previous = ownerIntervals[owner][openId - 1];
			if (previous.generation == generation) {
				if (previous.startPosition > positionCount) {
					previous.shares = shares;
					if (shares == 0) {
						previous.active = false;
						delete openIntervals[owner];
					}
					return;
				}
				previous.endPosition = positionCount;
				previous.open = false;
			} else require(closedGenerations[previous.generation], 'Previous generation is open');
			delete openIntervals[owner];
		}
		if (shares > 0) _appendInterval(owner, generation, positionCount + 1, 0, shares, true);
	}

	/// @notice End every open interval of a depleted reserve generation with one write.
	function closeGeneration(uint256 generation) external onlyPortfolio {
		require(generation > 0 && !closedGenerations[generation], 'Generation is closed');
		closedGenerations[generation] = true;
		generationEnds[generation] = positionCount;
	}

	/// @notice Credit cash already held by the portfolio, using the allocation's remaining owners.
	function credit(uint256 positionId, uint256 rep, uint256 eth, uint256 remainingShares) external onlyPortfolio {
		require(positionId > 0 && positionId <= positionCount, 'Unknown allocation position');
		require(remainingShares > 0 && remainingShares <= PRECISION, 'Invalid recovery denominator');
		DistributionCarry storage carry = distributionCarries[positionId];
		if (carry.denominator == 0) carry.denominator = remainingShares;
		require(carry.denominator == remainingShares, 'Recovery ownership denominator changed');
		uint256 repIndex;
		uint256 feeIndex;
		(repIndex, carry.rep) = _indexDelta(rep, remainingShares, carry.rep);
		(feeIndex, carry.eth) = _indexDelta(eth, remainingShares, carry.eth);
		for (uint256 index = positionId; index <= positionCount; index += _lowBit(index)) {
			tree[index].rep += repIndex;
			tree[index].eth += feeIndex;
		}
	}

	/// @notice Settle caller-selected personal intervals and return all already credited whole proceeds.
	/// @dev The portfolio owns authorization and transfers. IDs must be strictly increasing.
	function claim(address owner, uint256[] calldata intervalIds) external onlyPortfolio returns (uint256 rep, uint256 eth) {
		for (uint256 index; index < intervalIds.length; index++) {
			require(index == 0 || intervalIds[index] > intervalIds[index - 1], 'Choose increasing owner intervals');
			_settle(owner, intervalIds[index]);
		}
		Credits storage account = ownerCredits[owner];
		rep = account.rep;
		eth = account.eth;
		account.rep = 0;
		account.eth = 0;
	}

	/// @notice Exact whole proceeds of a claim, including previously credited cash and fractional carry.
	function previewClaim(address owner, uint256[] calldata intervalIds) external view returns (uint256 rep, uint256 eth) {
		Credits memory account = ownerCredits[owner];
		for (uint256 index; index < intervalIds.length; index++) {
			require(index == 0 || intervalIds[index] > intervalIds[index - 1], 'Choose increasing owner intervals');
			Interval storage interval = _interval(owner, intervalIds[index]);
			Amounts memory indexes = _range(interval.startPosition, _end(interval));
			uint256 addedRep;
			uint256 addedEth;
			(addedRep, account.repRemainder) = _ownerDelta(interval.shares, indexes.rep - interval.repIndex, account.repRemainder);
			(addedEth, account.feeRemainder) = _ownerDelta(interval.shares, indexes.eth - interval.feeIndex, account.feeRemainder);
			account.rep += addedRep;
			account.eth += addedEth;
		}
		return (account.rep, account.eth);
	}

	/// @notice Remove an owner-selected in-kind allocation while preserving all its previous cash rewards.
	/// @dev The portfolio must first harvest that allocation using the old remaining-share denominator.
	function excludePosition(address owner, uint256 intervalId, uint256 positionId) external onlyPortfolio returns (uint256 shares) {
		Interval storage source = _interval(owner, intervalId);
		uint256 end = _end(source);
		require(positionId >= source.startPosition && positionId <= end, 'Allocation outside owner interval');
		_settle(owner, intervalId);
		Interval memory previous = source;
		shares = previous.shares;
		_excludeCarry(owner, positionId, shares);
		source.active = false;
		if (openIntervals[owner] == intervalId + 1) delete openIntervals[owner];
		if (positionId > previous.startPosition)
			_appendInterval(owner, previous.generation, previous.startPosition, positionId - 1, shares, false);
		bool remainsOpen = previous.open && !closedGenerations[previous.generation];
		if (positionId < end || remainsOpen)
			_appendInterval(owner, previous.generation, positionId + 1, end, shares, remainsOpen);
	}

	function _excludeCarry(address owner, uint256 positionId, uint256 shares) private {
		DistributionCarry storage carry = distributionCarries[positionId];
		if (carry.denominator == 0) return;
		require(shares <= carry.denominator, 'Recovery ownership shares exceeded');
		// The index division remainder is scaled cash owned by this allocation. Transfer
		// the departing owner's fraction before reducing the denominator; the final owner
		// receives every remaining fraction rather than losing a whole atto to two floors.
		uint256 repFraction = Math.mulDiv(carry.rep, shares, carry.denominator);
		uint256 ethFraction = Math.mulDiv(carry.eth, shares, carry.denominator);
		carry.rep -= repFraction;
		carry.eth -= ethFraction;
		carry.denominator -= shares;
		Credits storage account = ownerCredits[owner];
		uint256 rep;
		uint256 eth;
		(rep, account.repRemainder) = _ownerDelta(1, repFraction, account.repRemainder);
		(eth, account.feeRemainder) = _ownerDelta(1, ethFraction, account.feeRemainder);
		account.rep += rep;
		account.eth += eth;
	}

	function getOwnerIntervalCount(address owner) external view returns (uint256) {
		return ownerIntervals[owner].length;
	}

	function getOwnerInterval(address owner, uint256 intervalId) external view returns (Interval memory interval) {
		require(intervalId < ownerIntervals[owner].length, 'Unknown owner interval');
		interval = ownerIntervals[owner][intervalId];
		if (interval.open && closedGenerations[interval.generation]) {
			interval.open = false;
			interval.endPosition = generationEnds[interval.generation];
		}
	}

	/// @notice Whole uncollected proceeds of this interval; account-level fractional carry is separate.
	function claimableInterval(address owner, uint256 intervalId) external view returns (uint256 rep, uint256 eth) {
		Interval storage interval = _interval(owner, intervalId);
		Amounts memory indexes = _range(interval.startPosition, _end(interval));
		rep = Math.mulDiv(interval.shares, indexes.rep - interval.repIndex, PRECISION);
		eth = Math.mulDiv(interval.shares, indexes.eth - interval.feeIndex, PRECISION);
	}

	function _appendInterval(address owner, uint256 generation, uint256 start, uint256 end, uint256 shares, bool isOpen) private {
		Amounts memory indexes = _range(start, isOpen ? positionCount : end);
		ownerIntervals[owner].push(Interval(generation, start, end, shares, indexes.rep, indexes.eth, isOpen, true));
		if (isOpen) openIntervals[owner] = ownerIntervals[owner].length;
	}

	function _settle(address owner, uint256 intervalId) private {
		Interval storage interval = _interval(owner, intervalId);
		Amounts memory indexes = _range(interval.startPosition, _end(interval));
		Credits storage account = ownerCredits[owner];
		uint256 rep;
		uint256 eth;
		(rep, account.repRemainder) = _ownerDelta(interval.shares, indexes.rep - interval.repIndex, account.repRemainder);
		(eth, account.feeRemainder) = _ownerDelta(interval.shares, indexes.eth - interval.feeIndex, account.feeRemainder);
		account.rep += rep;
		account.eth += eth;
		interval.repIndex = indexes.rep;
		interval.feeIndex = indexes.eth;
	}

	function _interval(address owner, uint256 intervalId) private view returns (Interval storage interval) {
		require(intervalId < ownerIntervals[owner].length, 'Unknown owner interval');
		interval = ownerIntervals[owner][intervalId];
		require(interval.active, 'Owner interval retired');
	}

	function _end(Interval storage interval) private view returns (uint256) {
		if (!interval.open) return interval.endPosition;
		return closedGenerations[interval.generation] ? generationEnds[interval.generation] : positionCount;
	}

	function _range(uint256 start, uint256 end) private view returns (Amounts memory amount) {
		if (start > end) return amount;
		amount = _prefix(end);
		Amounts memory before = _prefix(start - 1);
		amount.rep -= before.rep;
		amount.eth -= before.eth;
	}

	function _prefix(uint256 index) private view returns (Amounts memory amount) {
		for (; index > 0; index -= _lowBit(index)) {
			amount.rep += tree[index].rep;
			amount.eth += tree[index].eth;
		}
	}

	function _lowBit(uint256 index) private pure returns (uint256) {
		return index & (~index + 1);
	}

	function _indexDelta(uint256 amount, uint256 denominator, uint256 carry) private pure returns (uint256 index, uint256 remainder) {
		uint256 combined = mulmod(amount, PRECISION, denominator) + carry;
		index = Math.mulDiv(amount, PRECISION, denominator) + combined / denominator;
		remainder = combined % denominator;
	}

	function _ownerDelta(uint256 shares, uint256 index, uint256 carry) private pure returns (uint256 amount, uint256 remainder) {
		uint256 combined = mulmod(shares, index, PRECISION) + carry;
		amount = Math.mulDiv(shares, index, PRECISION) + combined / PRECISION;
		remainder = combined % PRECISION;
	}
}
