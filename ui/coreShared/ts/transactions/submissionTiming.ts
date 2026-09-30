// A bounded allowance for confirmation and inclusion, not a guarantee of mining time.
export const TRANSACTION_SUBMISSION_RESERVE_SECONDS = 60n

/** Both clocks and the reserve must use the same unit; block-based callers supply their reserve. */
export function hasSubmissionWindow(currentClock: bigint, endsAt: bigint, reserve = TRANSACTION_SUBMISSION_RESERVE_SECONDS) {
	return endsAt > currentClock + reserve
}
