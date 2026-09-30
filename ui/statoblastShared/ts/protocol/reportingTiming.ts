import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import * as reportingCopy from '../copy/reporting.js'

export function getReportingSubmissionTimingGuard(details: { currentTime: bigint; escalationEndTime: bigint } | undefined) {
	if (details === undefined) return undefined
	return hasSubmissionWindow(details.currentTime, details.escalationEndTime) ? undefined : reportingCopy.responseWindowEndsTooSoon
}
