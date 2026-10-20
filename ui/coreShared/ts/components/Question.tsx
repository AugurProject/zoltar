import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'
import * as universeCopy from '../copy/universes.js'
import { LoadingText } from '../components/LoadingText.js'
import { AddressValue } from './AddressValue.js'
import { IdentifierValue } from '../components/IdentifierValue.js'
import { MetricGrid } from '../components/MetricGrid.js'
import { MetricField } from '../components/MetricField.js'
import { OutcomeChipRow } from './OutcomeChipRow.js'
import { TimestampValue } from '../components/TimestampValue.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '../lib/outcomeLabels.js'
import { getMarketTypeLabel } from '../lib/marketType.js'
import * as marketTypeCopy from '../copy/marketType.js'
import { formatScalarDisplayValue } from '../lib/scalarOutcome.js'
import type { ForkQuestionDetails, MarketDetails } from '../types/contracts.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import type { NetworkProfile } from '../wallet/networkProfile.js'

type QuestionProps = {
	abbreviateIdentifier?: boolean
	additionalMetrics?: ComponentChildren
	className?: string
	loading?: boolean
	question: MarketDetails | undefined
	showIdentifier?: boolean
	showTitle?: boolean
	showEndTime?: boolean
	variant?: 'full' | 'preview'
}

type QuestionSummaryField =
	| {
			kind: 'text'
			label: string
			value: string
	  }
	| {
			kind: 'identifier'
			label: string
			value: string
	  }
	| {
			kind: 'timestamp'
			label: string
			value: bigint
	  }
	| {
			kind: 'address'
			label: string
			value: string
	  }

export function getQuestionTitle(question: Pick<MarketDetails, 'title'>) {
	return question.title.trim() === '' ? commonCopy.untitledQuestion : question.title
}

function getQuestionDescription(question: Pick<MarketDetails, 'description'>) {
	// Empty question descriptions are intentionally silent in the UI. These screens are read-only,
	// and users cannot add resolution notes from here.
	return question.description.trim()
}

function getDisplayedOutcomes(question: ForkQuestionDetails) {
	if (question.outcomesComplete === false) return question.outcomeLabels
	const outcomes = question.outcomeLabels.length === 0 ? [marketTypeCopy.scalar] : question.outcomeLabels
	return appendInvalidOutcomeLabelIfMissing(outcomes)
}

function getDisplayRange(question: Pick<MarketDetails, 'displayValueMin' | 'displayValueMax' | 'answerUnit'>) {
	const displayRange = `${formatScalarDisplayValue(question.displayValueMin)} to ${formatScalarDisplayValue(question.displayValueMax)}`
	return question.answerUnit === '' ? displayRange : `${displayRange}\u00a0${question.answerUnit}`
}

function getQuestionSummaryFields(question: ForkQuestionDetails, showEndTime: boolean, showIdentifier: boolean, fork = false): QuestionSummaryField[] {
	const fields: QuestionSummaryField[] = [{ kind: 'text', label: commonCopy.questionType, value: getMarketTypeLabel(question.marketType) }]
	if (showIdentifier && question.questionId !== undefined) fields.push({ kind: 'identifier', label: commonCopy.questionId, value: question.questionId })
	if (question.createdAt !== undefined) fields.push({ kind: 'timestamp', label: commonCopy.created, value: question.createdAt })
	if (fork && question.startTime !== undefined) fields.push(question.startTime === 0n ? { kind: 'text', label: commonCopy.starts, value: commonCopy.none } : { kind: 'timestamp', label: commonCopy.starts, value: question.startTime })

	if (showEndTime && question.endTime !== undefined) fields.push({ kind: 'timestamp', label: commonCopy.endTime, value: question.endTime })
	fields.push({ kind: 'text', label: question.outcomesComplete === false ? universeCopy.outcomesOnThisPage : commonCopy.outcomes, value: getDisplayedOutcomes(question).join(', ') })

	if ((fork || question.marketType === 'scalar') && question.numTicks !== undefined) fields.push({ kind: 'text', label: commonCopy.ticks, value: question.numTicks.toString() })
	if (question.marketType === 'scalar') {
		if (question.displayValueMin !== undefined && question.displayValueMax !== undefined && question.answerUnit !== undefined)
			fields.push({ kind: 'text', label: commonCopy.displayRange, value: getDisplayRange({ displayValueMin: question.displayValueMin, displayValueMax: question.displayValueMax, answerUnit: question.answerUnit }) })
		if (question.answerUnit !== undefined) fields.push({ kind: 'text', label: commonCopy.answerUnit, value: question.answerUnit === '' ? commonCopy.none : question.answerUnit })
	}
	if (fork) {
		if (question.marketAddress !== undefined) fields.push({ kind: 'address', label: universeCopy.marketAddress, value: question.marketAddress })
		for (const [label, value] of [
			[universeCopy.creator, question.creator],
			[universeCopy.designatedReporter, question.designatedReporter],
		] as const)
			if (value !== undefined) fields.push({ kind: 'address', label, value })
		for (const [label, values] of [
			[universeCopy.categories, question.categories],
			[universeCopy.tags, question.tags],
		] as const)
			if (values !== undefined && values.length > 0) fields.push({ kind: 'text', label, value: values.join(', ') })
	}

	return fields
}

function renderQuestionDescription(description: string, fork: boolean) {
	if (description === '') return undefined
	if (!fork) return <p className='detail'>{description}</p>
	return description.split(/\n\s*\n/).map(paragraph => (
		<p key={paragraph} className='detail'>
			{paragraph}
		</p>
	))
}

function FullQuestion({
	abbreviateIdentifier = false,
	additionalMetrics,
	className = '',
	question,
	showTitle = true,
	showEndTime = true,
	showIdentifier = true,
	fork = false,
	explorerProfile,
}: Omit<QuestionProps, 'question' | 'variant'> & { question: ForkQuestionDetails; fork?: boolean; explorerProfile?: NetworkProfile | undefined }) {
	const descriptionNode = renderQuestionDescription(getQuestionDescription(question), fork)
	return (
		<div className={`question-summary ${className}`}>
			{showTitle ? (
				<div className='question-summary-heading'>
					<strong>{getQuestionTitle(question)}</strong>
					{descriptionNode}
				</div>
			) : (
				descriptionNode
			)}
			<MetricGrid variant='question'>
				{getQuestionSummaryFields(question, showEndTime, showIdentifier, fork).map(field => renderQuestionSummaryField(field, abbreviateIdentifier, explorerProfile))}
				{additionalMetrics}
			</MetricGrid>
		</div>
	)
}

export function ForkQuestion({ question, loading = false, explorerProfile }: { question: ForkQuestionDetails | undefined; loading?: boolean; explorerProfile?: NetworkProfile | undefined }) {
	return <WorkflowSubsection title={universeCopy.forkQuestion}>{loading || question === undefined ? <Question question={undefined} loading /> : <FullQuestion question={question} fork explorerProfile={explorerProfile} />}</WorkflowSubsection>
}

function renderQuestionSummaryField(field: QuestionSummaryField, abbreviateIdentifier: boolean, explorerProfile?: NetworkProfile) {
	if (field.kind === 'address')
		return (
			<MetricField key={field.label} label={field.label}>
				<AddressValue address={field.value} explorerProfile={explorerProfile} wrap />
			</MetricField>
		)
	if (field.kind === 'identifier')
		return (
			<MetricField key={field.label} label={field.label}>
				<IdentifierValue value={field.value} abbreviated={abbreviateIdentifier} />
			</MetricField>
		)
	if (field.kind === 'timestamp')
		return (
			<MetricField key={field.label} label={field.label}>
				<TimestampValue timestamp={field.value} />
			</MetricField>
		)

	return (
		<MetricField key={field.label} label={field.label}>
			{field.value}
		</MetricField>
	)
}

export function Question({ abbreviateIdentifier = false, additionalMetrics, className = '', loading = false, question, showIdentifier = true, showTitle = true, showEndTime = true, variant = 'full' }: QuestionProps) {
	if (loading || question === undefined)
		return (
			<div className={`question-summary ${className}`}>
				<p className='detail'>
					<LoadingText>{commonCopy.questionDetailsLoadingLabel}</LoadingText>
				</p>
				{additionalMetrics === undefined ? undefined : <MetricGrid variant='question'>{additionalMetrics}</MetricGrid>}
			</div>
		)

	const title = getQuestionTitle(question)
	const description = getQuestionDescription(question)
	const showHeading = showTitle || description !== ''
	const descriptionNode = description === '' ? undefined : <p className='detail'>{description}</p>
	const outcomeItems = getDisplayedOutcomes(question).map(outcome => ({
		key: outcome,
		label: outcome,
		tone: isInvalidOutcomeLabel(outcome) ? ('warning' as const) : ('default' as const),
	}))
	const scalarFields =
		question.marketType !== 'scalar'
			? []
			: [
					{
						label: commonCopy.ticks,
						value: question.numTicks.toString(),
					},
					{
						label: commonCopy.displayRange,
						value: getDisplayRange(question),
					},
				]

	if (variant === 'preview')
		return (
			<div className={`question-summary question-summary-preview ${className}`.trim()}>
				{!showHeading ? undefined : (
					<div className='question-summary-heading'>
						{showTitle ? <strong>{title}</strong> : undefined}
						{descriptionNode}
					</div>
				)}
				<div className='question-preview-outcomes'>
					<span className='question-preview-meta-label'>{commonCopy.outcomes}</span>
					<OutcomeChipRow items={outcomeItems} />
				</div>
				<div className='question-preview-timeline' role='list' aria-label={commonCopy.questionTimeline}>
					<div className='question-preview-timeline-item' role='listitem'>
						<span className='question-preview-timeline-label'>{commonCopy.created}</span>
						<strong className='question-preview-timeline-value'>
							<TimestampValue timestamp={question.createdAt} />
						</strong>
					</div>
					{showEndTime ? (
						<div className='question-preview-timeline-item' role='listitem'>
							<span className='question-preview-timeline-label'>{commonCopy.endTime}</span>
							<strong className='question-preview-timeline-value'>
								<TimestampValue timestamp={question.endTime} />
							</strong>
						</div>
					) : undefined}
				</div>
				{showIdentifier || scalarFields.length > 0 ? (
					<div className='question-preview-meta'>
						{showIdentifier ? (
							<div className='question-preview-meta-item question-preview-meta-item-primary-id'>
								<span className='question-preview-meta-label'>{commonCopy.questionId}</span>
								<strong>
									<IdentifierValue value={question.questionId} />
								</strong>
							</div>
						) : undefined}
						{scalarFields.map(field => (
							<div className='question-preview-meta-item' key={field.label}>
								<span className='question-preview-meta-label'>{field.label}</span>
								<strong>{field.value}</strong>
							</div>
						))}
					</div>
				) : undefined}
			</div>
		)

	return <FullQuestion abbreviateIdentifier={abbreviateIdentifier} additionalMetrics={additionalMetrics} className={className} question={question} showTitle={showTitle} showEndTime={showEndTime} showIdentifier={showIdentifier} />
}
