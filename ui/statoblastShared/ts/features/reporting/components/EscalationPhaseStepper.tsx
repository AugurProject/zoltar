import { getDisplayedLeadingEscalationOutcome, deriveReportingStage, getReportingOutcomeLabel } from '../lib/reporting.js'
import { formatReportingDeadline } from '../lib/reportingViewerStatus.js'
import * as copy from '../../../copy/reporting.js'
import type { ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getEscalationPhase } from '../lib/reportingDomain.js'

export function EscalationPhaseStepper({ details, forkAlreadyTriggered, detailId }: { details: ReportingDetails | undefined; forkAlreadyTriggered: boolean; detailId?: string }) {
	const stage = deriveReportingStage({ reportingDetails: details, reportingReady: true })
	const phase = details?.status === 'active' ? getEscalationPhase(details) : undefined
	const fork = stage === 'forkTriggered'
	let index = 0
	if (details?.status === 'active') index = 1
	if (stage === 'resolved' || fork) index = 2
	const completed = (step: number) => step < index
	const leadingOutcome = details?.status === 'active' ? getDisplayedLeadingEscalationOutcome(details.sides) : undefined
	const hasUnsettledDeposits = details?.status === 'active' && details.sides.some(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0)
	const labels = copy.phaseLabels.map((label, i) => (i === 2 && fork ? copy.forkPhase : label))
	let next = copy.reportingDetailsRequired
	if (details !== undefined) {
		if (stage === 'resolved' && details.questionOutcome !== 'none') next = hasUnsettledDeposits ? copy.resolvedNext : copy.resultSummary(getReportingOutcomeLabel(details.questionOutcome))
		else if (fork) next = forkAlreadyTriggered ? copy.forkAlreadyTriggeredReportReason : copy.forkTriggerInstruction
		else if (details.status === 'not-started') next = copy.firstReportNext(formatCurrencyBalance(details.startBondAttoRep))
		else if (phase === 'Timed Out') next = copy.timeoutResolutionDetail
		else if (leadingOutcome === undefined) next = copy.tieStatusLead
		else if (phase === 'Pending Start') next = copy.pendingStartNext({ end: formatReportingDeadline(details.escalationEndTime, details.currentTime), outcome: getReportingOutcomeLabel(leadingOutcome) })
		else next = copy.activeNext(formatReportingDeadline(details.escalationEndTime, details.currentTime), getReportingOutcomeLabel(leadingOutcome))
	}
	return (
		<div className='escalation-phase'>
			<ol className='escalation-phase-steps'>
				{labels.map((label, i) => (
					<li key={label} aria-current={i === index ? 'step' : undefined} className={completed(i) ? 'completed' : undefined}>
						{completed(i) ? <span aria-hidden='true'>✓ </span> : undefined}
						{label}
					</li>
				))}
			</ol>
			<p className='escalation-phase-mobile'>{copy.phaseProgress(index + 1, labels[index] ?? copy.phaseLabels[0] ?? '')}</p>
			<p id={detailId} className='detail'>
				{next}
			</p>
		</div>
	)
}
