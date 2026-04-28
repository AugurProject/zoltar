import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { TimestampValue } from './TimestampValue.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import type { MarketDetails } from '../types/contracts.js'

type QuestionProps = {
	className?: string
	loading?: boolean
	question: MarketDetails | undefined
	showTitle?: boolean
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
	return question.title.trim() === '' ? 'Untitled question' : question.title
}

function getQuestionDescription(question: MarketDetails) {
	return question.description.trim() === '' ? 'No description provided.' : question.description
}

function getDisplayedOutcomes(question: MarketDetails) {
	const outcomes = question.outcomeLabels.length === 0 ? ['Scalar'] : question.outcomeLabels
	if (outcomes.some(outcome => sameCaseInsensitiveText(outcome, 'invalid'))) return outcomes
	return [...outcomes, 'Invalid']
}

function getDisplayRange(question: MarketDetails) {
	return question.answerUnit === '' ? `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()}` : `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()} ${question.answerUnit}`
}

export function getQuestionSummaryFields(question: MarketDetails): QuestionSummaryField[] {
	const fields: QuestionSummaryField[] = [
		{ kind: 'text', label: 'Question ID', value: question.questionId },
		{ kind: 'timestamp', label: 'Created', value: question.createdAt },
		{ kind: 'timestamp', label: 'End Time', value: question.endTime },
		{ kind: 'text', label: 'Outcomes', value: getDisplayedOutcomes(question).join(', ') },
	]

	if (question.marketType === 'scalar') {
		fields.push({ kind: 'text', label: 'Ticks', value: question.numTicks.toString() }, { kind: 'text', label: 'Display Range', value: getDisplayRange(question) }, { kind: 'text', label: 'Answer Unit', value: question.answerUnit === '' ? 'None' : question.answerUnit })
	}

	return fields
}

function renderQuestionSummaryField(field: QuestionSummaryField) {
	if (field.kind === 'timestamp') {
		return (
			<MetricField key={field.label} label={field.label}>
				<TimestampValue timestamp={field.value} />
			</MetricField>
		)
	}

	return (
		<MetricField key={field.label} label={field.label}>
			{field.value}
		</MetricField>
	)
}

export function Question({ className = '', loading = false, question, showTitle = true }: QuestionProps) {
	if (loading || question === undefined) {
		return (
			<div className={`question-summary ${className}`}>
				<p className='detail'>
					<LoadingText>Loading question details...</LoadingText>
				</p>
			</div>
		)
	}

	const title = getQuestionTitle(question)
	const description = getQuestionDescription(question)
	const summaryFields = getQuestionSummaryFields(question)

	return (
		<div className={`question-summary ${className}`}>
			{showTitle ? (
				<div className='question-summary-heading'>
					<strong>{title}</strong>
					<p className='detail'>{description}</p>
				</div>
			) : (
				<p className='detail'>{description}</p>
			)}
			<div className='question-summary-grid'>{summaryFields.map(renderQuestionSummaryField)}</div>
		</div>
	)
}
