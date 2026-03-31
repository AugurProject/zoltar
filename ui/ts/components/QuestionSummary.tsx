import { formatTimestamp } from '../lib/formatters.js'
import type { MarketDetails } from '../types/contracts.js'

type QuestionSummaryHeaderProps = {
	className?: string
	description: string
	loading?: boolean
	questionId: string
	title: string
}

type QuestionSummaryProps = {
	className?: string
	loading?: boolean
	question: MarketDetails | undefined
}

function getQuestionTitle(question: MarketDetails) {
	return question.title.trim() === '' ? 'Untitled question' : question.title
}

function getQuestionDescription(question: MarketDetails) {
	return question.description.trim() === '' ? 'No description provided.' : question.description
}

function getDisplayRange(question: MarketDetails) {
	return question.answerUnit === '' ? `${ question.displayValueMin.toString() } to ${ question.displayValueMax.toString() }` : `${ question.displayValueMin.toString() } to ${ question.displayValueMax.toString() } ${ question.answerUnit }`
}

function renderScalarQuestionFields(question: MarketDetails) {
	return (
		<>
			<div>
				<span className="metric-label">Ticks</span>
				<strong>{question.numTicks.toString()}</strong>
			</div>
			<div>
				<span className="metric-label">Display Range</span>
				<strong>{getDisplayRange(question)}</strong>
			</div>
			<div>
				<span className="metric-label">Answer Unit</span>
				<strong>{question.answerUnit === '' ? 'None' : question.answerUnit}</strong>
			</div>
		</>
	)
}

export function QuestionSummaryHeader({ className = '', description, loading = false, questionId, title }: QuestionSummaryHeaderProps) {
	if (loading) {
		return (
			<div className={`question-summary question-summary-header ${ className }`}>
				<p className="detail question-summary-loading">Loading question details...</p>
			</div>
		)
	}

	return (
		<div className={`question-summary question-summary-header ${ className }`}>
			<div className="question-summary-heading">
				<strong>{title}</strong>
				<p className="detail">{description}</p>
				<span className="question-summary-id">{questionId}</span>
			</div>
		</div>
	)
}

export function QuestionSummary({ className = '', loading = false, question }: QuestionSummaryProps) {
	if (loading || question === undefined) {
		return (
			<div className={`question-summary ${ className }`}>
				<p className="detail question-summary-loading">Loading question details...</p>
			</div>
		)
	}

	const title = getQuestionTitle(question)
	const description = getQuestionDescription(question)

	return (
		<div className={`question-summary ${ className }`}>
			<div className="question-summary-heading">
				<strong>{title}</strong>
				<p className="detail">{description}</p>
			</div>
			<div className="question-summary-grid">
				<div>
					<span className="metric-label">Question ID</span>
					<strong>{question.questionId}</strong>
				</div>
				<div>
					<span className="metric-label">Type</span>
					<strong>{question.marketType}</strong>
				</div>
				<div>
					<span className="metric-label">Created</span>
					<strong>{formatTimestamp(question.createdAt)}</strong>
				</div>
				<div>
					<span className="metric-label">End Time</span>
					<strong>{formatTimestamp(question.endTime)}</strong>
				</div>
				<div>
					<span className="metric-label">Outcomes</span>
					<strong>{question.outcomeLabels.length === 0 ? 'Scalar' : question.outcomeLabels.join(', ')}</strong>
				</div>
				{question.marketType === 'scalar' ? renderScalarQuestionFields(question) : undefined}
			</div>
		</div>
	)
}
