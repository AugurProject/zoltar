// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Aggregate recovery accounting for allocation-time ownership, without holding assets.
/// @dev A point-updated Fenwick tree lets each owner collect a balance-constant interval of allocations.
/// Other owners' activity and additional questions never create intervals for an existing owner.
contract SecurityPoolPortfolioRecovery {
	uint256 private constant PRECISION = 1e36;
	address public immutable portfolio;
	bool public immutable fixedOwnership;
	bool public importsSealed;
	mapping(uint256 => int256) private ownershipTree;
	uint256 public positionCount;
	uint256 public unfinishedPositionCount;
	mapping(uint256 => Amounts) private tree;
	mapping(uint256 => uint256) private completedTree;
	mapping(uint256 => bool) public positionComplete;
	mapping(uint256 => DistributionCarry) private distributionCarries;
	mapping(uint256 => uint256) private generationEnds;
	mapping(uint256 => bool) private closedGenerations;
	mapping(address => Interval[]) private ownerIntervals;
	mapping(address => uint256) private openIntervals;
	mapping(address => Credits) public ownerCredits;
	mapping(address => ActiveList) private activeIntervals;
	mapping(address => mapping(uint256 => Links)) private intervalLinks;
	uint256 private ownershipVersion = 1;
	uint256 private nextOwnershipVersion = 1;
	OwnershipCheckpoint private ownershipCheckpoint;
	uint256 private maintenanceIndex;
	mapping(uint256 => MaintenancePosition) private maintenancePositions;

	struct MaintenancePosition {
		uint256 entryIndex;
		uint256 terminalIndex;
		bool taken;
	}

	struct OwnershipCheckpoint {
		address owner;
		uint256 generation;
		uint256 initialBalance;
		uint256 initialVersion;
	}

	struct ActiveList {
		uint256 first;
		uint256 last;
		uint256 count;
	}

	struct Links {
		uint256 previous;
		uint256 next;
	}

	event PositionCompleted(uint256 indexed positionId);
	event OwnerIntervalRetired(address indexed owner, uint256 indexed intervalId);

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

	constructor(address authority, uint256 initialPositionCount, bool _fixedOwnership) {
		require(authority != address(0), 'Invalid recovery authority');
		require(_fixedOwnership || initialPositionCount == 0, 'Growing recovery must start empty');
		portfolio = authority;
		positionCount = initialPositionCount;
		unfinishedPositionCount = initialPositionCount;
		fixedOwnership = _fixedOwnership;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	/// @notice Import one frozen owner interval before any branch recovery can be credited.
	/// @dev The controller proves the owner and source interval, and prevents duplicate enrollment.
	function importInterval(address owner, uint256 start, uint256 end, uint256 shares) external onlyPortfolio returns (uint256 intervalId) {
		require(fixedOwnership && !importsSealed, 'Fork imports sealed');
		require(owner != address(0) && start > 0 && start <= end && end <= positionCount, 'Invalid imported interval');
		require(shares > 0 && shares <= PRECISION, 'Invalid imported shares');
		intervalId = ownerIntervals[owner].length;
		_appendInterval(owner, 0, start, end, shares, false);
		_changeWeight(start, end, int256(shares));
	}

	/// @notice Revoke a not-yet-frozen branch choice without changing any other owner's history.
	function retireImportedInterval(address owner, uint256 intervalId) external onlyPortfolio {
		require(fixedOwnership && !importsSealed, 'Fork imports sealed');
		Interval storage interval = _interval(owner, intervalId);
		_retireInterval(owner, intervalId);
		_changeWeight(interval.startPosition, interval.endPosition, -int256(interval.shares));
	}

	/// @notice Freeze imports before migration or cash recovery; repeat calls are harmless.
	function sealImports() external onlyPortfolio {
		require(fixedOwnership, 'Growing recovery ownership');
		importsSealed = true;
	}

	/// @notice Aggregate logical owner shares at one allocation, independent of other branches.
	function getPointShares(uint256 positionId) public view returns (uint256) {
		require(fixedOwnership, 'Growing recovery ownership');
		require(positionId > 0 && positionId <= positionCount, 'Unknown allocation position');
		int256 shares;
		for (uint256 index = positionId; index > 0; index -= _lowBit(index)) shares += ownershipTree[index];
		require(shares >= 0 && uint256(shares) <= PRECISION, 'Invalid recovery ownership weight');
		return uint256(shares);
	}

	function _changeWeight(uint256 start, uint256 end, int256 delta) private {
		_updateWeight(start, delta);
		if (end < positionCount) _updateWeight(end + 1, -delta);
	}

	function _updateWeight(uint256 index, int256 delta) private {
		while (index <= positionCount) {
			ownershipTree[index] += delta;
			uint256 step = _lowBit(index);
			if (step > positionCount - index) break;
			index += step;
		}
	}

	/// @notice Append a zero-valued point, retaining old recoveries in newly created tree ancestors.
	function appendPosition() external onlyPortfolio returns (uint256 positionId) {
		require(!fixedOwnership, 'Fixed recovery ownership');
		positionId = ++positionCount;
		unfinishedPositionCount++;
		maintenancePositions[positionId].entryIndex = maintenanceIndex;
		Amounts memory previous = _range(positionId - _lowBit(positionId) + 1, positionId - 1);
		tree[positionId] = previous;
		completedTree[positionId] = _completedRange(positionId - _lowBit(positionId) + 1, positionId - 1);
	}

	/// @notice Declare an allocation terminal after every final cash credit and liability transfer.
	/// @dev Source completion does not complete descendant positions, whose ledgers remain independent.
	function markPositionComplete(uint256 positionId) external onlyPortfolio {
		require(positionId > 0 && positionId <= positionCount, 'Unknown allocation position');
		if (fixedOwnership) require(importsSealed, 'Fork imports not sealed');
		if (positionComplete[positionId]) return;
		positionComplete[positionId] = true;
		unfinishedPositionCount--;
		maintenancePositions[positionId].terminalIndex = maintenanceIndex;
		uint256 index = positionId;
		while (index <= positionCount) {
			completedTree[index] += 1;
			uint256 step = _lowBit(index);
			if (step > positionCount - index) break;
			index += step;
		}
		emit PositionCompleted(positionId);
	}

	/// @notice Fund only allocations unfinished at fee receipt; new allocations cannot capture old fees.
	function creditMaintenance(uint256 amount) external onlyPortfolio {
		if (amount == 0) return;
		require(unfinishedPositionCount > 0, 'No unfinished allocations');
		maintenanceIndex += Math.mulDiv(amount, PRECISION, unfinishedPositionCount);
	}

	/// @notice Consume one allocation's capped maintenance entitlement during its completion transaction.
	/// @dev Completion may precede or follow this call. A terminal snapshot excludes any later fees.
	/// Rounding and amounts above the cap remain unallocated; they never become newcomers' rewards.
	function takeMaintenanceReward(uint256 positionId, uint256 cap) external onlyPortfolio returns (uint256) {
		require(positionId > 0 && positionId <= positionCount, 'Unknown allocation position');
		MaintenancePosition storage position = maintenancePositions[positionId];
		if (position.taken) return 0;
		position.taken = true;
		uint256 endIndex = positionComplete[positionId] ? position.terminalIndex : maintenanceIndex;
		return Math.min((endIndex - position.entryIndex) / PRECISION, cap);
	}

	/// @notice Record one owner's new reserve balance. Its old interval still receives late recoveries.
	function setOwnerBalance(address owner, uint256 generation, uint256 shares) external onlyPortfolio returns (uint256) {
		require(!fixedOwnership, 'Fixed recovery ownership');
		require(generation > 0, 'Invalid reserve generation');
		require(shares <= PRECISION, 'Recovery share precision exceeded');
		// A fork freezes allocation rights while idle reserve balances may still be withdrawn.
		if (closedGenerations[generation]) return ownershipVersion;
		uint256 openId = openIntervals[owner];
		uint256 previousBalance =
			openId > 0 && ownerIntervals[owner][openId - 1].generation == generation
				? ownerIntervals[owner][openId - 1].shares
				: 0;
		_changeOwnership(owner, generation, previousBalance, shares);
		if (openId > 0) {
			Interval storage previous = ownerIntervals[owner][openId - 1];
			if (previous.generation == generation) {
				if (previous.startPosition > positionCount) {
					previous.shares = shares;
					if (shares == 0) {
						_retireInterval(owner, openId - 1);
					}
					return ownershipVersion;
				}
				previous.endPosition = positionCount;
				previous.open = false;
			} else require(closedGenerations[previous.generation], 'Previous generation is open');
			delete openIntervals[owner];
		}
		if (shares > 0) _appendInterval(owner, generation, positionCount + 1, 0, shares, true);
		return ownershipVersion;
	}

	/// @dev A consecutive same-owner round trip restores its proven earlier cohort without a scan.
	/// New cohorts get unique versions so a transient cohort never matches an unrelated allocation.
	function _changeOwnership(address owner, uint256 generation, uint256 previousBalance, uint256 nextBalance) private {
		if (previousBalance == nextBalance) return;
		if (ownershipCheckpoint.owner != owner || ownershipCheckpoint.generation != generation)
			ownershipCheckpoint = OwnershipCheckpoint(owner, generation, previousBalance, ownershipVersion);
		ownershipVersion =
			nextBalance == ownershipCheckpoint.initialBalance
				? ownershipCheckpoint.initialVersion
				: ++nextOwnershipVersion;
	}

	/// @notice Freeze allocation rights of a depleted or forked reserve generation without visiting owners.
	function closeGeneration(uint256 generation) external onlyPortfolio returns (uint256) {
		require(!fixedOwnership, 'Fixed recovery ownership');
		require(generation > 0, 'Invalid reserve generation');
		if (closedGenerations[generation]) return ownershipVersion;
		closedGenerations[generation] = true;
		generationEnds[generation] = positionCount;
		delete ownershipCheckpoint;
		ownershipVersion = ++nextOwnershipVersion;
		return ownershipVersion;
	}

	/// @notice Credit cash already held by the portfolio, using the allocation's remaining owners.
	function credit(uint256 positionId, uint256 rep, uint256 eth, uint256 remainingShares) external onlyPortfolio {
		require(positionId > 0 && positionId <= positionCount, 'Unknown allocation position');
		require(!positionComplete[positionId], 'Allocation recovery is complete');
		require(remainingShares > 0 && remainingShares <= PRECISION, 'Invalid recovery denominator');
		if (fixedOwnership) {
			require(importsSealed, 'Fork imports not sealed');
			require(remainingShares == getPointShares(positionId), 'Recovery cohort shares mismatch');
		}
		DistributionCarry storage carry = distributionCarries[positionId];
		if (carry.denominator == 0) carry.denominator = remainingShares;
		require(carry.denominator == remainingShares, 'Recovery ownership denominator changed');
		uint256 repIndex;
		uint256 feeIndex;
		(repIndex, carry.rep) = _indexDelta(rep, remainingShares, carry.rep);
		(feeIndex, carry.eth) = _indexDelta(eth, remainingShares, carry.eth);
		uint256 index = positionId;
		while (index <= positionCount) {
			tree[index].rep += repIndex;
			tree[index].eth += feeIndex;
			uint256 step = _lowBit(index);
			if (step > positionCount - index) break;
			index += step;
		}
	}

	/// @notice Settle caller-selected personal intervals and return all already credited whole proceeds.
	/// @dev The portfolio owns authorization and transfers. IDs must be strictly increasing.
	function claim(address owner, uint256[] calldata intervalIds) external onlyPortfolio returns (uint256 rep, uint256 eth, bool retired) {
		for (uint256 index; index < intervalIds.length; index++) {
			require(index == 0 || intervalIds[index] > intervalIds[index - 1], 'Choose increasing owner intervals');
			_settle(owner, intervalIds[index]);
			if (canRetireOwnerInterval(owner, intervalIds[index])) {
				_retireInterval(owner, intervalIds[index]);
				retired = true;
			}
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
		if (fixedOwnership) require(importsSealed, 'Fork imports not sealed');
		Interval storage source = _interval(owner, intervalId);
		uint256 end = _end(source);
		require(positionId >= source.startPosition && positionId <= end, 'Allocation outside owner interval');
		_settle(owner, intervalId);
		Interval memory previous = source;
		shares = previous.shares;
		_excludeCarry(owner, positionId, shares);
		if (fixedOwnership) _changeWeight(positionId, positionId, -int256(shares));
		_retireInterval(owner, intervalId);
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

	function getOwnerActiveIntervalCount(address owner) external view returns (uint256) {
		return activeIntervals[owner].count;
	}

	/// @notice Whether settling this interval can retire it, including a claim with no whole proceeds.
	function canRetireOwnerInterval(address owner, uint256 intervalId) public view returns (bool) {
		require(intervalId < ownerIntervals[owner].length, 'Unknown owner interval');
		Interval storage interval = ownerIntervals[owner][intervalId];
		return
			interval.active &&
			(!interval.open || closedGenerations[interval.generation]) &&
			_rangeComplete(interval.startPosition, _end(interval));
	}

	/// @notice Read only active intervals, visiting at most count nodes regardless of retired history.
	/// @dev Cursor zero starts at the head. Nonzero cursors are interval IDs plus one; returned zero ends.
	/// A cursor retired since the previous page must be restarted rather than scanning removed history.
	function getOwnerActiveIntervals(address owner, uint256 cursor, uint256 count) external view returns (uint256[] memory intervalIds, uint256 nextCursor) {
		require(count > 0, 'Choose positive interval page size');
		if (cursor != 0) {
			require(cursor <= ownerIntervals[owner].length && ownerIntervals[owner][cursor - 1].active, 'Owner interval cursor retired');
		}
		nextCursor = cursor == 0 ? activeIntervals[owner].first : cursor;
		uint256 capacity = count < activeIntervals[owner].count ? count : activeIntervals[owner].count;
		intervalIds = new uint256[](capacity);
		uint256 length;
		while (nextCursor != 0 && length < capacity) {
			intervalIds[length++] = nextCursor - 1;
			nextCursor = intervalLinks[owner][nextCursor].next;
		}
		assembly ('memory-safe') {
			mstore(intervalIds, length)
		}
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
		uint256 node = ownerIntervals[owner].length;
		ActiveList storage list = activeIntervals[owner];
		intervalLinks[owner][node].previous = list.last;
		if (list.last == 0) list.first = node;
		else intervalLinks[owner][list.last].next = node;
		list.last = node;
		list.count++;
		if (isOpen) openIntervals[owner] = node;
	}

	function _retireInterval(address owner, uint256 intervalId) private {
		ownerIntervals[owner][intervalId].active = false;
		uint256 node = intervalId + 1;
		Links memory links = intervalLinks[owner][node];
		ActiveList storage list = activeIntervals[owner];
		if (links.previous == 0) list.first = links.next;
		else intervalLinks[owner][links.previous].next = links.next;
		if (links.next == 0) list.last = links.previous;
		else intervalLinks[owner][links.next].previous = links.previous;
		delete intervalLinks[owner][node];
		list.count--;
		if (openIntervals[owner] == node) delete openIntervals[owner];
		emit OwnerIntervalRetired(owner, intervalId);
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

	function _rangeComplete(uint256 start, uint256 end) private view returns (bool) {
		return start > end || _completedRange(start, end) == end - start + 1;
	}

	function _completedRange(uint256 start, uint256 end) private view returns (uint256) {
		return start > end ? 0 : _completedPrefix(end) - _completedPrefix(start - 1);
	}

	function _completedPrefix(uint256 index) private view returns (uint256 completed) {
		for (; index > 0; index -= _lowBit(index)) completed += completedTree[index];
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
