// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface ICapitalFeeEligibility {
	function eligibleCommitment(uint256 price) external view returns (uint256);
}

/// @notice Exact vesting of independently funded ETH and REP fee budgets.
/// @dev The authority holds the tokens. Nothing here transfers assets or visits
/// an old stream. Income follows an integer rate plus its exact remainder at the
/// original end time. Later funding never accelerates an existing stream.
contract SecurityPoolCapitalFeeStreams {
	uint256 private constant MAX_TIMESTAMP = type(uint48).max;
	uint256 private constant MAX_OUTSTANDING = type(uint128).max;
	address public immutable portfolio;
	uint48 public immutable rewardDuration;
	uint48 public releasedThrough;
	uint48 private lastExpiryId;
	uint48 private releasedExpiryId;
	uint256 public outstandingEth;
	uint256 public outstandingRep;
	uint256 public deferredEth;
	uint256 public deferredRep;
	uint256 private lastEthIntegral;
	uint256 private lastRepIntegral;

	struct Expiry {
		uint48 end;
		uint256 ethRate;
		uint256 repRate;
		uint256 ethIntegral;
		uint256 repIntegral;
	}
	mapping(uint48 => Expiry) private expiries;
	event DeferredFeesResumed(uint256 ethAmount, uint256 repAmount);

	constructor(address authority, uint48 timestamp, uint48 vestingDuration) {
		require(authority != address(0), 'Invalid fee authority');
		require(timestamp <= block.timestamp, 'Future fee checkpoint');
		require(vestingDuration != 0, 'Invalid fee duration');
		portfolio = authority;
		rewardDuration = vestingDuration;
		releasedThrough = timestamp;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	/// @dev The caller must allocate all older income before it funds a new stream.
	/// One checkpoint per wall-clock second is sufficient, regardless of calls.
	function addStream(uint256 ethAmount, uint256 repAmount) external onlyPortfolio {
		_addStream(ethAmount, repAmount);
	}

	/// @notice Unallocatable income stays funded and resumes only as future income.
	function defer(uint256 ethAmount, uint256 repAmount) external onlyPortfolio {
		deferredEth += ethAmount;
		deferredRep += repAmount;
		_requireBudget();
	}

	/// @dev Called after the authority checkpoints old eligibility. Repeated calls
	/// cannot restart an existing stream or award past income to a new commitment.
	function resume(ICapitalFeeEligibility index, uint256 price) external onlyPortfolio {
		uint256 ethAmount = deferredEth;
		uint256 repAmount = deferredRep;
		if ((ethAmount == 0 && repAmount == 0) || index.eligibleCommitment(price) == 0) return;
		deferredEth = 0;
		deferredRep = 0;
		_addStream(ethAmount, repAmount);
		emit DeferredFeesResumed(ethAmount, repAmount);
	}

	function _requireBudget() private view {
		require(outstandingEth + deferredEth <= MAX_OUTSTANDING && outstandingRep + deferredRep <= MAX_OUTSTANDING, 'Fee budget exceeds token domain');
	}

	function _addStream(uint256 ethAmount, uint256 repAmount) private {
		require(releasedThrough == block.timestamp, 'Checkpoint fees before funding');
		require(uint256(releasedThrough) + rewardDuration <= MAX_TIMESTAMP, 'Invalid fee duration');
		require(ethAmount != 0 || repAmount != 0, 'Empty fee stream');
		outstandingEth += ethAmount;
		outstandingRep += repAmount;
		_requireBudget();
		uint256 ethRate = ethAmount / rewardDuration;
		uint256 repRate = repAmount / rewardDuration;
		uint48 end = releasedThrough + rewardDuration;
		Expiry memory previous = expiries[lastExpiryId];
		if (previous.end != end) ++lastExpiryId;
		expiries[lastExpiryId] = Expiry(end, previous.ethRate + ethRate, previous.repRate + repRate, previous.ethIntegral + ethRate * end + (ethAmount % rewardDuration), previous.repIntegral + repRate * end + (repAmount % rewardDuration));
		lastEthIntegral += ethRate * releasedThrough;
		lastRepIntegral += repRate * releasedThrough;
	}

	/// @notice Return income earned since the previous checkpoint. The authority
	/// may split one wall-clock interval at an exact oracle expiry before release.
	function release(uint48 until) public onlyPortfolio returns (uint256 ethAmount, uint256 repAmount) {
		require(until <= block.timestamp, 'Future fee checkpoint');
		uint48 expiredId;
		(ethAmount, repAmount, expiredId) = _preview(until);
		lastEthIntegral += ethAmount;
		lastRepIntegral += repAmount;
		outstandingEth -= ethAmount;
		outstandingRep -= repAmount;
		releasedThrough = until;
		releasedExpiryId = expiredId;
	}

	/// @notice Checkpoint old eligibility before the authority changes it. Stale
	/// elapsed income stays funded separately from the amount returned for credit.
	function checkpoint(uint48 eligibleThrough) external onlyPortfolio returns (uint256 ethAmount, uint256 repAmount) {
		if (eligibleThrough > releasedThrough) (ethAmount, repAmount) = release(eligibleThrough);
		if (block.timestamp > releasedThrough) {
			(uint256 staleEth, uint256 staleRep) = release(uint48(block.timestamp));
			deferredEth += staleEth;
			deferredRep += staleRep;
		}
	}

	/// @dev Only the authority can withdraw deferred accounting, after a fork
	/// fixes eligibility permanently. It must burn exactly the returned amounts.
	function takeDeferred() external onlyPortfolio returns (uint256 ethAmount, uint256 repAmount) {
		ethAmount = deferredEth;
		repAmount = deferredRep;
		deferredEth = 0;
		deferredRep = 0;
	}

	/// @dev Future quote times are permitted. They do not release any assets.
	function preview(uint48 until) public view returns (uint256 ethAmount, uint256 repAmount) {
		(ethAmount, repAmount, ) = _preview(until);
	}

	function _preview(uint48 until) private view returns (uint256 ethAmount, uint256 repAmount, uint48 expiredId) {
		require(until >= releasedThrough, 'Fee time moved backwards');
		expiredId = _expired(until);
		(uint256 ethIntegral, uint256 repIntegral) = _integral(until, expiredId);
		return (ethIntegral - lastEthIntegral, repIntegral - lastRepIntegral, expiredId);
	}

	function fundedOutstanding() external view returns (uint256 ethAmount, uint256 repAmount) {
		return (outstandingEth, outstandingRep);
	}

	/// @dev The immutable horizon orders every funded expiry. Funding appends or
	/// merges one cumulative checkpoint; it never writes a path or migrates history.
	/// Strictly increasing nonzero uint48 ends allow at most 2^48-1 checkpoints,
	/// so binary search makes at most 48 probes. Its lower bound skips all settled
	/// history; only the fixed horizon's still-unreleased checkpoints are searched.
	/// The uint128 outstanding domain and minimum one-second duration bound
	/// lifetime rates below 2^176 and weighted integrals below 2^224, even with reuse.
	function _integral(uint48 timestamp, uint48 expiredId) private view returns (uint256 ethIntegral, uint256 repIntegral) {
		Expiry storage latest = expiries[lastExpiryId];
		Expiry storage expired = expiries[expiredId];
		ethIntegral = (latest.ethRate - expired.ethRate) * timestamp + expired.ethIntegral;
		repIntegral = (latest.repRate - expired.repRate) * timestamp + expired.repIntegral;
	}

	function _expired(uint48 timestamp) private view returns (uint48) {
		uint48 high = lastExpiryId;
		if (high == 0 || expiries[high].end <= timestamp) return high;
		uint48 low = releasedExpiryId + 1;
		if (expiries[low].end > timestamp) return releasedExpiryId;
		while (low < high) {
			uint48 middle = low + (high - low + 1) / 2;
			if (expiries[middle].end <= timestamp) low = middle;
			else high = middle - 1;
		}
		return low;
	}
}
