import * as reportingCopy from '../copy/reporting.js'

// Reserve wallet confirmation and inclusion time without changing game finality.
const REPORTING_SUBMISSION_WINDOW_SECONDS = 60n

export function getReportingSubmissionTimingGuard(details: { currentTime: bigint; escalationEndTime: bigint } | undefined) {
	if (details === undefined) return undefined
	return details.escalationEndTime > details.currentTime + REPORTING_SUBMISSION_WINDOW_SECONDS ? undefined : reportingCopy.responseWindowEndsTooSoon
}
