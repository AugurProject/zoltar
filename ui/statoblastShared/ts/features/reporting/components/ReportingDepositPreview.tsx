import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { formatCurrencyBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { previewReportingDeadline, reportingContributionTriggersFork } from '../lib/reportingDomain.js'
import { formatReportingDeadline } from '../lib/reportingViewerStatus.js'

export function getReportingApprovalLabel(amount: bigint | undefined, approvalRequired: boolean) {
	if (amount === undefined || amount <= 0n) return commonCopy.formatApproveValue(commonCopy.rep)
	return approvalRequired ? reportingCopy.approveAmountLabel(formatCurrencyBalance(amount)) : commonCopy.approvalSatisfied
}

type ForkConfirmation = { confirmed: boolean; disabled: boolean; onChange: (confirmed: boolean) => void }

/** Previews the deposit's effect on the deadline, or warns and asks for confirmation when the deposit triggers the universe fork. */
export function ReportingDepositPreview({ details, outcome, outcomeLabel, amount, forkConfirmation }: { details: ReportingDetails | undefined; outcome: ReportingOutcomeKey | undefined; outcomeLabel: string; amount: bigint | undefined; forkConfirmation: ForkConfirmation }) {
	if (details === undefined || outcome === undefined || amount === undefined) return undefined
	if (reportingContributionTriggersFork(details, outcome, amount))
		return (
			<WarningSurface ariaLive='polite' className='reporting-fork-trigger-warning' role='status' surface='flat' variant='compact'>
				<strong>{reportingCopy.forkTriggerWarningTitle}</strong>
				<p>{reportingCopy.forkTriggerWarning(outcomeLabel, formatCurrencyBalance(details.nonDecisionThresholdAttoRep))}</p>
				<label className='escalation-selection-control'>
					<input type='checkbox' checked={forkConfirmation.confirmed} disabled={forkConfirmation.disabled} onChange={event => forkConfirmation.onChange(event.currentTarget.checked)} />
					<span>{reportingCopy.forkTriggerConfirmation}</span>
				</label>
			</WarningSurface>
		)
	const preview = previewReportingDeadline(details, outcome, amount)
	if (preview === undefined) return undefined
	return <UserMessage className='detail' announcement='polite' detail={preview.reachesNonDecision ? reportingCopy.depositTriggersFork : reportingCopy.depositDeadlinePreview(formatReportingDeadline(preview.deadline, details.currentTime), formatDuration(preview.extension), preview.extension === 0n)} />
}
