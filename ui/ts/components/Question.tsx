import { LoadingText } from './LoadingText.js'
import { formatTimestamp } from '../lib/formatters.js'
import type { MarketDetails } from '../types/contracts.js'

type QuestionProps = {
	className?: string
	loading?: boolean
	question: MarketDetails | undefined
	showTitle?: boolean
}

function getQuestionTitle(question: MarketDetails) {
	return question.title.trim() === '' ? 'Untitled question' : question.title
}

function getQuestionDescription(question: MarketDetails) {
	return question.description.trim() === '' ? 'No description provided.' : question.description
}

function getDisplayedOutcomes(question: MarketDetails) {
	const outcomes = question.outcomeLabels.length === 0 ? ['Scalar'] : question.outcomeLabels
	if (outcomes.some(outcome => outcome.toLowerCase() === 'invalid')) return outcomes
	return [...outcomes, 'Invalid']
}

function getDisplayRange(question: MarketDetails) {
	return question.answerUnit === '' ? `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()}` : `${question.displayValueMin.toString()} to ${question.displayValueMax.toString()} ${question.answerUnit}`
}

function renderScalarQuestionFields(question: MarketDetails) {
	return (
		<>
			<div>
				<span className='metric-label'>Ticks</span>
				<strong>{question.numTicks.toString()}</strong>
			</div>
			<div>
				<span className='metric-label'>Display Range</span>
				<strong>{getDisplayRange(question)}</strong>
			</div>
			<div>
				<span className='metric-label'>Answer Unit</span>
				<strong>{question.answerUnit === '' ? 'None' : question.answerUnit}</strong>
			</div>
		</>
	)
}

export function Question({ className = '', loading = false, question, showTitle = true }: QuestionProps) {
	if (loading || question === undefined) {
		return (
			<div className={`question-summary ${className}`}>
				<p className='detail question-summary-loading'>
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
				<p className='detail question-summary-description'>{description}</p>
			)}
			<div className='question-summary-grid'>
				<div>
					<span className='metric-label'>Question ID</span>
					<strong>{question.questionId}</strong>
				</div>
				<div>
					<span className='metric-label'>Type</span>
					<strong>{question.marketType}</strong>
				</div>
				<div>
					<span className='metric-label'>Created</span>
					<strong>{formatTimestamp(question.createdAt)}</strong>
				</div>
				<div>
					<span className='metric-label'>End Time</span>
					<strong>{formatTimestamp(question.endTime)}</strong>
				</div>
				<div>
					<span className='metric-label'>Outcomes</span>
					<strong>{getDisplayedOutcomes(question).join(', ')}</strong>
				</div>
				{question.marketType === 'scalar' ? renderScalarQuestionFields(question) : undefined}
			</div>
		</div>
	)
}
