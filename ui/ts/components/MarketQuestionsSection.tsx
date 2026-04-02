import { EntityCard } from './EntityCard.js'
import { LoadableValue } from './LoadableValue.js'
import { QuestionSummary } from './QuestionSummary.js'
import type { MarketDetails } from '../types/contracts.js'

type MarketQuestionsSectionProps = {
	hasForked: boolean
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	onLoadZoltarQuestions: () => void
	onOpenForkTab: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	zoltarQuestionCount: bigint | undefined
	zoltarQuestions: MarketDetails[]
}

export function MarketQuestionsSection({ hasForked, loadingZoltarQuestionCount, loadingZoltarQuestions, onLoadZoltarQuestions, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestionCount, zoltarQuestions }: MarketQuestionsSectionProps) {
	return (
		<EntityCard
			title="Questions"
			badge={<span className="badge muted">{zoltarQuestionCount === undefined ? 'Unknown count' : `${ zoltarQuestionCount.toString() } questions`}</span>}
			actions={
				<button className="secondary" onClick={onLoadZoltarQuestions} disabled={loadingZoltarQuestions}>
					{loadingZoltarQuestions ? 'Loading Questions...' : 'Refresh Questions'}
				</button>
			}
		>
			{zoltarQuestions.length === 0 ? (
				<p className="detail">
					<LoadableValue loading={loadingZoltarQuestionCount} placeholder="Loading...">
						{zoltarQuestionCount === undefined ? 'No questions loaded' : `${ zoltarQuestionCount.toString() } questions`}
					</LoadableValue>
				</p>
			) : (
				<div className="entity-card-list question-browser-list">
					{zoltarQuestions.map(question => (
						<EntityCard
							key={question.questionId}
							title={question.title === '' ? 'Untitled question' : question.title}
							badge={<span className="badge ok">{question.marketType}</span>}
							actions={
								<div className="actions">
									<button
										className="secondary"
										disabled={hasForked}
										onClick={() => {
											if (hasForked) return
											onUseQuestionForFork(question.questionId)
											onOpenForkTab()
										}}
									>
										{hasForked ? 'Already Forked' : 'Use For Fork'}
									</button>
									<button className="secondary" onClick={() => onUseQuestionForPool(question.questionId)} disabled={question.marketType !== 'binary'}>
										Use For Create Pool
									</button>
								</div>
							}
						>
							<QuestionSummary question={question} hideHeading />
						</EntityCard>
					))}
				</div>
			)}
		</EntityCard>
	)
}
