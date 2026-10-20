// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Exact vesting of independently funded ETH and REP fee budgets.
/// @dev The authority holds the tokens. Nothing here transfers assets or visits
/// an old stream. Income follows an integer rate plus its exact remainder at the
/// original end time. Later funding never accelerates an existing stream.
contract SecurityPoolCapitalFeeStreams {
	uint256 private constant MAX_TIMESTAMP = type(uint48).max;
	uint256 private constant MAX_OUTSTANDING = type(uint128).max;
	address public immutable portfolio;
	uint48 public releasedThrough;
	uint256 public outstandingEth;
	uint256 public outstandingRep;
	uint256 private aggregateEthRate;
	uint256 private aggregateRepRate;
	uint256 private lastEthIntegral;
	uint256 private lastRepIntegral;

	struct Expiry {
		uint256 ethRate;
		uint256 repRate;
		uint256 weightedEthEnd;
		uint256 weightedRepEnd;
		uint256 ethRemainder;
		uint256 repRemainder;
	}
	mapping(uint256 => Expiry) private expiries;

	constructor(address authority, uint48 timestamp) {
		require(authority != address(0), 'Invalid fee authority');
		require(timestamp <= block.timestamp, 'Future fee checkpoint');
		portfolio = authority;
		releasedThrough = timestamp;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	/// @dev The caller must allocate all older income before it funds a new stream.
	/// One checkpoint per wall-clock second is sufficient, regardless of calls.
	function addStream(uint256 ethAmount, uint256 repAmount, uint48 duration) external onlyPortfolio {
		require(releasedThrough == block.timestamp, 'Checkpoint fees before funding');
		require(duration != 0 && uint256(releasedThrough) + duration <= MAX_TIMESTAMP, 'Invalid fee duration');
		require(ethAmount != 0 || repAmount != 0, 'Empty fee stream');
		outstandingEth += ethAmount;
		outstandingRep += repAmount;
		require(outstandingEth <= MAX_OUTSTANDING && outstandingRep <= MAX_OUTSTANDING, 'Fee budget exceeds token domain');
		uint256 ethRate = ethAmount / duration;
		uint256 repRate = repAmount / duration;
		uint256 end = uint256(releasedThrough) + duration;
		uint256 weightedEth = ethRate * end;
		uint256 weightedRep = repRate * end;
		uint256 ethRemainder = ethAmount % duration;
		uint256 repRemainder = repAmount % duration;
		aggregateEthRate += ethRate;
		aggregateRepRate += repRate;
		lastEthIntegral += ethRate * releasedThrough;
		lastRepIntegral += repRate * releasedThrough;
		for (uint256 index = end; index <= MAX_TIMESTAMP; ) {
			Expiry storage entry = expiries[index];
			entry.ethRate += ethRate;
			entry.repRate += repRate;
			entry.weightedEthEnd += weightedEth;
			entry.weightedRepEnd += weightedRep;
			entry.ethRemainder += ethRemainder;
			entry.repRemainder += repRemainder;
			uint256 step = _lowBit(index);
			if (step > MAX_TIMESTAMP - index) break;
			index += step;
		}
	}

	/// @notice Return income earned since the previous checkpoint. The authority
	/// may split one wall-clock interval at an exact oracle expiry before release.
	function release(uint48 until) external onlyPortfolio returns (uint256 ethAmount, uint256 repAmount) {
		require(until <= block.timestamp, 'Future fee checkpoint');
		(ethAmount, repAmount) = preview(until);
		lastEthIntegral += ethAmount;
		lastRepIntegral += repAmount;
		outstandingEth -= ethAmount;
		outstandingRep -= repAmount;
		releasedThrough = until;
	}

	/// @dev Future quote times are permitted. They do not release any assets.
	function preview(uint48 until) public view returns (uint256 ethAmount, uint256 repAmount) {
		require(until >= releasedThrough, 'Fee time moved backwards');
		(uint256 ethIntegral, uint256 repIntegral) = _integral(until);
		return (ethIntegral - lastEthIntegral, repIntegral - lastRepIntegral);
	}

	function fundedOutstanding() external view returns (uint256 ethAmount, uint256 repAmount) {
		return (outstandingEth, outstandingRep);
	}

	/// @dev uint48 expiry trees have at most 48 ancestors. The outstanding uint128
	/// domain and minimum one-second duration bound lifetime rate sums below 2^176
	/// and timestamp-weighted sums below 2^224, including repeated funded reuse.
	function _integral(uint48 timestamp) private view returns (uint256 ethIntegral, uint256 repIntegral) {
		Expiry memory expired;
		for (uint256 index = timestamp; index != 0; index -= _lowBit(index)) {
			Expiry storage entry = expiries[index];
			expired.ethRate += entry.ethRate;
			expired.repRate += entry.repRate;
			expired.weightedEthEnd += entry.weightedEthEnd;
			expired.weightedRepEnd += entry.weightedRepEnd;
			expired.ethRemainder += entry.ethRemainder;
			expired.repRemainder += entry.repRemainder;
		}
		ethIntegral = (aggregateEthRate - expired.ethRate) * timestamp + expired.weightedEthEnd + expired.ethRemainder;
		repIntegral = (aggregateRepRate - expired.repRate) * timestamp + expired.weightedRepEnd + expired.repRemainder;
	}

	function _lowBit(uint256 value) private pure returns (uint256) {
		return value & (~value + 1);
	}
}
