import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ActiveReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { NoticeStack } from '@zoltar/ui-core-shared/components/NoticeStack.js'
import * as copy from '../../../copy/reporting.js'
import { getStrictLeadingEscalationOutcome, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import { escalationExplanationHref, formatReportingDeadline, getViewerPositions } from '../lib/reportingViewerStatus.js'

export function ReportingViewerStatus({ details, onTakeLead, disabled }: { details: ActiveReportingDetails; onTakeLead: (side: ReportingOutcomeKey, amount: bigint) => void; disabled: boolean }) {
	const positions = getViewerPositions(details)
	if (positions.length === 0 || isPoolQuestionFinalized(details)) return undefined
	const forked = details.hasReachedNonDecision || details.systemState !== 'operational'
	const tied = getStrictLeadingEscalationOutcome(details.sides) === undefined
	let detail = (
		<>
			{positions.map(position => (
				<div key={position.side.key}>
					<p>
						<strong>{position.lead}</strong> {position.detail}
					</p>
					{position.leading || position.minimum === undefined ? undefined : (
						<button
							className='secondary'
							type='button'
							disabled={disabled}
							onClick={() => {
								if (position.minimum !== undefined) onTakeLead(position.side.key, position.minimum)
							}}
						>
							{copy.takeTheLead}
						</button>
					)}
				</div>
			))}
		</>
	)
	if (forked)
		detail = (
			<>
				{positions.map(position => (
					<p key={position.side.key}>
						<strong>{copy.forkViewerStake(position.side.label, formatCurrencyBalance(position.stake))}</strong>
					</p>
				))}
			</>
		)
	else if (tied)
		detail = (
			<p>
				<strong>{copy.tieStatusLead}</strong> {copy.tieStatusDetail(formatReportingDeadline(details.escalationEndTime, details.currentTime))}
				<a href={escalationExplanationHref} target='_blank' rel='noreferrer'>
					{copy.tiesResolve}
				</a>
				{copy.tieStatusEnd}
			</p>
		)
	return <NoticeStack items={[{ id: 'reporting-viewer-status', title: copy.yourStatus, tone: !forked && positions.some(position => position.leading) ? 'success' : 'warning', detail }]} />
}
