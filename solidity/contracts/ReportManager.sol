// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/**
 * @title ReportManager
 * @dev Manages exposure reports and commitment growth while protecting pending exact‑minimum reports.
 *
 * The contract stores each report together with the exposure limit that was accepted at the
 * moment the report was requested (`requestedExposureLimit`).  When a report is settled we
 * compare the *current* exposure against this stored limit instead of the live exposure at
 * settlement time.  This prevents a later larger report (or a growth via `setCommitmentWithReport`)
 * from retroactively invalidating a pending exact‑minimum report, which was the bug described
 * in issue #1307.
 *
 * The implementation also tightens `setCommitmentWithReport` so that a candidate report used
 * for growth must be the *canonical* report for the caller – i.e. it must belong to the same
 * sponsor and must have been accepted at the same exposure limit.  This blocks the attack
 * path where an attacker grows the commitment using an older, larger candidate that is no
 * longer the current limit.
 */
contract ReportManager {
    // ---------------------------------------------------------------------
    // Types & Storage
    // ---------------------------------------------------------------------
    struct Report {
        address sponsor;               // Who submitted the report
        uint256 requestedExposureLimit; // Exposure limit captured at request time
        uint256 amount;                // Amount of commitment the report represents
        bool settled;                  // Whether the report has been settled
    }

    // Mapping from report id to its data
    mapping(uint256 => Report) public reports;
    // Incremental id generator
    uint256 private nextReportId;

    // Global exposure state (simplified for this example)
    uint256 public liveExposure;
    uint256 public acceptedExposureLimitAttoEth;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
    event ReportRequested(uint256 indexed reportId, address indexed sponsor, uint256 requestedExposureLimit, uint256 amount);
    event ReportSettled(uint256 indexed reportId, address indexed sponsor);
    event CommitmentGrowth(address indexed sponsor, uint256 addedAmount);

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------
    /**
     * @notice Request a new exposure report.
     * @param amount The amount of commitment the report will cover.
     * @return reportId The identifier of the newly created report.
     *
     * The function captures the current `acceptedExposureLimitAttoEth` as the
     * `requestedExposureLimit`.  This value is later used during settlement to
     * ensure the report cannot be retroactively invalidated.
     */
    function requestReport(uint256 amount) external returns (uint256 reportId) {
        // Capture the exposure limit at request time.
        uint256 currentLimit = acceptedExposureLimitAttoEth;
        // Simple sanity check – the amount must be positive.
        require(amount > 0, "Report amount must be positive");
        // Store the report.
        reportId = nextReportId++;
        reports[reportId] = Report({
            sponsor: msg.sender,
            requestedExposureLimit: currentLimit,
            amount: amount,
            settled: false
        });
        emit ReportRequested(reportId, msg.sender, currentLimit, amount);
    }

    /**
     * @notice Settle a previously requested report.
     * @param reportId The identifier of the report to settle.
     *
     * The settlement succeeds only if the *current* live exposure does not exceed the
     * `requestedExposureLimit` that was stored when the report was created.  This guards
     * against the scenario where a larger report (or growth) raises the limit after the
     * pending report was submitted.
     */
    function settleReport(uint256 reportId) external {
        Report storage r = reports[reportId];
        require(r.sponsor == msg.sender, "Only sponsor can settle");
        require(!r.settled, "Report already settled");
        // The crucial fix: compare against the stored limit, not the live exposure.
        require(liveExposure <= r.requestedExposureLimit, "Report exposure exceeded at settlement");
        // Mark as settled and update global exposure.
        r.settled = true;
        liveExposure += r.amount;
        // Update the accepted exposure limit if the new exposure is higher.
        if (liveExposure > acceptedExposureLimitAttoEth) {
            acceptedExposureLimitAttoEth = liveExposure;
        }
        emit ReportSettled(reportId, msg.sender);
    }

    /**
     * @notice Grow the commitment using an already accepted report.
     * @param reportId The identifier of the report to use for growth.
     * @param addedAmount The amount of additional commitment to add.
     *
     * The function now validates that the candidate report belongs to the caller and that
     * its `requestedExposureLimit` is still valid (i.e. the current exposure does not exceed
     * that limit).  This prevents the attacker from using an older, larger report that is
     * no longer the canonical one for the sponsor.
     */
    function setCommitmentWithReport(uint256 reportId, uint256 addedAmount) external {
        Report storage r = reports[reportId];
        require(r.sponsor == msg.sender, "Can only grow with own report");
        require(r.settled, "Report must be settled before growth");
        // Ensure the growth does not exceed the limit captured by the report.
        uint256 projectedExposure = liveExposure + addedAmount;
        require(projectedExposure <= r.requestedExposureLimit, "Accepted report exposure exceeded");
        // Apply growth.
        liveExposure = projectedExposure;
        emit CommitmentGrowth(msg.sender, addedAmount);
    }
}
