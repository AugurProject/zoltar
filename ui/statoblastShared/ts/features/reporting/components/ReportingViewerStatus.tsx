import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getDisplayedLeadingEscalationOutcome } from '../lib/reporting.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActiveReportingDetails } from '../../../types/contracts.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { EscalationReminderLine } from './EscalationReminderLine.js'
import * as copy from '../../../copy/reporting.js'
import { isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import { escalationExplanationHref, formatReportingDeadline, getViewerPositions } from '../lib/reportingViewerStatus.js'

export function ReportingViewerStatus({ details, onTakeLead, disabled }: { details: ActiveReportingDetails; onTakeLead: (side: ReportingOutcomeKey, amount: bigint) => void; disabled: boolean }) {
	const positions = getViewerPositions(details)
	if (positions.length === 0 || isPoolQuestionFinalized(details)) return undefined
	const forked = details.hasReachedNonDecision || details.systemState !== 'operational'
	const tied = getDisplayedLeadingEscalationOutcome(details.sides) === undefined
	let detail = (
		<>
			{positions.map(position => (
				<div key={position.side.key}>
					<UserMessage
						detail={
							<>
								<strong>{position.lead}</strong> {position.detail}
							</>
						}
					/>
					{positions.length > 1 || position.leading || position.minimum === undefined ? undefined : (
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
	else if (details.sides.every(side => side.balance === 0n))
		detail = (
			<UserMessage
				detail={
					<>
						<strong>{copy.tieStatusLead}</strong> {copy.zeroBalanceStatusDetail}
					</>
				}
			/>
		)
	else if (tied)
		detail = (
			<UserMessage
				detail={
					<>
						<strong>{copy.tieStatusLead}</strong> {copy.tieStatusDetail(formatReportingDeadline(details.escalationEndTime, details.currentTime))}
						<a href={escalationExplanationHref} target='_blank' rel='noreferrer'>
							{copy.tiesResolve}
						</a>
						{copy.tieStatusEnd}
					</>
				}
			/>
		)
	return (
		<SectionBlock className='reporting-viewer-status' title={copy.yourPositions} variant='plain'>
			{detail}
			{!forked && tied ? positions.map(position => <p key={position.side.key}>{copy.forkViewerStake(position.side.label, formatCurrencyBalance(position.stake))}</p>) : undefined}
			<EscalationReminderLine key={details.securityPoolAddress} details={details} />
		</SectionBlock>
	)
}
