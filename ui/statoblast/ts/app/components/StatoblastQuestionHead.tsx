import * as pageCopy from '@zoltar/ui-statoblast-shared/copy/questionPage.js'
import { AddressText, AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { statoblastPageHref, type StatoblastQuestionPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ListedQuestionLedger, ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'

type QuestionHeading = Pick<ListedQuestionLedger, 'ordinaryEscalationGameStarted' | 'questionId' | 'questionLedgerAddress' | 'questionOutcome' | 'universeHasForked'> & {
	marketDetails: Pick<ListedQuestionLedger['marketDetails'], 'description' | 'endTime' | 'title'>
}

export function decodeQuestionHeading(value: unknown): QuestionHeading | undefined {
	return decodeStoredValue(value, read => {
		const details = read.record('marketDetails')
		return {
			marketDetails: { description: details.string('description'), endTime: details.bigint('endTime'), title: details.string('title') },
			ordinaryEscalationGameStarted: read.boolean('ordinaryEscalationGameStarted'),
			questionId: read.string('questionId'),
			questionLedgerAddress: read.address('questionLedgerAddress'),
			questionOutcome: read.oneOf('questionOutcome', ['none', 'yes', 'no', 'invalid']),
			universeHasForked: read.boolean('universeHasForked'),
		}
	})
}

export function StatoblastQuestionHead({ page, question, reporting, now, hasShares, presentationOnly = false }: { presentationOnly?: boolean; page: StatoblastQuestionPage; question: QuestionHeading; reporting: ReportingDetails | undefined; now: bigint | undefined; hasShares: boolean }) {
	const poolPage = { kind: 'pool', pool: page.pool, tab: 'capital' } as const
	const questionsPage = { ...poolPage, tab: 'questions' } as const
	const title = getQuestionTitle(question.marketDetails)
	const resolved = question.questionOutcome !== 'none'
	const started = question.ordinaryEscalationGameStarted || reporting?.status === 'active'
	const forkStep = question.universeHasForked || (reporting?.status === 'active' && reporting.hasReachedNonDecision)
	const ended = now !== undefined && now >= question.marketDetails.endTime
	let step = 0
	if (ended) step = 1
	if (started) step = 2
	if (resolved) step = 3
	const phase = forkStep ? pageCopy.fork : (pageCopy.stageLabels[step] ?? pageCopy.trading)
	const phaseTone = resolved ? 'ok' : 'muted'
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
	const steps = [
		{ label: pageCopy.trading, detail: step === 0 ? pageCopy.tradingActive : undefined },
		{ label: pageCopy.reportingOpens, detail: <TimestampValue timestamp={question.marketDetails.endTime} relative={now === undefined ? false : 'after'} {...(now === undefined ? {} : { currentTimestamp: now })} /> },
		{ label: pageCopy.responseWindow, detail: responseEnd === undefined || responseEnd === 0n ? pageCopy.responseWindowBeforeReport : <TimestampValue timestamp={responseEnd} relative={false} /> },
		{ label: pageCopy.resolved, detail: pageCopy.resolutionAction },
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
					{!presentationOnly && <FavoriteToggle app='statoblast' kind='question' id={`${page.pool}:${question.questionId}`} entityLabel={pageCopy.formatInSecurityPool(title, page.pool)} confirmUnfavorite={() => !hasShares || window.confirm(pageCopy.unstarPositionConfirmation)} />}
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
						<>
							<div>
								<dt>{pageCopy.minimumFirstReport}</dt>
								<dd>
									<CurrencyValue value={reporting.startBondAttoRep} suffix={pageCopy.rep} />
								</dd>
							</div>
							<div>
								<dt>{pageCopy.forkThresholdPerOutcome}</dt>
								<dd>
									<CurrencyValue value={reporting.nonDecisionThresholdAttoRep} suffix={pageCopy.rep} />
								</dd>
							</div>
						</>
					)}
				</dl>
				{question.marketDetails.description !== '' && <p>{question.marketDetails.description}</p>}
			</details>
			<div className='statoblast-question-progress' aria-label={pageCopy.questionProgress}>
				<ol>
					{steps.map(({ label, detail }, index) => (
						<li key={label} data-completed={index < step} aria-current={!forkStep && index === step ? 'step' : undefined}>
							<strong>{label}</strong>
							{detail === undefined ? undefined : <span>{detail}</span>}
						</li>
					))}
					<li className='statoblast-fork-step' aria-current={forkStep ? 'step' : undefined}>
						<strong>{pageCopy.orFork}</strong>
						<span>{forkStep ? pageCopy.nonDecision : forkCondition}</span>
					</li>
				</ol>
			</div>
		</>
	)
}
