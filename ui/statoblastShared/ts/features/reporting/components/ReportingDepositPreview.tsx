import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { previewReportingDeadline } from '../lib/reportingDomain.js'
import { formatReportingDeadline } from '../lib/reportingViewerStatus.js'

export function getReportingApprovalLabel(amount: bigint | undefined, approvalRequired: boolean) {
	if (amount === undefined || amount <= 0n) return commonCopy.formatApproveValue(commonCopy.rep)
	return approvalRequired ? reportingCopy.approveAmountLabel(formatCurrencyInputBalance(amount)) : commonCopy.approvalSatisfied
}

export function ReportingDepositPreview({ details, outcome, amount }: { details: ReportingDetails | undefined; outcome: ReportingOutcomeKey | undefined; amount: bigint | undefined }) {
	if (details === undefined || outcome === undefined || amount === undefined) return undefined
	const preview = previewReportingDeadline(details, outcome, amount)
	if (preview === undefined) return undefined
	return <UserMessage className='detail' announcement='polite' detail={preview.reachesNonDecision ? reportingCopy.depositTriggersFork : reportingCopy.depositDeadlinePreview(formatReportingDeadline(preview.deadline, details.currentTime), formatDuration(preview.extension), preview.extension === 0n)} />
}
