// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCreationCode } from '../../statoblast/SecurityPoolCreationCode.sol';

/// @notice Aggregates shared-pool releases and fee rate changes by portfolio-clock tick.
/// @dev The controller authenticates question deltas, funds fees, and owns all custody.
contract SecurityPoolTickCalendar {
	uint256 private constant SCHEDULING_WINDOW = 64 days;
	uint256 private constant SNAPSHOT_TICK_BYTES = 64;

	struct Tick {
		uint128 settlement;
		uint128 reporter;
		int256 feeRateDelta;
	}

	struct TickOverride {
		Tick value;
		bool written;
	}

	struct Book {
		uint64 cursor;
		uint128 liveSettlement;
		uint128 liveReporter;
		uint256 feeRate;
		uint256 accruedFees;
		bool initialized;
		bool frozen;
		address inheritedSchedule;
		uint64 inheritedCursor;
		address frozenSchedule;
	}

	address public immutable controller;
	uint48 public immutable tickSeconds;
	uint16 public immutable windowTicks;
	mapping(uint248 => Book) public books;
	mapping(uint248 => mapping(uint64 => TickOverride)) private ticks;

	constructor(address authority, uint48 cadence) {
		require(authority != address(0), 'Missing calendar controller');
		require(cadence >= 12 hours && cadence <= 2 days, 'Unsupported tick size');
		controller = authority;
		tickSeconds = cadence;
		windowTicks = uint16((SCHEDULING_WINDOW + cadence - 1) / cadence);
	}

	modifier onlyController() {
		require(msg.sender == controller, 'Only calendar controller');
		_;
	}

	function completedTick(uint48 portfolioTime) public view returns (uint64) {
		return uint64(portfolioTime / tickSeconds);
	}

	/// @notice The first boundary strictly after the last disputable second.
	function maturityTick(uint48 finalAfter) external view returns (uint64) {
		return completedTick(finalAfter) + 1;
	}

	function initialize(uint248 universe, uint48 portfolioTime) external onlyController {
		Book storage book = books[universe];
		require(!book.initialized, 'Calendar already initialized');
		book.cursor = completedTick(portfolioTime);
		book.initialized = true;
	}

	/// @notice Replace one authenticated contribution, using tick zero for unscheduled exposure.
	function replaceExposure(uint248 universe, uint48 portfolioTime, uint64 oldTick, uint64 newTick, uint128 oldSettlement, uint128 oldReporter, uint128 newSettlement, uint128 newReporter) external onlyController {
		Book storage book = _active(universe);
		_checkpoint(universe, book, completedTick(portfolioTime));
		if (oldTick != 0) {
			_requireFuture(book.cursor, oldTick);
			Tick storage previous = _editableTick(universe, book, oldTick);
			previous.settlement -= oldSettlement;
			previous.reporter -= oldReporter;
		}
		if (newTick != 0) {
			_requireFuture(book.cursor, newTick);
			Tick storage next = _editableTick(universe, book, newTick);
			next.settlement += newSettlement;
			next.reporter += newReporter;
		}
		book.liveSettlement = book.liveSettlement - oldSettlement + newSettlement;
		book.liveReporter = book.liveReporter - oldReporter + newReporter;
	}

	/// @notice Replace the net change at a future boundary. The rate is denominated in fee units per tick.
	/// @dev Every booked stream must terminate within the window. The controller must schedule both endpoints atomically.
	function changeFeePeriod(uint248 universe, uint48 portfolioTime, uint64 startTick, uint64 stopTick, int128 rateDelta) external onlyController {
		Book storage book = _active(universe);
		_checkpoint(universe, book, completedTick(portfolioTime));
		_requireFuture(book.cursor, startTick);
		_requireFuture(book.cursor, stopTick);
		require(startTick < stopTick, 'Empty fee period');
		_editableTick(universe, book, startTick).feeRateDelta += rateDelta;
		_editableTick(universe, book, stopTick).feeRateDelta -= rateDelta;
	}

	function checkpoint(uint248 universe, uint48 portfolioTime) external onlyController {
		_checkpoint(universe, _active(universe), completedTick(portfolioTime));
	}

	function freeze(uint248 universe, uint48 forkTime) external onlyController {
		Book storage root = _active(universe);
		_checkpoint(universe, root, completedTick(forkTime));
		root.frozenSchedule = _snapshot(universe, root);
		root.frozen = true;
	}

	/// @notice Import live amounts and upcoming ticks; completed ticks stay with their paying universe.
	function createChild(uint248 parent, uint248 child) external onlyController {
		Book storage source = books[parent];
		Book storage target = books[child];
		require(source.frozen && !target.initialized, 'Invalid calendar fork');
		target.initialized = true;
		target.cursor = source.cursor;
		target.liveSettlement = source.liveSettlement;
		target.liveReporter = source.liveReporter;
		target.feeRate = source.feeRate;
		target.inheritedSchedule = source.frozenSchedule;
		target.inheritedCursor = source.cursor;
	}

	function settledExposure(uint248 universe, uint64 tick) external view returns (uint128 settlement, uint128 reporter) {
		Book storage book = books[universe];
		require(book.initialized && tick <= book.cursor, 'Tick not settled');
		Tick memory closed = _readTick(universe, book, tick);
		return (closed.settlement, closed.reporter);
	}

	/// @dev An inert runtime code store holds the fixed-size future schedule. A child
	/// can read it directly even if the source inherited every tick from its own parent.
	function _snapshot(uint248 universe, Book storage book) private returns (address) {
		bytes memory data = new bytes(1 + uint256(windowTicks) * SNAPSHOT_TICK_BYTES);
		for (uint256 index = 0; index < windowTicks; ++index) {
			Tick memory tick = _readTick(universe, book, book.cursor + uint64(index) + 1);
			uint256 amounts = (uint256(tick.reporter) << 128) | tick.settlement;
			int256 rate = tick.feeRateDelta;
			uint256 offset = 1 + index * SNAPSHOT_TICK_BYTES;
			assembly ('memory-safe') {
				let destination := add(add(data, 32), offset)
				mstore(destination, amounts)
				mstore(add(destination, 32), rate)
			}
		}
		return address(new SecurityPoolCreationCode(data));
	}

	function _inheritedTick(Book storage book, uint64 tick) private view returns (Tick memory result) {
		address schedule = book.inheritedSchedule;
		uint64 cursor = book.inheritedCursor;
		if (schedule == address(0) || tick <= cursor || tick > cursor + windowTicks) return result;
		uint256 offset = 1 + uint256(tick - cursor - 1) * SNAPSHOT_TICK_BYTES;
		uint256 amounts;
		int256 rate;
		assembly ('memory-safe') {
			let scratch := mload(0x40)
			extcodecopy(schedule, scratch, offset, 64)
			amounts := mload(scratch)
			rate := mload(add(scratch, 32))
		}
		return Tick(uint128(amounts), uint128(amounts >> 128), rate);
	}

	function _readTick(uint248 universe, Book storage book, uint64 tick) private view returns (Tick memory inherited) {
		TickOverride storage local = ticks[universe][tick];
		Tick memory stored = local.value;
		inherited = _inheritedTick(book, tick);
		bool written = local.written;
		// Select the three stored words with the same instructions for every tick.
		assembly ('memory-safe') {
			let mask := sub(0, written)
			let first := mload(inherited)
			let second := mload(add(inherited, 32))
			let third := mload(add(inherited, 64))
			mstore(inherited, xor(first, and(mask, xor(first, mload(stored)))))
			mstore(add(inherited, 32), xor(second, and(mask, xor(second, mload(add(stored, 32))))))
			mstore(add(inherited, 64), xor(third, and(mask, xor(third, mload(add(stored, 64))))))
		}
	}

	function _editableTick(uint248 universe, Book storage book, uint64 tick) private returns (Tick storage) {
		TickOverride storage local = ticks[universe][tick];
		if (!local.written) {
			local.value = _inheritedTick(book, tick);
			local.written = true;
		}
		return local.value;
	}

	function _active(uint248 universe) private view returns (Book storage book) {
		book = books[universe];
		require(book.initialized && !book.frozen, 'Calendar not active');
	}

	function _requireFuture(uint64 cursor, uint64 tick) private view {
		require(tick > cursor && tick <= cursor + windowTicks, 'Tick outside scheduling window');
	}

	function _checkpoint(uint248 universe, Book storage book, uint64 through) private {
		uint64 cursor = book.cursor;
		require(through >= cursor, 'Calendar clock moved backwards');
		if (through == cursor) return;
		uint64 lastPossible = cursor + windowTicks;
		uint64 end = through < lastPossible ? through : lastPossible;
		uint256 fees = book.accruedFees;
		uint256 rate = book.feeRate;
		uint128 releasedSettlement;
		uint128 releasedReporter;
		for (uint64 tick = cursor + 1; tick <= end; ++tick) {
			Tick memory crossed = _readTick(universe, book, tick);
			fees += rate;
			rate = uint256(int256(rate) + crossed.feeRateDelta);
			require(rate <= uint256(type(int256).max), 'Negative calendar fee rate');
			releasedSettlement += crossed.settlement;
			releasedReporter += crossed.reporter;
		}
		require(through < lastPossible || rate == 0, 'Calendar fee period overrun');
		book.cursor = through;
		book.liveSettlement -= releasedSettlement;
		book.liveReporter -= releasedReporter;
		book.feeRate = rate;
		book.accruedFees = fees;
	}
}
