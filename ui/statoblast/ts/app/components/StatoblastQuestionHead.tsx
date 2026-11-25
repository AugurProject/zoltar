import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { AddressText, AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { statoblastPageHref, type StatoblastQuestionPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ListedQuestionLedger, ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'

type QuestionHeading = Pick<ListedQuestionLedger, 'initialReportingResponseWindow' | 'ordinaryEscalationGameStarted' | 'questionId' | 'questionLedgerAddress' | 'questionOutcome' | 'universeHasForked'> & {
	marketDetails: Pick<ListedQuestionLedger['marketDetails'], 'description' | 'endTime' | 'title'>
}

export function decodeQuestionHeading(value: unknown): QuestionHeading | undefined {
	return decodeStoredValue(value, read => {
		const details = read.record('marketDetails')
		return {
			marketDetails: { description: details.string('description'), endTime: details.bigint('endTime'), title: details.string('title') },
			initialReportingResponseWindow: read.optional('initialReportingResponseWindow', read.bigint),
			ordinaryEscalationGameStarted: read.boolean('ordinaryEscalationGameStarted'),
			questionId: read.string('questionId'),
			questionLedgerAddress: read.address('questionLedgerAddress'),
			questionOutcome: read.oneOf('questionOutcome', ['none', 'yes', 'no', 'invalid']),
			universeHasForked: read.boolean('universeHasForked'),
		}
	})
}

export function StatoblastQuestionHead({
	page,
	question,
	reporting,
	now,
	hasShares,
	checkingDeadline = false,
	presentationOnly = false,
}: {
	presentationOnly?: boolean
	checkingDeadline?: boolean
	page: StatoblastQuestionPage
	question: QuestionHeading
	reporting: ReportingDetails | undefined
	now: bigint | undefined
	hasShares: boolean
}) {
	const poolPage = { kind: 'pool', pool: page.pool, tab: 'capital' } as const
	const questionsPage = { ...poolPage, tab: 'questions' } as const
	const title = getQuestionTitle(question.marketDetails)
	const resolved = question.questionOutcome !== 'none' || reporting?.settlementState === 'resolved'
	const started = question.ordinaryEscalationGameStarted || reporting?.status === 'active'
	const paused = !resolved && reporting?.status === 'active' && reporting.forkContinuation && reporting.forkResumedAt === 0n
	const forkStep = !resolved && (question.universeHasForked || (reporting?.status === 'active' && reporting.hasReachedNonDecision))
	const ended = now !== undefined && now >= question.marketDetails.endTime
	let step = 0
	if (ended) step = 1
	if (started) step = 2
	if (resolved) step = 3
	let phase = pageCopy.stageLabels[step] ?? pageCopy.trading
	if (paused) phase = pageCopy.pausedUntilBranchActivation
	if (forkStep) phase = pageCopy.undecidedForkStage
	if (checkingDeadline && !resolved) phase = pageCopy.deadlineChecking
	const phaseTone = resolved ? 'ok' : 'muted'
	const hasStakedRep = reporting?.status === 'active' && reporting.sides.some(side => (side.localPrincipalAttoRep ?? 0n) > 0n || side.userDeposits.some(deposit => deposit.amountAttoRep > 0n))
	const threshold = reporting?.nonDecisionThresholdAttoRep
	const forkCondition =
		threshold === undefined ? (
			pageCopy.nonDecisionCondition
		) : (
			<>
				{pageCopy.nonDecisionConditionLead}
				<CurrencyValue value={threshold} suffix={pageCopy.rep} />
			</>
		)
	const responseEnd = reporting?.status === 'active' ? reporting.escalationEndTime : undefined
	const responseDeadline = responseEnd === undefined || responseEnd === 0n ? pageCopy.responseWindowBeforeReport : <TimestampValue timestamp={responseEnd} relative={false} />
	const forkDetail = question.universeHasForked ? undefined : pageCopy.waitingForFork
	const steps = [
		{ label: forkStep ? pageCopy.tradingEnded : pageCopy.trading, detail: step === 0 && !forkStep ? pageCopy.tradingActive : undefined },
		{ label: forkStep ? pageCopy.reportingOpened : pageCopy.reportingOpens, detail: <TimestampValue timestamp={question.marketDetails.endTime} relative={now === undefined ? false : 'after'} {...(now === undefined ? {} : { currentTimestamp: now })} /> },
		{ label: forkStep ? pageCopy.endedUndecided : pageCopy.responseWindow, detail: paused ? pageCopy.startsAtActivation : responseDeadline },
		{ label: forkStep ? pageCopy.fork : pageCopy.resolved, detail: forkStep ? forkDetail : pageCopy.resolutionAction },
	]
	return (
		<>
			<nav aria-label={pageCopy.breadcrumbs} className='statoblast-breadcrumbs'>
				<a href={statoblastPageHref({ kind: 'watchlist' })}>{pageCopy.watchlist}</a>
				<span aria-hidden='true'>›</span>
				<a href={statoblastPageHref(poolPage)}>
					{pageCopy.securityPool}{' '}
					<code>
						<AddressText address={page.pool} longAbbreviation />
					</code>
				</a>
				<span aria-hidden='true'>›</span>
				<a href={statoblastPageHref(questionsPage)}>{pageCopy.questions}</a>
				<span aria-hidden='true'>›</span>
				<span aria-current='page'>{pageCopy.question}</span>
			</nav>
			<a className='statoblast-back-link' href={statoblastPageHref(questionsPage)}>
				{pageCopy.backToQuestions}
			</a>
			<header className='statoblast-question-head'>
				<div className='statoblast-question-stage'>
					<Badge tone={forkStep ? 'warning' : phaseTone}>{phase}</Badge>
					<span>
						{pageCopy.binary}
						{pageCopy.questionIdLead}
						<code>{question.questionId}</code>
					</span>
				</div>
				<div className='statoblast-question-title'>
					{!presentationOnly && <FavoriteToggle app='statoblast' kind='question' id={`${page.pool}:${question.questionId}`} entityLabel={pageCopy.formatInSecurityPool(title, page.pool)} confirmUnfavorite={() => (!hasShares && !hasStakedRep) || window.confirm(pageCopy.unstarPositionConfirmation)} />}
					<h1>{title}</h1>
				</div>
				<a className='statoblast-outlined-link' href={statoblastPageHref(poolPage)}>
					{pageCopy.openSecurityPool}
				</a>
			</header>
			<details className='statoblast-question-details' open={page.tab === 'claims' ? true : undefined}>
				<summary>{pageCopy.resolutionRulesAndDetails}</summary>
				<dl>
					<div>
						<dt>{pageCopy.questionType}</dt>
						<dd>{pageCopy.binary}</dd>
					</div>
					<div>
						<dt>{pageCopy.tradingEnd}</dt>
						<dd>
							<TimestampValue timestamp={question.marketDetails.endTime} relative={false} />
						</dd>
					</div>
					<div>
						<dt>{pageCopy.questionId}</dt>
						<dd>
							<code>{question.questionId}</code>
						</dd>
					</div>
					<div>
						<dt>{pageCopy.questionContract}</dt>
						<dd>
							<AddressValue longAbbreviation address={question.questionLedgerAddress} />
						</dd>
					</div>
					<div>
						<dt>{pageCopy.securityPool}</dt>
						<dd>
							<AddressValue longAbbreviation address={page.pool} />
						</dd>
					</div>
					{reporting !== undefined && (
						<div>
							<dt>{pageCopy.minimumFirstReport}</dt>
							<dd>
								<CurrencyValue value={reporting.startBondAttoRep} suffix={pageCopy.rep} />
							</dd>
						</div>
					)}
					{question.initialReportingResponseWindow !== undefined && (
						<div>
							<dt>{pageCopy.responseWindow}</dt>
							<dd>{formatDuration(question.initialReportingResponseWindow)}</dd>
						</div>
					)}
					{reporting !== undefined && (
						<div>
							<dt>{pageCopy.forkThresholdPerOutcome}</dt>
							<dd>
								<CurrencyValue value={reporting.nonDecisionThresholdAttoRep} suffix={pageCopy.rep} />
							</dd>
						</div>
					)}
				</dl>
				{question.marketDetails.description !== '' && <p>{question.marketDetails.description}</p>}
			</details>
			<div className='statoblast-question-progress' aria-label={pageCopy.questionProgress}>
				<ol>
					{steps.map(({ label, detail }, index) => (
						<li key={label} data-completed={index < (forkStep ? 3 : step)} data-danger={forkStep && index === 2 ? true : undefined} aria-current={!checkingDeadline && index === (forkStep ? 3 : step) ? 'step' : undefined}>
							<strong>{label}</strong>
							{detail === undefined ? undefined : <span>{detail}</span>}
						</li>
					))}
					{!forkStep && (
						<li className='statoblast-fork-step'>
							<strong>{pageCopy.orFork}</strong>
							<span>{forkCondition}</span>
						</li>
					)}
				</ol>
			</div>
		</>
	)
}
