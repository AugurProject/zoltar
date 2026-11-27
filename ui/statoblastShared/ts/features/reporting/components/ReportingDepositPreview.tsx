import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatCurrencyBalance, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingDetails } from '../../../types/contracts.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { previewReportingComparison, reportingContributionTriggersFork } from '../lib/reportingDomain.js'
import { getReportingOutcomeLabel } from '../lib/reporting.js'

type ForkConfirmation = { confirmed: boolean; disabled: boolean; onChange: (confirmed: boolean) => void }

/** Previews the accepted deposit and asks for confirmation before a report that can end reporting undecided. */
export function ReportingDepositPreview({ details, outcome, outcomeLabel, amount, forkConfirmation }: { details: ReportingDetails | undefined; outcome: ReportingOutcomeKey | undefined; outcomeLabel: string; amount: bigint | undefined; forkConfirmation: ForkConfirmation }) {
	if (details === undefined || outcome === undefined || amount === undefined) return undefined
	const forkWarning = reportingContributionTriggersFork(details, outcome, amount) ? (
		<WarningSurface ariaLive='polite' className='reporting-fork-trigger-warning' role='status' surface='flat' variant='compact'>
			<strong>{reportingCopy.forkTriggerWarningTitle}</strong>
			<p>{reportingCopy.forkTriggerWarning(outcomeLabel, formatCurrencyBalance(details.nonDecisionThresholdAttoRep))}</p>
			<label className='escalation-selection-control'>
				<input type='checkbox' checked={forkConfirmation.confirmed} disabled={forkConfirmation.disabled} onChange={event => forkConfirmation.onChange(event.currentTarget.checked)} />
				<span>{reportingCopy.forkTriggerConfirmation}</span>
			</label>
		</WarningSurface>
	) : undefined
	const comparison = previewReportingComparison(details, outcome, amount)
	if (comparison === undefined) return forkWarning
	const rep = (value: bigint | undefined) => <CurrencyValue value={value} suffix={commonCopy.rep} />
	const label = (value: ReportingOutcomeKey | undefined) => (value === undefined ? commonCopy.metricUnavailablePlaceholder : getReportingOutcomeLabel(value))
	const rows = [
		{ label: reportingCopy.reportComparisonPayout, before: rep(comparison.payoutBefore), after: rep(comparison.payoutAfter) },
		{ label: reportingCopy.reportComparisonStake(outcomeLabel), before: rep(comparison.stakeBefore), after: rep(comparison.stakeAfter) },
		{ label: reportingCopy.reportComparisonLeader, before: label(comparison.leaderBefore), after: label(comparison.leaderAfter) },
		{ label: reportingCopy.reportComparisonDeadline, before: comparison.endsBefore === undefined ? commonCopy.metricUnavailablePlaceholder : formatTimestamp(comparison.endsBefore), after: comparison.endsUndecided ? reportingCopy.reportComparisonUndecided : formatTimestamp(comparison.endsAfter) },
	]
	return (
		<div className='statoblast-report-comparison'>
			<table className='statoblast-report-preview'>
				<caption>{reportingCopy.reportComparison}</caption>
				<thead>
					<tr>
						<td />
						<th scope='col'>{reportingCopy.reportComparisonBefore}</th>
						<th scope='col'>{reportingCopy.reportComparisonAfter}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(row => (
						<tr key={row.label}>
							<th scope='row'>{row.label}</th>
							<td>{row.before}</td>
							<td>{row.after}</td>
						</tr>
					))}
				</tbody>
			</table>
			{comparison.missingDeposits && <p className='detail'>{reportingCopy.reportComparisonKnownDeposits}</p>}
			{forkWarning ?? (
				<UserMessage
					tone='warning'
					detail={
						<>
							{reportingCopy.reportComparisonLoss(outcomeLabel)} {rep(comparison.stakeAfter)}.
						</>
					}
				/>
			)}
		</div>
	)
}
