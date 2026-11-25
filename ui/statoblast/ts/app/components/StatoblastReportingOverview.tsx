import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import type { ComponentChildren } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { getKnownReportingClaimAmount, getReportingMinimumOutcomeChangeContribution, previewReportingDeadline } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingDomain.js'
import { getReportingOutcomeLabel } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reporting.js'
import { EscalationExplainer } from '@zoltar/ui-statoblast-shared/features/reporting/components/EscalationExplainer.js'
import { buildStatoblastCalendarEvent, downloadStatoblastCalendarEvent, LAST_CALENDAR_START } from '@zoltar/ui-statoblast-shared/features/reporting/lib/escalationReminder.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { decodeStoredValue, isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ListedQuestionLedger, ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { forkMigrationRequiredDetail, parentUniverseForked } from '@zoltar/ui-statoblast-shared/copy/reporting.js'

type ReportingOverview = {
	active: boolean
	fork: boolean
	migrationRequired?: boolean | undefined
	resolved: boolean
	resolvedAs?: string | undefined
	claimAttoRep?: bigint | undefined
	firstReportMinimum?: bigint | undefined
	nonDecisionThreshold?: bigint | undefined
	opens: bigint
	ends: bigint | undefined
	latestEnd?: bigint | undefined
	estimatedEndIfLeading?: bigint | undefined
	checkedAt: number
	sides: { name: string; total: bigint; yours: bigint; moreToLead?: bigint | undefined; saved?: boolean | undefined }[]
}

export function reportingOverview(details: ReportingDetails, checkedAt: number): ReportingOverview {
	const migrationRequired = details.settlementState === 'migration-required'
	const sides =
		details.status === 'active'
			? ['yes', 'no', 'invalid'].flatMap(outcome => {
					const side = details.sides.find(candidate => candidate.key === outcome)
					if (side === undefined) return []
					const yours = side.localPrincipalAttoRep ?? side.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)
					const minimum = migrationRequired ? undefined : getReportingMinimumOutcomeChangeContribution(details, side.key).amountAttoRep
					const preview = yours > 0n && minimum !== undefined ? previewReportingDeadline(details, side.key, minimum) : undefined
					const moreToLead = preview?.reachesNonDecision === false ? minimum : undefined
					return [{ name: side.label, total: side.balance, yours, moreToLead, saved: side.userDeposits.length > 0, projectedEnd: moreToLead === undefined ? undefined : preview?.deadline }]
				})
			: []
	return {
		active: details.status === 'active',
		fork: details.status === 'active' && details.hasReachedNonDecision,
		migrationRequired,
		resolved: details.settlementState === 'resolved',
		resolvedAs: details.questionOutcome === 'none' ? undefined : getReportingOutcomeLabel(details.questionOutcome),
		claimAttoRep: getKnownReportingClaimAmount(details),
		firstReportMinimum: details.startBondAttoRep,
		nonDecisionThreshold: details.nonDecisionThresholdAttoRep,
		opens: details.marketDetails.endTime,
		ends: details.status === 'active' ? details.escalationEndTime : undefined,
		latestEnd: details.status === 'active' ? details.latestEscalationEndTime : undefined,
		estimatedEndIfLeading: sides.find(side => side.projectedEnd !== undefined)?.projectedEnd,
		checkedAt,
		sides: sides.map(({ projectedEnd: _, ...side }) => side),
	}
}

export function decodeReportingOverview(value: unknown) {
	if (!isStoredRecord(value) || !Array.isArray(value['sides'])) return undefined
	const sides = value['sides'].flatMap(side => {
		const parsed = decodeStoredValue(side, read => ({ name: read.string('name'), total: read.bigint('total'), yours: read.bigint('yours'), moreToLead: read.optional('moreToLead', read.bigint), saved: read.optional('saved', read.boolean) }))
		return parsed === undefined ? [] : [parsed]
	})
	return decodeStoredValue(
		value,
		(read): ReportingOverview => ({
			active: read.boolean('active'),
			fork: read.boolean('fork'),
			migrationRequired: read.optional('migrationRequired', read.boolean),
			resolved: read.boolean('resolved'),
			resolvedAs: read.optional('resolvedAs', read.string),
			claimAttoRep: read.optional('claimAttoRep', read.bigint),
			firstReportMinimum: read.optional('firstReportMinimum', read.bigint),
			nonDecisionThreshold: read.optional('nonDecisionThreshold', read.bigint),
			opens: read.bigint('opens'),
			ends: read.optional('ends', read.bigint),
			latestEnd: read.optional('latestEnd', read.bigint),
			estimatedEndIfLeading: read.optional('estimatedEndIfLeading', read.bigint),
			checkedAt: read.number('checkedAt'),
			sides,
		}),
	)
}

type WinningShares = { amount: bigint; decimals: number; href: string }

function ResponseTimeline({ opens, ends, now, estimatedEnd, latestEnd }: { opens: bigint; ends: bigint; now: bigint | undefined; estimatedEnd: bigint | undefined; latestEnd: bigint | undefined }) {
	const milestones = [
		{ kind: 'today', label: copy.responseWindowToday, time: now },
		{ kind: 'ends', label: copy.responseWindowEnds, time: ends },
		{ kind: 'projection', label: copy.responseWindowIfLeading, time: estimatedEnd },
		{ kind: 'latest', label: copy.responseWindowLatest, time: latestEnd },
	].flatMap(({ kind, label, time }) => (time === undefined || time > LAST_CALENDAR_START ? [] : [{ kind, label, time }]))
	const limit = milestones.reduce((maximum, milestone) => (milestone.kind !== 'today' && milestone.time > maximum ? milestone.time : maximum), ends)
	const position = (time: bigint) => (getVisualRatio({ value: time - opens, maxValue: limit - opens }) ?? 0) * 100
	const extension = estimatedEnd === undefined || estimatedEnd > LAST_CALENDAR_START ? 0 : Math.max(0, position(estimatedEnd) - position(ends))
	return (
		<div className='statoblast-response-timeline'>
			<strong>{copy.responseWindow}</strong>
			<div className='statoblast-response-track' aria-hidden='true'>
				<div className='statoblast-response-elapsed' style={{ inlineSize: `${now === undefined ? 0 : position(now)}%` }} />
				{extension > 0 && <div className='statoblast-response-extension' style={{ insetInlineStart: `${position(ends)}%`, inlineSize: `${extension}%` }} />}
				{milestones.map(({ kind, time }) => (
					<span key={kind} data-milestone={kind} style={{ insetInlineStart: `${position(time)}%` }} />
				))}
			</div>
			<dl>
				{milestones.map(({ kind, label, time }) => (
					<div key={kind} data-milestone={kind}>
						<dt>{label}</dt>
						<dd>
							<TimestampValue timestamp={time} relative={false} />
						</dd>
					</div>
				))}
			</dl>
			<p className='detail'>{copy.responseWindowRule}</p>
		</div>
	)
}

export function StatoblastReportingOverview({
	view,
	now,
	autoRefresh,
	checkingDeadline = false,
	question,
	winningShares,
	onTakeLead,
}: {
	view: ReportingOverview
	now: bigint | undefined
	autoRefresh: boolean
	checkingDeadline?: boolean
	question?: ListedQuestionLedger
	winningShares?: WinningShares | undefined
	onTakeLead?: (outcome: string, amount: bigint) => void
}) {
	const greatest = view.sides.reduce((maximum, side) => (side.total > maximum ? side.total : maximum), 0n)
	const forkClosesReporting = view.fork || view.migrationRequired === true
	const canChangeLeader = !checkingDeadline && !view.resolved && !forkClosesReporting && greatest > 0n && (now === undefined || view.ends === undefined || now <= view.ends)
	const leaders = view.sides.filter(side => side.total === greatest)
	const tied = canChangeLeader && leaders.length > 1
	const behind = canChangeLeader && !tied ? view.sides.find(side => side.yours > 0n && side.total < greatest) : undefined
	const age = Math.max(0, Math.floor((Date.now() - view.checkedAt) / 60_000))
	const due = view.active ? view.ends : view.opens
	const futureDeadline = due !== undefined && due <= LAST_CALENDAR_START && (now === undefined || due > now) ? due : undefined
	const pastDeadline = view.active && due !== undefined && now !== undefined && due < now
	let status = copy.reportingOpens
	let instruction: ComponentChildren
	let consequence: ComponentChildren
	if (view.resolved) {
		status = view.resolvedAs === undefined ? copy.resolved : copy.resolvedAs(view.resolvedAs)
		if (view.resolvedAs !== undefined && view.claimAttoRep !== undefined && view.claimAttoRep > 0n) instruction = copy.claimKnownDeposits(view.resolvedAs, <CurrencyValue value={view.claimAttoRep} suffix={copy.rep} />)
		if (view.resolvedAs !== undefined && winningShares !== undefined && winningShares.amount > 0n) {
			consequence = copy.winningSharesToRedeem(view.resolvedAs, <CurrencyValue value={winningShares.amount} units={winningShares.decimals} />, <a href={winningShares.href}>{copy.shares}</a>)
		}
	} else if (view.migrationRequired) {
		status = parentUniverseForked
		consequence = forkMigrationRequiredDetail
	} else if (view.fork) {
		status = copy.endedUndecided
	} else if (checkingDeadline || pastDeadline) {
		status = copy.deadlineChecking
	} else if (tied) {
		status = copy.reportingTied
		consequence = copy.reportingTiedConsequence
	} else if (behind !== undefined) {
		status = copy.behindOn(behind.name)
		if (behind.moreToLead !== undefined && futureDeadline !== undefined) {
			instruction = copy.howToLead(behind.name, <CurrencyValue value={behind.moreToLead} rounding='up' suffix={copy.rep} />, <TimestampValue timestamp={futureDeadline} relative={false} />)
		}
		consequence = copy.stakeAtRisk(behind.name, <CurrencyValue value={behind.yours} suffix={copy.rep} />)
	} else if (view.active) {
		status = greatest === 0n ? copy.noRepStaked : copy.responseWindow
		if (greatest === 0n) consequence = copy.noRepStakedConsequence
	} else if (now !== undefined && now >= view.opens) {
		status = copy.reportingOpen
		consequence = view.firstReportMinimum === undefined ? copy.noReportsYet : copy.firstReportMinimum(<CurrencyValue value={view.firstReportMinimum} rounding='up' suffix={copy.rep} />)
	}
	const addReminder = (target: ListedQuestionLedger, deadline: bigint) => {
		const title = view.active ? copy.reportReminder(target.marketDetails.title) : copy.reportingOpensReminder(target.marketDetails.title)
		const calendar = buildStatoblastCalendarEvent({ id: `${target.questionLedgerAddress}-${deadline}`, generatedAt: BigInt(Math.floor(Date.now() / 1000)), startsAt: deadline, title, description: location.href })
		downloadStatoblastCalendarEvent(calendar, 'statoblast-reporting.ics')
	}
	const canRemind = question !== undefined && !question.universeHasForked && !view.resolved && !forkClosesReporting && futureDeadline !== undefined && now !== undefined
	const showDeadline = futureDeadline !== undefined && !view.resolved && !forkClosesReporting && !checkingDeadline && instruction === undefined
	const showTakeLead = behind?.moreToLead !== undefined && onTakeLead !== undefined && futureDeadline !== undefined
	return (
		<>
			<section className='statoblast-report-banner' aria-label={copy.reporting} data-behind={behind !== undefined}>
				<div className='statoblast-report-banner-copy'>
					<UserMessage announcement={status === copy.deadlineChecking ? 'polite' : undefined} detail={<strong>{status}</strong>} />
					{instruction !== undefined && <h3>{instruction}</h3>}
					{showDeadline && (
						<span>
							{view.active ? copy.responseWindowEnds : copy.reportOpensAt} <TimestampValue timestamp={futureDeadline} relative={false} />
						</span>
					)}
					{consequence !== undefined && <p>{consequence}</p>}
					{age >= 1 && (view.resolved || view.sides.length === 0) && <p className='detail'>{copy.asOfMinutes(age)}</p>}
				</div>
				{(canRemind || showTakeLead) && (
					<div className='statoblast-report-banner-actions'>
						{canRemind && (
							<button className='secondary' type='button' onClick={() => addReminder(question, futureDeadline)}>
								{copy.addToCalendar}
							</button>
						)}
						{showTakeLead && (
							<button
								className='secondary'
								type='button'
								onClick={() => {
									if (behind.moreToLead !== undefined) onTakeLead(behind.name, behind.moreToLead)
								}}
							>
								{copy.takeLead(behind.name, <CurrencyValue value={behind.moreToLead} rounding='up' suffix={copy.rep} />)}
							</button>
						)}
					</div>
				)}
			</section>
			{!view.resolved && view.sides.length > 0 && (
				<SectionBlock
					title={copy.stakedPerOutcome}
					description={[age >= 1 ? copy.asOfMinutes(age) : undefined, !autoRefresh && view.active && !forkClosesReporting ? copy.followWithAutoRefresh : undefined].filter(text => text !== undefined).join(' · ') || undefined}
					badge={
						<div className='statoblast-report-legend'>
							<span>{copy.othersStake}</span>
							<span>{copy.yourStake}</span>
						</div>
					}
				>
					<div className='statoblast-report-columns'>
						<ul className='statoblast-report-stakes'>
							{view.sides.map(side => {
								const yours = side.yours > side.total ? side.total : side.yours
								const others = side.total - yours
								return (
									<li key={side.name}>
										<strong>{side.name}</strong>
										{canChangeLeader && leaders.length === 1 && side.total === greatest && <Badge tone='ok'>{copy.leadingOutcome}</Badge>}
										{canChangeLeader && yours > 0n && side.total < greatest && (
											<Badge tone='muted'>
												<span>
													{copy.behindOutcome}
													{side.moreToLead === undefined ? undefined : (
														<>
															{', '}
															<CurrencyValue value={side.moreToLead} rounding='up' suffix={copy.rep} /> {copy.moreToLead}
														</>
													)}
												</span>
											</Badge>
										)}
										<div className='statoblast-stake-bar' aria-hidden='true'>
											<div style={{ inlineSize: `${(getVisualRatio({ value: others, maxValue: greatest }) ?? 0) * 100}%` }} />
											<div style={{ inlineSize: `${(getVisualRatio({ value: yours, maxValue: greatest }) ?? 0) * 100}%` }} />
										</div>
										<small>
											{copy.othersStake} <CurrencyValue value={others} suffix={copy.rep} /> · {copy.yourStake} <CurrencyValue value={yours} suffix={copy.rep} />
											{side.saved === true && yours > 0n && (
												<span className='statoblast-report-saved' role='img' title={copy.depositSaved} aria-label={copy.depositSaved}>
													✓
												</span>
											)}
										</small>
									</li>
								)
							})}
						</ul>
						{!forkClosesReporting && view.ends !== undefined && view.ends > view.opens && view.ends <= LAST_CALENDAR_START && <ResponseTimeline opens={view.opens} ends={view.ends} now={now} estimatedEnd={canChangeLeader ? view.estimatedEndIfLeading : undefined} latestEnd={view.latestEnd} />}
					</div>
					{view.firstReportMinimum !== undefined && view.nonDecisionThreshold !== undefined && !forkClosesReporting && <EscalationExplainer firstReportMinimum={view.firstReportMinimum} nonDecisionThreshold={view.nonDecisionThreshold} />}
				</SectionBlock>
			)}
		</>
	)
}
