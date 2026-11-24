import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { getReportingMinimumOutcomeChangeContribution, previewReportingDeadline } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingDomain.js'
import { buildStatoblastCalendarEvent, downloadStatoblastCalendarEvent, LAST_CALENDAR_START } from '@zoltar/ui-statoblast-shared/features/reporting/lib/escalationReminder.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { decodeStoredValue, isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ListedQuestionLedger, ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'

type ReportingOverview = {
	active: boolean
	fork: boolean
	resolved: boolean
	opens: bigint
	ends: bigint | undefined
	latestEnd?: bigint | undefined
	estimatedEndIfLeading?: bigint | undefined
	checkedAt: number
	sides: { name: string; total: bigint; yours: bigint; moreToLead?: bigint | undefined }[]
}

export function reportingOverview(details: ReportingDetails, checkedAt: number): ReportingOverview {
	const sides =
		details.status === 'active'
			? ['yes', 'no', 'invalid'].flatMap(outcome => {
					const side = details.sides.find(candidate => candidate.key === outcome)
					if (side === undefined) return []
					const yours = side.localPrincipalAttoRep ?? side.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)
					const moreToLead = getReportingMinimumOutcomeChangeContribution(details, side.key).amountAttoRep
					const preview = yours > 0n && moreToLead !== undefined ? previewReportingDeadline(details, side.key, moreToLead) : undefined
					return [{ name: side.label, total: side.balance, yours, moreToLead, projectedEnd: preview?.reachesNonDecision === false ? preview.deadline : undefined }]
				})
			: []
	return {
		active: details.status === 'active',
		fork: details.status === 'active' && details.hasReachedNonDecision,
		resolved: details.settlementState === 'resolved',
		opens: details.marketDetails.endTime,
		ends: details.status === 'active' ? details.escalationEndTime : undefined,
		latestEnd: details.status === 'active' ? details.latestEscalationEndTime : undefined,
		estimatedEndIfLeading: sides.find(side => side.projectedEnd !== undefined)?.projectedEnd,
		checkedAt,
		sides: sides.map(({ name, total, yours, moreToLead }) => ({ name, total, yours, moreToLead })),
	}
}

export function decodeReportingOverview(value: unknown) {
	if (!isStoredRecord(value) || !Array.isArray(value['sides'])) return undefined
	const sides = value['sides'].flatMap(side => {
		const parsed = decodeStoredValue(side, read => ({ name: read.string('name'), total: read.bigint('total'), yours: read.bigint('yours'), moreToLead: read.optional('moreToLead', read.bigint) }))
		return parsed === undefined ? [] : [parsed]
	})
	return decodeStoredValue(
		value,
		(read): ReportingOverview => ({
			active: read.boolean('active'),
			fork: read.boolean('fork'),
			resolved: read.boolean('resolved'),
			opens: read.bigint('opens'),
			ends: read.optional('ends', read.bigint),
			latestEnd: read.optional('latestEnd', read.bigint),
			estimatedEndIfLeading: read.optional('estimatedEndIfLeading', read.bigint),
			checkedAt: read.number('checkedAt'),
			sides,
		}),
	)
}

export function StatoblastReportingOverview({ view, now, autoRefresh, checkingDeadline = false, question, onTakeLead }: { view: ReportingOverview; now: bigint | undefined; autoRefresh: boolean; checkingDeadline?: boolean; question?: ListedQuestionLedger; onTakeLead?: (outcome: string, amount: bigint) => void }) {
	const greatest = view.sides.reduce((maximum, side) => (side.total > maximum ? side.total : maximum), 0n)
	const canChangeLeader = !checkingDeadline && !view.resolved && !view.fork && greatest > 0n && (now === undefined || view.ends === undefined || now <= view.ends)
	const leaders = view.sides.filter(side => side.total === greatest)
	const behind = canChangeLeader ? view.sides.find(side => side.yours > 0n && side.total < greatest && side.moreToLead !== undefined) : undefined
	const age = Math.max(0, Math.floor((Date.now() - view.checkedAt) / 60_000))
	const hasStake = view.sides.some(side => side.yours > 0n)
	let status = copy.reportingOpens
	if (now !== undefined && now >= view.opens) status = copy.reportingOpen
	if (view.active) status = hasStake ? copy.responseWindow : copy.noRepStaked
	if (view.fork) status = copy.fork
	if (view.resolved) status = copy.resolved
	if (checkingDeadline) status = copy.deadlineChecking
	const due = view.active ? view.ends : view.opens
	const addReminder = (target: ListedQuestionLedger, deadline: bigint) => {
		const title = view.active ? copy.reportReminder(target.marketDetails.title) : copy.reportingOpensReminder(target.marketDetails.title)
		const calendar = buildStatoblastCalendarEvent({ id: `${target.questionLedgerAddress}-${deadline}`, generatedAt: BigInt(Math.floor(Date.now() / 1000)), startsAt: deadline, title, description: location.href })
		downloadStatoblastCalendarEvent(calendar, 'statoblast-reporting.ics')
	}
	const canRemind = question !== undefined && !question.universeHasForked && !view.resolved && !view.fork && due !== undefined && due <= LAST_CALENDAR_START && now !== undefined && now < due
	return (
		<>
			<section className='statoblast-report-banner' aria-label={copy.reporting}>
				<UserMessage announcement={checkingDeadline ? 'polite' : undefined} detail={<strong>{status}</strong>} />
				{due !== undefined && now !== undefined && due > now && due <= LAST_CALENDAR_START && (
					<span>
						{view.active ? copy.responseWindowEnds : copy.reportOpensAt} <TimestampValue timestamp={due} relative={false} />
					</span>
				)}
				{behind?.moreToLead !== undefined && (
					<span>
						<CurrencyValue value={behind.moreToLead} suffix={copy.rep} /> · {copy.moreBeforeDeadline}
					</span>
				)}
				<div className='statoblast-report-banner-actions'>
					{canRemind && (
						<button className='secondary' type='button' onClick={() => addReminder(question, due)}>
							{copy.addToCalendar}
						</button>
					)}
					{behind?.moreToLead !== undefined && onTakeLead !== undefined && (
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (behind.moreToLead !== undefined) onTakeLead(behind.name, behind.moreToLead)
							}}
						>
							{copy.takeLead(behind.name)}
						</button>
					)}
				</div>
			</section>
			{view.sides.length > 0 && (
				<SectionBlock title={copy.stakedPerOutcome}>
					{!autoRefresh && view.active && !view.resolved && !view.fork && <p className='detail'>{copy.followWithAutoRefresh}</p>}
					{age >= 1 && <p className='detail'>{copy.asOfMinutes(age)}</p>}
					<div className='statoblast-report-columns'>
						<ul className='statoblast-report-stakes'>
							{view.sides.map(side => {
								const yours = side.yours > side.total ? side.total : side.yours
								const others = side.total - yours
								return (
									<li key={side.name}>
										<strong>{side.name}</strong>
										{canChangeLeader && leaders.length === 1 && side.total === greatest && <Badge tone='ok'>{copy.leadingOutcome}</Badge>}
										{canChangeLeader && yours > 0n && side.total < greatest && side.moreToLead !== undefined && (
											<Badge tone='muted'>
												<CurrencyValue value={side.moreToLead} suffix={copy.rep} /> {copy.moreToLead}
											</Badge>
										)}
										<div className='statoblast-stake-bar' aria-hidden='true'>
											<div style={{ inlineSize: `${(getVisualRatio({ value: others, maxValue: greatest }) ?? 0) * 100}%` }} />
											<div style={{ inlineSize: `${(getVisualRatio({ value: yours, maxValue: greatest }) ?? 0) * 100}%` }} />
										</div>
										<small>
											{copy.othersStake} <CurrencyValue value={others} suffix={copy.rep} /> · {copy.yourStake} <CurrencyValue value={yours} suffix={copy.rep} />
										</small>
									</li>
								)
							})}
						</ul>
						{view.ends !== undefined && view.ends > view.opens && view.ends <= LAST_CALENDAR_START && (
							<div className='statoblast-response-timeline'>
								<progress aria-label={copy.responseWindow} max={1} value={getVisualRatio({ value: now === undefined ? undefined : now - view.opens, maxValue: view.ends - view.opens })} />
								{now !== undefined && (
									<span>
										{copy.responseWindowToday} <TimestampValue timestamp={now} relative={false} />
									</span>
								)}
								<span>
									{copy.reportingOpens} <TimestampValue timestamp={view.opens} relative={false} />
								</span>
								<span>
									{copy.responseWindowEnds} <TimestampValue timestamp={view.ends} relative={false} />
								</span>
								{canChangeLeader && view.estimatedEndIfLeading !== undefined && (
									<span>
										{copy.responseWindowIfLeading} <TimestampValue timestamp={view.estimatedEndIfLeading} relative={false} />
									</span>
								)}
								{view.latestEnd !== undefined && view.latestEnd <= LAST_CALENDAR_START && (
									<span>
										{copy.responseWindowLatest} <TimestampValue timestamp={view.latestEnd} relative={false} />
									</span>
								)}
								<p className='detail'>{copy.responseWindowRule}</p>
							</div>
						)}
					</div>
				</SectionBlock>
			)}
		</>
	)
}
