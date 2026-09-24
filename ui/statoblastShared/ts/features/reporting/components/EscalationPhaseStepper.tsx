import * as copy from '../../../copy/reporting.js'
import type { ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { formatCurrencyBalance, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { deriveReportingStage, getReportingOutcomeLabel } from '../lib/reporting.js'
import { getEscalationPhase, getLeadingEscalationOutcome } from '../lib/reportingDomain.js'

export function EscalationPhaseStepper({ details, forkAlreadyTriggered, detailId }: { details: ReportingDetails | undefined; forkAlreadyTriggered: boolean; detailId?: string }) {
	const stage = deriveReportingStage({ reportingDetails: details, reportingReady: true })
	const phase = details?.status === 'active' ? getEscalationPhase(details) : undefined
	const fork = stage === 'forkTriggered'
	let index = 0
	if (details?.status === 'active') index = 2
	if (phase === 'Pending Start') index = 1
	if (stage === 'resolved' || fork) index = 3
	const labels = copy.phaseLabels.map((label, i) => (i === 3 && fork ? copy.forkPhase : label))
	let next = copy.reportingDetailsRequired
	if (details !== undefined) {
		if (stage === 'resolved' && details.questionOutcome !== 'none') next = copy.resolvedNext
		else if (fork) next = forkAlreadyTriggered ? copy.forkAlreadyTriggeredReportReason : copy.forkTriggerInstruction
		else if (details.status === 'not-started') next = copy.firstReportNext(formatCurrencyBalance(details.startBondAttoRep))
		else if (phase === 'Pending Start') next = copy.pendingStartNext({ end: formatTimestamp(details.escalationEndTime), outcome: getReportingOutcomeLabel(getLeadingEscalationOutcome(details.sides) ?? 'invalid') })
		else if (phase === 'Timed Out') next = copy.timeoutResolutionDetail
		else next = copy.activeNext(formatTimestamp(details.escalationEndTime), getReportingOutcomeLabel(getLeadingEscalationOutcome(details.sides) ?? 'invalid'))
	}
	return (
		<div className='escalation-phase'>
			<ol className='escalation-phase-steps'>
				{labels.map((label, i) => (
					<li key={label} aria-current={i === index ? 'step' : undefined} className={i < index ? 'completed' : undefined}>
						{i < index ? <span aria-hidden='true'>✓ </span> : undefined}
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
