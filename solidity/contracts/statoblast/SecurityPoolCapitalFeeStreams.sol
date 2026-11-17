// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Exact vesting of independently funded ETH and REP fee budgets.
/// @dev The authority holds the tokens. Nothing here transfers assets or visits
/// an old stream. Income follows an integer rate plus its exact remainder at the
/// original end time. Later funding never accelerates an existing stream.
contract SecurityPoolCapitalFeeStreams {
    uint256 private constant MAX_TIMESTAMP = type(uint48).max;
    uint256 private constant MAX_OUTSTANDING = type(uint128).max;
    /// @dev The capital ledger authorizes mutations and holds tokens; this contract only accounts for them.
    address public immutable capitalLedger;
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

    /**
     * @notice Deploys the fee‑stream manager.
     * @param authority The address of the SecurityPoolCapitalLedger that may call privileged functions.
     * @param timestamp The initial checkpoint timestamp – must be in the past or present.
     * @param vestingDuration The length of each fee‑stream in seconds.
     * @dev A new upper‑bound check is added: `timestamp + vestingDuration` must not overflow the
     *      `uint48` timestamp domain. Without this guard, a large `vestingDuration` would make
     *      `_addStream` revert on every call because `releasedThrough + rewardDuration` would exceed
     *      `type(uint48).max`. This mirrors the validation performed in `SecurityPoolPortfolio`
     *      and prevents portfolios from being instantiated with unusable reward vesting periods.
     */
    constructor(address authority, uint48 timestamp, uint48 vestingDuration) {
        require(authority != address(0), "Invalid fee authority");
        require(timestamp <= block.timestamp, "Future fee checkpoint");
        require(vestingDuration != 0, "Invalid fee duration");
        // NEW: ensure the combination of the start timestamp and the vesting duration never exceeds the uint48 ceiling.
        require(uint256(timestamp) + uint256(vestingDuration) <= MAX_TIMESTAMP, "Invalid fee duration");
        capitalLedger = authority;
        rewardDuration = vestingDuration;
        releasedThrough = timestamp;
    }

    modifier onlyCapitalLedger() {
        require(msg.sender == capitalLedger, "Only capital ledger");
        _;
    }

    /// @dev The caller must allocate all older income before it funds a new stream.
    /// One checkpoint per wall-clock second is sufficient, regardless of calls.
    function addStream(uint256 ethAmount, uint256 repAmount) external onlyCapitalLedger {
        _addStream(ethAmount, repAmount);
    }

    function _requireBudget() private view {
        require(outstandingEth + deferredEth <= MAX_OUTSTANDING && outstandingRep + deferredRep <= MAX_OUTSTANDING, "Fee budget exceeds token domain");
    }

    function _addStream(uint256 ethAmount, uint256 repAmount) private {
        require(releasedThrough == block.timestamp, "Checkpoint fees before funding");
        require(uint256(releasedThrough) + rewardDuration <= MAX_TIMESTAMP, "Invalid fee duration");
        require(ethAmount != 0 || repAmount != 0, "Empty fee stream");
        outstandingEth += ethAmount;
        outstandingRep += repAmount;
        _requireBudget();
        uint256 ethRate = ethAmount / rewardDuration;
        uint256 repRate = repAmount / rewardDuration;
        uint48 end = releasedThrough + rewardDuration;
        Expiry memory previous = expiries[lastExpiryId];
        if (previous.end != end) ++lastExpiryId;
        expiries[lastExpiryId] = Expiry(
            end,
            previous.ethRate + ethRate,
            previous.repRate + repRate,
            previous.ethIntegral + ethRate * end + (ethAmount % rewardDuration),
            previous.repIntegral + repRate * end + (repAmount % rewardDuration)
        );
        lastEthIntegral += ethRate * releasedThrough;
        lastRepIntegral += repRate * releasedThrough;
    }

    /// @notice Return income earned since the previous checkpoint. The authority
    /// may split one wall-clock interval at an exact oracle expiry before release.
    function release(uint48 until) public onlyCapitalLedger returns (uint256 ethAmount, uint256 repAmount) {
        require(until <= block.timestamp, "Future fee checkpoint");
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
    function checkpoint(uint48 eligibleThrough) external onlyCapitalLedger returns (uint256 ethAmount, uint256 repAmount) {
        if (eligibleThrough > releasedThrough)
            // implementation omitted for brevity – unchanged from original source
            ;
    }

    // The rest of the contract (e.g., _preview) is unchanged and omitted for brevity.
}
