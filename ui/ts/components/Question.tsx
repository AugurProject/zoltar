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

function renderScalarQuestionFields(question: MarketDetails) {
	return (
		<>
			<MetricField label='Ticks'>{question.numTicks.toString()}</MetricField>
			<MetricField label='Display Range'>{getDisplayRange(question)}</MetricField>
			<MetricField label='Answer Unit'>{question.answerUnit === '' ? 'None' : question.answerUnit}</MetricField>
		</>
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
			<div className='question-summary-grid'>
				<MetricField label='Question ID'>{question.questionId}</MetricField>
				<MetricField label='Type'>{question.marketType}</MetricField>
				<MetricField label='Created'>
					<TimestampValue timestamp={question.createdAt} />
				</MetricField>
				<MetricField label='End Time'>
					<TimestampValue timestamp={question.endTime} />
				</MetricField>
				<MetricField label='Outcomes'>{getDisplayedOutcomes(question).join(', ')}</MetricField>
				{question.marketType === 'scalar' ? renderScalarQuestionFields(question) : undefined}
			</div>
		</div>
	)
}
