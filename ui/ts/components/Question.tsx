import { LoadingText } from './LoadingText.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { OutcomeChipRow } from './OutcomeChipRow.js'
import { TimestampValue } from './TimestampValue.js'
import { assertNever } from '../lib/assert.js'
import { appendInvalidOutcomeLabelIfMissing, isInvalidOutcomeLabel } from '../lib/outcomeLabels.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import type { MarketDetails } from '../types/contracts.js'

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
	return question.title.trim() === '' ? UI_STRINGS.question.untitledQuestionLabel : question.title
}

function getQuestionDescription(question: MarketDetails) {
	// Empty question descriptions are intentionally silent in the UI. These screens are read-only,
	// and users cannot add resolution notes from here.
	return question.description.trim()
}

function getQuestionTypeLabel(question: MarketDetails) {
	switch (question.marketType) {
		case 'binary':
			return UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.binaryLabel
		case 'categorical':
			return UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.categoricalLabel
		case 'scalar':
			return UI_STRINGS.marketCreateQuestionSection.marketTypeOptions.scalarLabel
		default:
			return assertNever(question.marketType)
	}
}

function getDisplayedOutcomes(question: MarketDetails) {
	const outcomes = question.outcomeLabels.length === 0 ? [UI_STRINGS.question.scalarOutcomeLabel] : question.outcomeLabels
	return appendInvalidOutcomeLabelIfMissing(outcomes)
}

function getDisplayRange(question: MarketDetails) {
	return question.answerUnit === '' ? `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()}` : `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()} ${question.answerUnit}`
}

export function getQuestionSummaryFields(question: MarketDetails): QuestionSummaryField[] {
	const fields: QuestionSummaryField[] = [
		{ kind: 'text', label: UI_STRINGS.marketCreateQuestionSection.questionTypeLabel, value: getQuestionTypeLabel(question) },
		{ kind: 'text', label: UI_STRINGS.question.questionIdLabel, value: question.questionId },
		{ kind: 'timestamp', label: UI_STRINGS.question.createdLabel, value: question.createdAt },
		{ kind: 'timestamp', label: UI_STRINGS.question.endTimeLabel, value: question.endTime },
		{ kind: 'text', label: UI_STRINGS.question.outcomesLabel, value: getDisplayedOutcomes(question).join(', ') },
	]

	if (question.marketType === 'scalar')
		fields.push(
			{ kind: 'text', label: UI_STRINGS.question.ticksLabel, value: question.numTicks.toString() },
			{ kind: 'text', label: UI_STRINGS.question.displayRangeLabel, value: getDisplayRange(question) },
			{ kind: 'text', label: UI_STRINGS.question.answerUnitLabel, value: question.answerUnit === '' ? UI_STRINGS.common.noneLabel : question.answerUnit },
		)

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
					<LoadingText>{UI_STRINGS.question.loadingQuestionDetailsLabel}</LoadingText>
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
						label: UI_STRINGS.question.ticksLabel,
						value: question.numTicks.toString(),
					},
					{
						label: UI_STRINGS.question.displayRangeLabel,
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
				<div className='question-preview-timeline' role='list' aria-label={UI_STRINGS.question.questionTimelineAriaLabel}>
					<div className='question-preview-timeline-item' role='listitem'>
						<span className='question-preview-timeline-label'>{UI_STRINGS.question.createdLabel}</span>
						<strong className='question-preview-timeline-value'>
							<TimestampValue timestamp={question.createdAt} />
						</strong>
					</div>
					<div className='question-preview-timeline-item' role='listitem'>
						<span className='question-preview-timeline-label'>{UI_STRINGS.question.endTimeLabel}</span>
						<strong className='question-preview-timeline-value'>
							<TimestampValue timestamp={question.endTime} />
						</strong>
					</div>
				</div>
				<div className='question-preview-meta'>
					<div className='question-preview-meta-item'>
						<span className='question-preview-meta-label'>{UI_STRINGS.question.questionIdLabel}</span>
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
