import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OutcomeChipRow } from './OutcomeChipRow.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { assertNever } from '../../../lib/assert.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '../lib/outcomeLabels.js'
import type { MarketDetails } from '../../../types/contracts.js'

type QuestionProps = {
	className?: string
	loading?: boolean
	question: MarketDetails | undefined
	showTitle?: boolean
	variant?: 'full' | 'preview'
}

type QuestionSummaryField =
	| {
			kind: 'text'
			label: string
			value: string
	  }
	| {
			kind: 'timestamp'
			label: string
			value: bigint
	  }

export function getQuestionTitle(question: MarketDetails) {
	return question.title.trim() === '' ? marketCopy.untitledQuestion : question.title
}

function getQuestionDescription(question: MarketDetails) {
	// Empty question descriptions are intentionally silent in the UI. These screens are read-only,
	// and users cannot add resolution notes from here.
	return question.description.trim()
}

function getQuestionTypeLabel(question: MarketDetails) {
	switch (question.marketType) {
		case 'binary':
			return marketCopy.binary
		case 'categorical':
			return marketCopy.categorical
		case 'scalar':
			return marketCopy.scalar
		default:
			return assertNever(question.marketType)
	}
}

function getDisplayedOutcomes(question: MarketDetails) {
	const outcomes = question.outcomeLabels.length === 0 ? [marketCopy.scalar] : question.outcomeLabels
	return appendInvalidOutcomeLabelIfMissing(outcomes)
}

function getDisplayRange(question: MarketDetails) {
	return question.answerUnit === '' ? `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()}` : `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()} ${question.answerUnit}`
}

export function getQuestionSummaryFields(question: MarketDetails): QuestionSummaryField[] {
	const fields: QuestionSummaryField[] = [
		{ kind: 'text', label: marketCopy.questionType, value: getQuestionTypeLabel(question) },
		{ kind: 'text', label: commonCopy.questionId, value: question.questionId },
		{ kind: 'timestamp', label: marketCopy.created, value: question.createdAt },
		{ kind: 'timestamp', label: marketCopy.endTime, value: question.endTime },
		{ kind: 'text', label: marketCopy.outcomes, value: getDisplayedOutcomes(question).join(', ') },
	]

	if (question.marketType === 'scalar')
		fields.push({ kind: 'text', label: marketCopy.ticks, value: question.numTicks.toString() }, { kind: 'text', label: marketCopy.displayRange, value: getDisplayRange(question) }, { kind: 'text', label: marketCopy.answerUnit, value: question.answerUnit === '' ? commonCopy.none : question.answerUnit })

	return fields
}

function renderQuestionSummaryField(field: QuestionSummaryField) {
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

export function Question({ className = '', loading = false, question, showTitle = true, variant = 'full' }: QuestionProps) {
	if (loading || question === undefined)
		return (
			<div className={`question-summary ${className}`}>
				<p className='detail'>
					<LoadingText>{marketCopy.questionDetailsLoadingLabel}</LoadingText>
				</p>
			</div>
		)

	const title = getQuestionTitle(question)
	const description = getQuestionDescription(question)
	const showHeading = showTitle || description !== ''
	const descriptionNode = description === '' ? undefined : <p className='detail'>{description}</p>
	const summaryFields = getQuestionSummaryFields(question)
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
						label: marketCopy.ticks,
						value: question.numTicks.toString(),
					},
					{
						label: marketCopy.displayRange,
						value: getDisplayRange(question),
					},
				]

	if (variant === 'preview')
		return (
			<div className={`question-summary question-summary-preview ${className}`.trim()}>
				{!showHeading ? undefined : (
					<div className='question-summary-heading'>
						{showTitle ? <strong>{title}</strong> : null}
						{descriptionNode}
					</div>
				)}
				<OutcomeChipRow items={outcomeItems} />
				<div className='question-preview-timeline' role='list' aria-label={marketCopy.questionTimeline}>
					<div className='question-preview-timeline-item' role='listitem'>
						<span className='question-preview-timeline-label'>{marketCopy.created}</span>
						<strong className='question-preview-timeline-value'>
							<TimestampValue timestamp={question.createdAt} />
						</strong>
					</div>
					<div className='question-preview-timeline-item' role='listitem'>
						<span className='question-preview-timeline-label'>{marketCopy.endTime}</span>
						<strong className='question-preview-timeline-value'>
							<TimestampValue timestamp={question.endTime} />
						</strong>
					</div>
				</div>
				<div className='question-preview-meta'>
					<div className='question-preview-meta-item'>
						<span className='question-preview-meta-label'>{commonCopy.questionId}</span>
						<strong>{question.questionId}</strong>
					</div>
					{scalarFields.map(field => (
						<div className='question-preview-meta-item' key={field.label}>
							<span className='question-preview-meta-label'>{field.label}</span>
							<strong>{field.value}</strong>
						</div>
					))}
				</div>
			</div>
		)

	return (
		<div className={`question-summary ${className}`}>
			{showTitle ? (
				<div className='question-summary-heading'>
					<strong>{title}</strong>
					{descriptionNode}
				</div>
			) : (
				descriptionNode
			)}
			<MetricGrid variant='question'>{summaryFields.map(renderQuestionSummaryField)}</MetricGrid>
		</div>
	)
}
